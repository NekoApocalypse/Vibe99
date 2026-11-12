import { findReferences, parseFileReference } from './terminal-file-links.mjs';

// Some TUIs/tmux redraw visual rows with CRLF/cursor movement, losing xterm's
// isWrapped flag. Infer margin wraps and word-wrap breaks after path separators.
// Never concatenate arbitrary adjacent paragraphs or guess a different host.
const MAX_ROWS = 32, MAX_CELLS = 16384;
// Same URL boundaries as @xterm/addon-web-links (MIT, xterm.js authors).
const URL_PATTERN = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/g;

export function wrappedReferences(terminal, y) {
  const buffer = terminal.buffer.active, cols = terminal.cols;
  if (cols > MAX_CELLS || cols < 1) return [];
  const maxRows = Math.min(MAX_ROWS, Math.floor(MAX_CELLS / cols));
  const cache = new Map();
  function row(index) {
    if (cache.has(index)) return cache.get(index);
    const line = buffer.getLine(index);
    if (!line) return null;
    let text = '', end = 0, contentLength = 0; const cells = [];
    for (let x = 0; x < Math.min(line.length, cols); x++) {
      const cell = line.getCell(x), width = cell?.getWidth();
      if (!width) continue;
      const raw = cell.getChars(), chars = raw || ' ';
      text += chars;
      if (raw) contentLength = text.length;
      for (let i = 0; i < chars.length; i++) cells.push({ start: { x: x + 1, y: index + 1 }, end: { x: x + width, y: index + 1 } });
      if (chars.trim()) end = x + width;
    }
    const result = { text: text.trimEnd(), rawText: text.slice(0, contentLength), cells, end, wrapped: line.isWrapped };
    cache.set(index, result); return result;
  }
  function canInferBreak(index) {
    let leftIndex = index, rightIndex = index + 1;
    let left = row(leftIndex), right = row(rightIndex);
    // Padding can overflow into a whitespace-only soft-wrapped row before the
    // TUI emits CRLF. Skip only those rows, never an intentional blank line.
    while (left && !left.text && left.wrapped && index - leftIndex < maxRows) left = row(--leftIndex);
    while (right && !right.text && right.wrapped && rightIndex - index < maxRows) right = row(++rightIndex);
    if (!left || !right) return false;
    if (!right.text.trim()) return false;
    // Word-wrapping TUIs also break at '-' or '/' inside a path, before the
    // margin. Keep the separator: it is part of the target, not prose hyphenation.
    if (left.end < cols - 2 && !/[-/\\]$/.test(left.text)) return false;
    const next = right.text.trimStart();
    // New links, absolute paths, list items and headings start a new statement.
    if (/^(?:[a-z][a-z0-9+.-]*:|[/\\]|[-*+]\s|#{1,6}\s|\d+[.)]\s)/i.test(next)) return false;
    if (/["'`)>\]}]$/.test(left.text)) return false;
    const tail = left.text.match(/[^\s"'`<>()[\]{}|]+$/)?.[0];
    if (tail && parseFileReference(tail)) return false;
    return true;
  }
  const connects = index => row(index + 1)?.wrapped || canInferBreak(index);
  function repairAt(index) {
    const left = row(index - 1), right = row(index);
    if (!left || !right) return false;
    if (!right.wrapped) return canInferBreak(index - 1);
    // A TUI's padding can itself reach the margin and set isWrapped. It is
    // still display whitespace, not part of an unquoted path or URL.
    const padding = left.rawText.length > left.text.length || /^\s/.test(right.text) || !right.text;
    return padding && canInferBreak(index - 1);
  }
  let first = y - 1, last = first;
  if (!row(first)) return [];
  while (first > 0 && connects(first - 1)) {
    if (last - first + 1 >= maxRows) return [];
    first--;
  }
  while (connects(last)) {
    if (last - first + 1 >= maxRows) return [];
    last++;
  }
  if ((last - first + 1) * cols > MAX_CELLS) return [];
  let text = ''; const cells = [], repairedBreaks = [], repairedSoftBreaks = [];
  for (let index = first; index <= last; index++) {
    const part = row(index);
    const repair = index > first && repairAt(index);
    const skip = repair ? part.text.length - part.text.trimStart().length : 0;
    if (repair) {
      repairedBreaks.push(text.length);
      if (part.wrapped) repairedSoftBreaks.push(text.length);
    }
    const content = index < last && !repairAt(index + 1) ? part.rawText : part.text;
    text += content.slice(skip);
    cells.push(...part.cells.slice(skip, content.length));
  }
  if (!repairedBreaks.length) return [];
  const candidates = findReferences(text).map(match => ({ ...match, target: match.reference }));
  for (const match of text.matchAll(URL_PATTERN)) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === 'http:' || url.protocol === 'https:') candidates.push({ index: match.index, text: match[0], url: match[0] });
    } catch {}
  }
  return candidates.flatMap(match => {
    const endIndex = match.index + match.text.length;
    const breaks = repairedBreaks.filter(index => index > match.index && index < endIndex);
    if (!breaks.length) return [];
    // Spaces in explicitly quoted filenames can be real. Let the original
    // whitespace-preserving provider handle those soft wraps.
    if (/^["'`]/.test(match.text) && repairedSoftBreaks.some(index => index > match.index && index < endIndex)) return [];
    // A bare filename after prose is not a continuation. Require a path/URI
    // prefix before the first inferred break, not merely somewhere afterwards.
    const prefix = text.slice(match.index, breaks[0]);
    if (!/[\/\\]/.test(prefix)) return [];
    const start = cells[match.index]?.start, end = cells[endIndex - 1]?.end;
    if (!start || !end || y < start.y || y > end.y) return [];
    return [{ range: { start, end }, text: match.text, reference: match.target, url: match.url }];
  });
}

export function registerWrappedLinks(terminal, { getGestures, openFile, openUrl }) {
  return terminal.registerLinkProvider({ provideLinks(y, callback) {
    callback(wrappedReferences(terminal, y).map(match => {
      const activate = event => {
        if (event.button !== 0 || event.shiftKey) return;
        if (match.reference) openFile(match.reference); else openUrl(event, match.url);
      };
      return { range: match.range, text: match.text, activate,
        hover: () => getGestures()?.setExternalLink(activate),
        leave: () => getGestures()?.setExternalLink(null) };
    }));
  } });
}
