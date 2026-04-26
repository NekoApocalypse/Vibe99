/**
 * Keyboard Shortcuts Registry Module
 *
 * Manages keyboard shortcut definitions, validation, and persistence.
 * This module handles the core shortcut logic independently of UI concerns.
 */

/**
 * Default keyboard shortcuts configuration
 * Keys use platform-agnostic notation:
 * - "ctrl" represents Ctrl on Windows/Linux and Cmd on macOS
 * - "shift" represents Shift key
 * - "alt" represents Alt/Option key
 * - Single character represents the key to press
 */
export const DEFAULT_SHORTCUTS = {
  'new-tab': { key: 'n', modifiers: ['ctrl'], platform: 'all', action: 'addPane' },
  'navigation-mode': { key: 'b', modifiers: ['ctrl'], platform: 'all', action: 'enterNavigationMode' },
  'copy': { key: 'c', modifiers: ['ctrl', 'shift'], platform: 'all', action: 'copyTerminalSelection' },
  'paste': { key: 'v', modifiers: ['ctrl', 'shift'], platform: 'all', action: 'pasteIntoTerminal' },
  'move-left': { key: 'ArrowLeft', modifiers: [], platform: 'all', action: 'moveFocusLeft' },
  'move-right': { key: 'ArrowRight', modifiers: [], platform: 'all', action: 'moveFocusRight' },
  'focus-terminal': { key: 'Enter', modifiers: [], platform: 'all', action: 'focusTerminal' },
};

/**
 * Current keyboard shortcuts (loaded from settings or defaults)
 */
let keyboardShortcuts = { ...DEFAULT_SHORTCUTS };

/**
 * Get the current keyboard shortcuts
 */
export function getKeyboardShortcuts() {
  return { ...keyboardShortcuts };
}

/**
 * Update a keyboard shortcut
 */
export function updateKeyboardShortcut(id, shortcut) {
  if (DEFAULT_SHORTCUTS[id]) {
    keyboardShortcuts[id] = { ...DEFAULT_SHORTCUTS[id], ...shortcut };
  }
}

/**
 * Parse a keyboard event into a shortcut identifier
 */
export function parseShortcutEvent(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey) modifiers.push('ctrl'); // Treat Cmd as ctrl on macOS
  if (event.shiftKey) modifiers.push('shift');
  if (event.altKey) modifiers.push('alt');

  const key = event.key;
  return { key, modifiers };
}

/**
 * Check if a keyboard event matches a shortcut definition
 */
export function matchesShortcut(event, shortcut) {
  const parsed = parseShortcutEvent(event);

  // Check key match
  if (parsed.key !== shortcut.key) {
    return false;
  }

  // Check modifiers match
  const shortcutModifiers = new Set(shortcut.modifiers);
  const eventModifiers = new Set(parsed.modifiers);

  // Check if all required modifiers are present
  for (const mod of shortcutModifiers) {
    if (!eventModifiers.has(mod)) {
      return false;
    }
  }

  // Check if no extra modifiers are present
  for (const mod of eventModifiers) {
    if (!shortcutModifiers.has(mod)) {
      return false;
    }
  }

  return true;
}

/**
 * Format a shortcut for display (e.g., "Ctrl+Shift+C")
 */
export function formatShortcut(shortcut, platform = 'linux') {
  const modifiers = shortcut.modifiers.map(m => {
    switch (m) {
      case 'ctrl': return platform === 'darwin' ? '⌘' : 'Ctrl';
      case 'shift': return platform === 'darwin' ? '⇧' : 'Shift';
      case 'alt': return platform === 'darwin' ? '⌥' : 'Alt';
      default: return m;
    }
  });

  const key = shortcut.key === ' ' ? 'Space' : shortcut.key;
  return [...modifiers, key].join(platform === 'darwin' ? '' : '+');
}

/**
 * Check if two shortcuts conflict (have the same key combination)
 */
export function shortcutsConflict(shortcut1, shortcut2) {
  return shortcut1.key === shortcut2.key &&
         JSON.stringify(shortcut1.modifiers.sort()) === JSON.stringify(shortcut2.modifiers.sort());
}

/**
 * Find which shortcut ID conflicts with a given shortcut definition
 */
export function findConflict(newShortcut, excludeId = null) {
  for (const [id, shortcut] of Object.entries(keyboardShortcuts)) {
    if (id !== excludeId && shortcutsConflict(newShortcut, shortcut)) {
      return id;
    }
  }
  return null;
}

/**
 * Reset keyboard shortcuts to defaults
 */
export function resetShortcutsToDefaults() {
  keyboardShortcuts = { ...DEFAULT_SHORTCUTS };
}

/**
 * Load keyboard shortcuts from settings
 */
export function loadShortcutsFromSettings(settings) {
  if (settings.shortcuts && typeof settings.shortcuts === 'object') {
    // Merge user shortcuts with defaults, keeping user-defined ones
    keyboardShortcuts = { ...DEFAULT_SHORTCUTS };
    for (const [id, shortcut] of Object.entries(settings.shortcuts)) {
      if (DEFAULT_SHORTCUTS[id]) {
        keyboardShortcuts[id] = shortcut;
      }
    }
  } else {
    keyboardShortcuts = { ...DEFAULT_SHORTCUTS };
  }
}

/**
 * Get keyboard shortcuts data for saving to settings
 */
export function getShortcutsForSave() {
  return keyboardShortcuts;
}

/**
 * Execute a shortcut action by calling the appropriate handler
 */
export function executeShortcutAction(action, handlers) {
  const handler = handlers[action];
  if (handler) {
    return handler();
  }
  return null;
}