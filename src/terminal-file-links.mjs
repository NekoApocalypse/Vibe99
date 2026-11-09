import { previewKind } from './preview-formats.mjs';
// Supported document references. URI authorities stay explicit so callers can choose
// the correct local/SSH workspace instead of guessing a host from a path.
export function parseFileReference(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return null;
  let text = value.trim();
  const quoted = text.match(/^(["'`])([^\r\n]+)\1((?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?)$/);
  if (quoted) text = quoted[2] + quoted[3];
  let scheme = 'path', authority = null;
  if (/^(?:(?:file|vscode-remote):|[a-z][a-z0-9+.-]*:\/\/)/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) {
    let uri;
    try { uri = new URL(text); } catch { return null; }
    if (uri.search || uri.username || uri.password || uri.port) return null;
    if (uri.protocol === 'file:') {
      scheme = 'file';
      authority = uri.hostname && uri.hostname.toLowerCase() !== 'localhost' ? uri.hostname : null;
    } else if (uri.protocol === 'vscode-remote:') {
      scheme = 'vscode-remote';
      if (!uri.hostname.startsWith('ssh-remote+')) return null;
      authority = uri.hostname.slice('ssh-remote+'.length);
      // Encoded VS Code authority objects are deliberately not interpreted.
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(authority) || /^7b[0-9a-f]+$/i.test(authority)) return null;
    } else return null;
    try { text = decodeURIComponent(uri.pathname) + uri.hash; } catch { return null; }
    if (/^\/[a-z]:\//i.test(text)) {
      if (authority) return null; // A remote host plus a local drive is ambiguous.
      text = text.slice(1);
    }
  }
  let line, column;
  const location = text.match(/(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)$/);
  if (location) {
    line = Number(location[1] || location[3]);
    column = location[2] || location[4] ? Number(location[2] || location[4]) : undefined;
    if (!Number.isSafeInteger(line) || line < 1 || (column !== undefined && (!Number.isSafeInteger(column) || column < 1))) return null;
    text = text.slice(0, -location[0].length);
  }
  text = text.replaceAll('\\', '/');
  if (!previewKind(text) || !text || /[\x00-\x1f\x7f<>"'`|?#]/.test(text)) return null;
  if (!text.split('/').at(-1).replace(/\.[^.]+$/, '')) return null;
  if (text.includes('://') || /:/.test(text.replace(/^[a-z]:/i, ''))) return null;
  if (/^[a-z]:[^/]/i.test(text) || text.startsWith('//')) return null;
  text = text.replace(/\/{2,}/g, '/');
  const result = { path: text, authority, scheme };
  if (line !== undefined) result.line = line;
  if (column !== undefined) result.column = column;
  return result;
}

export function findReferences(text) {
  const results = [], quotedSpans = [];
  const markdownSpans = [...text.matchAll(/\[[^\]\r\n]*\]\([^\r\n]*?\)/g)]
    .map(match => [match.index, match.index + match[0].length]);
  const inMarkdown = index => markdownSpans.some(([start, end]) => index >= start && index < end);
  for (const match of text.matchAll(/\[([^\[\]\r\n]+)\]\((<[^<>\r\n]+>|[^()\s]+)\)/g)) {
    let target = match[2];
    if (target.startsWith('<')) target = target.slice(1, -1);
    try { if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) target = decodeURIComponent(target); }
    catch { continue; }
    const reference = parseFileReference(target);
    if (reference) results.push({ index: match.index + 1, text: match[1], reference });
  }
  const urlSpans = [...text.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi)]
    .filter(match => !/^(?:file|vscode-remote):/i.test(match[0]))
    .map(match => [match.index, match.index + match[0].length]);
  const inUrl = index => urlSpans.some(([start, end]) => index >= start && index < end);
  const quoted = /(["'`])[^"'`\r\n]+\1(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?/g;
  for (const match of text.matchAll(quoted)) {
    quotedSpans.push([match.index, match.index + match[0].length]);
    if (inMarkdown(match.index)) continue;
    const reference = parseFileReference(match[0]);
    if (reference && !inUrl(match.index)) results.push({ index: match.index, text: match[0], reference });
  }
  for (const match of text.matchAll(/[^\s"'`<>()[\]{}|]+/g)) {
    if (inMarkdown(match.index)) continue;
    if (quotedSpans.some(([start, end]) => match.index >= start && match.index < end)) continue;
    if (inUrl(match.index)) continue;
    const token = match[0].replace(/[.,;!?]+$/, '');
    const reference = parseFileReference(token);
    if (reference) results.push({ index: match.index, text: token, reference });
  }
  return results.filter(result => !inUrl(result.index)).sort((a, b) => a.index - b.index);
}

// Bound work on pathological output. Logical lines beyond either limit yield no
// links, rather than treating a truncated suffix as a different relative path.
const MAX_ROWS = 32, MAX_CELLS = 16384;
function readLogicalLine(terminal, y) {
  const buffer = terminal.buffer.active;
  let first = y - 1, last = first;
  if (!buffer.getLine(first)) return null;
  while (buffer.getLine(first)?.isWrapped) {
    if (first === 0 || y - first >= MAX_ROWS) return null;
    first--;
  }
  while (buffer.getLine(last + 1)?.isWrapped) {
    if (last - first + 1 >= MAX_ROWS) return null;
    last++;
  }
  if ((last - first + 1) * terminal.cols > MAX_CELLS) return null;
  let text = '';
  const cells = [];
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(row);
    let end = Math.min(line.length, terminal.cols) - 1;
    // Drop null padding (including the spare cell before a wrapped wide glyph),
    // but preserve explicit spaces inside quoted paths.
    while (end >= 0 && !line.getCell(end)?.getChars()) end--;
    for (let x = 0; x <= end; x++) {
      const cell = line.getCell(x);
      const width = cell.getWidth();
      if (width === 0) continue;
      const chars = cell.getChars() || ' ';
      if (text.length + chars.length > MAX_CELLS * 2) return null;
      text += chars;
      for (let i = 0; i < chars.length; i++) cells.push({ start: { x: x + 1, y: row + 1 }, end: { x: x + width, y: row + 1 } });
    }
  }
  return { text, cells };
}

export function registerTerminalFileLinks(terminal, onOpen) {
  let disposed = false, hovered = null, explicitHovered = null, pressed = null, consumeClick = false;
  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }
  function activate(event, reference) {
    if (event.button !== 0 || event.shiftKey) return;
    consume(event);
    if (!disposed) onOpen(reference, event);
  }
  const provider = terminal.registerLinkProvider({
    provideLinks(y, callback) {
      if (disposed) { callback(undefined); return; }
      const logical = readLogicalLine(terminal, y);
      if (!logical) { callback(undefined); return; }
      const links = [];
      for (const match of findReferences(logical.text)) {
        const start = logical.cells[match.index]?.start;
        const end = logical.cells[match.index + match.text.length - 1]?.end;
        if (!start || !end || y < start.y || y > end.y) continue;
        const link = { range: { start, end }, text: match.text,
          activate: event => activate(event, match.reference),
          hover() { hovered = link; },
          leave() { if (hovered === link) hovered = null; },
          dispose() { if (hovered === link) hovered = null; },
        };
        links.push(link);
      }
      callback(links);
    },
  });
  // xterm's link activation happens after its mousedown mouse report. Consume a
  // hovered file or web link in capture phase, and activate it on mouseup.
  // This avoids sending a click into an application with mouse tracking enabled.
  const element = terminal.element;
  const down = event => {
    const chosen = explicitHovered || hovered;
    if (disposed || event.button !== 0 || event.shiftKey || !chosen) return;
    consume(event);
    pressed = { link: chosen, x: event.clientX, y: event.clientY };
    consumeClick = true;
  };
  const up = event => {
    if (!pressed || event.button !== 0) return;
    consume(event);
    const previous = pressed; pressed = null;
    if ((explicitHovered || hovered) === previous.link && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 6) {
      previous.link.activate(event);
    }
  };
  const click = event => { if (consumeClick && event.button === 0) { consumeClick = false; consume(event); } };
  const leave = () => { hovered = null; explicitHovered = null; pressed = null; consumeClick = false; };
  element?.addEventListener('mousedown', down, true);
  element?.addEventListener('mouseup', up, true);
  element?.addEventListener('click', click, true);
  element?.addEventListener('mouseleave', leave);
  return {
    // Web/OSC8 providers share the same gesture interception as file links.
    setExternalLink(activate) {
      explicitHovered = !disposed && activate ? { activate } : null;
    },
    // Feed this from xterm's public OSC8 linkHandler hover/leave callbacks.
    setExplicitReference(reference) {
      explicitHovered = !disposed && reference ? { activate: event => activate(event, reference) } : null;
    },
    dispose() {
    disposed = true; leave(); provider.dispose();
    element?.removeEventListener('mousedown', down, true);
    element?.removeEventListener('mouseup', up, true);
    element?.removeEventListener('click', click, true);
    element?.removeEventListener('mouseleave', leave);
    },
  };
}
