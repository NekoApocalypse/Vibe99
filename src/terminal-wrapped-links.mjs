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
    let text = '', end = 0; const cells = [];
    for (let x = 0; x < Math.min(line.length, cols); x++) {
      const cell = line.getCell(x), width = cell?.getWidth();
      if (!width) continue;
      const chars = cell.getChars() || ' ';
      text += chars;
      for (let i = 0; i < chars.length; i++) cells.push({ start: { x: x + 1, y: index + 1 }, end: { x: x + width, y: index + 1 } });
      if (chars.trim()) end = x + width;
    }
    const result = { text: text.trimEnd(), cells, end, wrapped: line.isWrapped };
    cache.set(index, result); return result;
  }
  function connects(index) {
    const left = row(index), right = row(index + 1);
    if (!left || !right) return false;
    if (right.wrapped) return true;
    if (!right.text.trim()) return false;
    // Word-wrapping TUIs also break at '-' or '/' inside a path, before the
    // margin. Keep the separator: it is part of the target, not prose hyphenation.
    if (left.end < cols - 2 && !/[-/\\]$/.test(left.text)) return false;
    const next = right.text.trimStart();
    // New links, absolute paths, list items and headings start a new statement.
    if (/^(?:[a-z][a-z0-9+.-]*:|[/\\]|[-*+]\s|#{1,6}\s|\d+[.)]\s)/i.test(next)) return false;
    if (right.text.length - next.length > 8 || /["'`)>\]}]$/.test(left.text)) return false;
    const tail = left.text.match(/[^\s"'`<>()[\]{}|]+$/)?.[0];
    if (tail && parseFileReference(tail)) return false;
    return true;
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
  let text = ''; const cells = [], hardBreaks = [];
  for (let index = first; index <= last; index++) {
    const part = row(index);
    const hard = index > first && !part.wrapped;
    const skip = hard ? part.text.length - part.text.trimStart().length : 0;
    if (hard) hardBreaks.push(text.length);
    text += part.text.slice(skip);
    cells.push(...part.cells.slice(skip, part.text.length));
  }
  if (!hardBreaks.length) return [];
  const candidates = findReferences(text).map(match => ({ ...match, target: match.reference }));
  for (const match of text.matchAll(URL_PATTERN)) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === 'http:' || url.protocol === 'https:') candidates.push({ index: match.index, text: match[0], url: match[0] });
    } catch {}
  }
  return candidates.flatMap(match => {
    const endIndex = match.index + match.text.length;
    const breaks = hardBreaks.filter(index => index > match.index && index < endIndex);
    if (!breaks.length) return [];
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
