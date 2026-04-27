/**
 * Hint Bar — mode-aware keyboard shortcut hints
 *
 * Displays relevant keyboard shortcuts for the current mode in the status bar.
 */

/**
 * Render the hint bar based on current mode and settings.
 *
 * @param {Array} keymap - The keymap from ShortcutsRegistry.getActiveKeymap()
 * @param {string} currentMode - The current mode ('terminal' or 'nav')
 * @param {string} focusedPaneLabel - The label of the focused pane (for terminal mode)
 * @param {boolean} isMinimal - Whether to show minimal hints (compact mode)
 * @param {string} platform - The platform ('linux', 'darwin', 'win32')
 * @returns {object} - { modeLabel: string, hintsHtml: string }
 */
export function renderHintBar(keymap, currentMode, focusedPaneLabel, isMinimal = false, platform = 'linux') {
  // Filter keymap entries for current mode
  let entries = keymap.filter(entry =>
    (entry.mode === currentMode) || (currentMode === 'terminal' && entry.mode === '*')
  );

  // Special handling: merge Ctrl+Tab and Ctrl+Shift+Tab hints
  if (currentMode === 'terminal') {
    const hasCycleRecent = entries.some(e => e.action === 'cycleRecent');
    const hasCycleRecentReverse = entries.some(e => e.action === 'cycleRecentReverse');
    if (hasCycleRecent && hasCycleRecentReverse) {
      entries = entries.filter(e => e.action !== 'cycleRecentReverse');
      const cycleEntry = entries.find(e => e.action === 'cycleRecent');
      if (cycleEntry) {
        cycleEntry.hint = 'Ctrl+Tab recent';
      }
    }
  }

  // For nav mode, merge entries with same action and show hints directly
  if (currentMode === 'nav') {
    entries = mergeNavModeHints(entries);
  }

  // Show at most 6 items; only show entries with hint text
  const visible = entries.filter(entry => entry.hint).slice(0, 6);

  // Build hints HTML
  let hintsHtml = '';
  if (isMinimal) {
    // Minimal mode: just show mode name and "?"
    hintsHtml = '<span class="hint-minimal">?</span>';
  } else {
    // Normal mode: show all hints
    hintsHtml = visible
      .map(entry => {
        // For nav mode, hint is already in display format
        if (currentMode === 'nav' && entry.mode === 'nav') {
          return `<span class="hint">${entry.hint}</span>`;
        }
        const chord = formatChordForHint(entry.chord, platform);
        return `<span class="hint"><kbd>${chord}</kbd> ${entry.hint}</span>`;
      })
      .join('<span class="hint-sep">·</span>');
  }

  // Determine mode label
  let modeLabel;
  if (currentMode === 'nav') {
    modeLabel = 'Navigation Mode';
  } else {
    modeLabel = focusedPaneLabel || 'Terminal';
  }

  return { modeLabel, hintsHtml };
}

/**
 * Merge nav mode hints that have the same action.
 * For example, 'h prev' and '← prev' become 'h/← prev'.
 */
function mergeNavModeHints(entries) {
  const actionMap = new Map();

  for (const entry of entries) {
    if (!entry.hint) continue;

    const parts = entry.hint.split(' ');
    if (parts.length < 2) {
      // Keep as-is if hint doesn't have key + description format
      if (!actionMap.has(entry.action)) {
        actionMap.set(entry.action, { ...entry, keys: [] });
      }
      continue;
    }

    const key = parts[0];
    const desc = parts.slice(1).join(' ');

    if (!actionMap.has(entry.action)) {
      actionMap.set(entry.action, { ...entry, keys: [key], description: desc });
    } else {
      const existing = actionMap.get(entry.action);
      existing.keys.push(key);
    }
  }

  // Rebuild entries with merged hints
  const merged = [];
  for (const [action, data] of actionMap) {
    if (data.keys.length > 0) {
      // Merge keys with '/' separator
      data.hint = `${data.keys.join('/')} ${data.description}`;
    }
    delete data.keys;
    delete data.description;
    merged.push(data);
  }

  // Keep original order (first occurrence of each action)
  const ordered = [];
  const seenActions = new Set();
  for (const entry of entries) {
    if (!entry.hint || !entry.action) continue;
    if (seenActions.has(entry.action)) continue;
    seenActions.add(entry.action);
    const mergedEntry = merged.find(e => e.action === entry.action);
    if (mergedEntry) {
      ordered.push(mergedEntry);
    }
  }

  return ordered;
}

/**
 * Format a chord string for display in the hint bar.
 * Uses the first alternative if there are multiple.
 * Prefers single characters over arrow key names.
 */
function formatChordForHint(chord, platform) {
  // Handle special chord patterns: '1..9' displays as '1-9'
  if (chord === '1..9') {
    return '1-9';
  }

  const alternatives = chord.split('|');

  // Prefer single character alternatives (like 'h', 'l') over arrow keys (like 'ArrowLeft')
  const singleCharAlt = alternatives.find(alt => {
    const parts = alt.trim().split('+');
    const key = parts[parts.length - 1].trim();
    return key.length === 1 && /^[a-zA-Z]$/.test(key);
  });

  const altToFormat = singleCharAlt || alternatives[0];
  const parts = altToFormat.split('+').map(p => p.trim());

  // Extract modifiers and key
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map(m => m.toLowerCase());

  const isMac = platform === 'darwin';
  const modSymbols = [];

  if (modifiers.includes('ctrl') || modifiers.includes('cmd') || modifiers.includes('meta')) {
    modSymbols.push(isMac ? '⌘' : 'Ctrl');
  }
  if (modifiers.includes('shift')) {
    modSymbols.push(isMac ? '⇧' : 'Shift');
  }
  if (modifiers.includes('alt') || modifiers.includes('option')) {
    modSymbols.push(isMac ? '⌥' : 'Alt');
  }

  // Format key for display
  let displayKey = key;
  if (key === ' ') {
    displayKey = 'Space';
  } else if (key === 'Home') {
    displayKey = 'Home';
  } else if (key === 'End') {
    displayKey = 'End';
  } else if (key === '?') {
    displayKey = '?';
  } else if (key.length === 1) {
    displayKey = key.toUpperCase();
  }

  return [...modSymbols, displayKey].join(isMac ? '' : '+');
}
