// VS Code Ctrl+P style command palette: a single floating overlay with a
// search input and a list of items. Fuzzy match (via fuse.js) on the
// item label, ↑/↓ to move selection, Enter to select, Esc / click
// outside to dismiss.
//
// The module is feature-agnostic: callers pass in the items to show and
// a callback invoked with the selected item id. Styles live in
// styles.css under the `command-palette-*` prefix.

import Fuse from 'fuse.js';

import './command-palette.css';

let paletteState = null;

/**
 * @typedef {object} PaletteItem
 * @property {string} id     — opaque identifier passed back to onSelect.
 * @property {string} label  — text matched against the query and shown in the row.
 * @property {string} [accent] — optional CSS color string for the row swatch.
 */

/**
 * Open the palette. No-op if it is already open or items is empty.
 *
 * @param {PaletteItem[]} items
 * @param {(id: string) => void} onSelect
 * @param {{ placeholder?: string, emptyText?: string }} [options]
 */
export function openCommandPalette(items, onSelect, options = {}) {
  if (paletteState) return;
  if (!items || items.length === 0) return;

  const placeholder = options.placeholder ?? 'Type to search…';
  const emptyText = options.emptyText ?? 'No matches';

  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'command-palette-dialog';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'command-palette-input';
  input.placeholder = placeholder;
  input.value = '';
  input.spellcheck = false;
  input.autocomplete = 'off';

  const list = document.createElement('div');
  list.className = 'command-palette-list';
  list.setAttribute('role', 'listbox');

  dialog.append(input, list);
  overlay.append(dialog);

  // Mousedown anywhere inside the dialog (other than the input) would
  // otherwise blur the input. Preventing default keeps focus pinned.
  dialog.addEventListener('mousedown', (event) => {
    if (event.target !== input) {
      event.preventDefault();
    }
  });

  // `ignoreLocation` so a substring anywhere in the label matches;
  // `includeMatches` so we can highlight the matching characters.
  const fuse = new Fuse(items, {
    keys: ['label'],
    threshold: 0.4,
    ignoreLocation: true,
    includeMatches: true,
  });

  let highlightedIndex = 0;
  let currentResults = [];

  function selectedItem() {
    const result = currentResults[highlightedIndex];
    return result ? result.item : null;
  }

  function updateHighlight() {
    const rows = list.querySelectorAll('.command-palette-item');
    rows.forEach((el, idx) => {
      const isOn = idx === highlightedIndex;
      el.classList.toggle('is-highlighted', isOn);
      el.setAttribute('aria-selected', String(isOn));
      if (isOn) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function renderRow(result, idx) {
    const { item, matches } = result;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'command-palette-item';
    row.setAttribute('role', 'option');
    row.dataset.index = String(idx);

    if (item.accent) {
      const swatch = document.createElement('span');
      swatch.className = 'command-palette-swatch';
      swatch.style.backgroundColor = item.accent;
      row.append(swatch);
    }

    const label = document.createElement('span');
    label.className = 'command-palette-label';
    label.append(...renderHighlightedLabel(item.label, matches));
    row.append(label);

    // Use mousedown (not click) so the input never blurs before we act.
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      commit(item.id);
    });
    row.addEventListener('mousemove', () => {
      if (highlightedIndex !== idx) {
        highlightedIndex = idx;
        updateHighlight();
      }
    });

    return row;
  }

  function renderList() {
    list.replaceChildren();
    if (currentResults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = emptyText;
      list.append(empty);
      return;
    }
    for (let i = 0; i < currentResults.length; i++) {
      list.append(renderRow(currentResults[i], i));
    }
    updateHighlight();
  }

  function applyQuery(query) {
    const trimmed = query.trim();
    if (!trimmed) {
      // Empty query: show every item in its original order, unhighlighted.
      currentResults = items.map((item) => ({ item, matches: [] }));
    } else {
      currentResults = fuse.search(trimmed);
    }
    highlightedIndex = 0;
    renderList();
  }

  function commit(id) {
    closeCommandPalette();
    onSelect(id);
  }

  input.addEventListener('input', () => applyQuery(input.value));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (currentResults.length > 0) {
        highlightedIndex = (highlightedIndex + 1) % currentResults.length;
        updateHighlight();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (currentResults.length > 0) {
        highlightedIndex =
          (highlightedIndex - 1 + currentResults.length) % currentResults.length;
        updateHighlight();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = selectedItem();
      if (item) {
        commit(item.id);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    }
  });

  // Click on the dimmed backdrop closes the palette; clicks inside the
  // dialog are handled by their own listeners.
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
      closeCommandPalette();
    }
  });

  document.body.append(overlay);
  applyQuery('');
  input.focus();

  paletteState = { overlay };
}

export function closeCommandPalette() {
  if (!paletteState) return;
  paletteState.overlay.remove();
  paletteState = null;
}

export function isCommandPaletteOpen() {
  return paletteState !== null;
}

/**
 * Whether the keyboard event is the canonical palette toggle hotkey
 * (Ctrl+Shift+O on Windows/Linux, Cmd+Shift+O on macOS).
 */
export function isCommandPaletteHotkey(event, platform) {
  if (event.key.toLowerCase() !== 'o') return false;
  if (event.altKey || !event.shiftKey) return false;
  if (platform === 'darwin') {
    return event.metaKey && !event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
}

function renderHighlightedLabel(label, matches) {
  const indices = [];
  for (const m of matches ?? []) {
    if (m.key === 'label') {
      indices.push(...m.indices);
    }
  }
  if (indices.length === 0) {
    return [document.createTextNode(label)];
  }

  // Merge overlapping / adjacent ranges into contiguous spans.
  indices.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of indices) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  const nodes = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      nodes.push(document.createTextNode(label.slice(cursor, start)));
    }
    const span = document.createElement('span');
    span.className = 'command-palette-match';
    span.textContent = label.slice(start, end + 1);
    nodes.push(span);
    cursor = end + 1;
  }
  if (cursor < label.length) {
    nodes.push(document.createTextNode(label.slice(cursor)));
  }
  return nodes;
}
