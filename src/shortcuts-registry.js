/**
 * Keyboard Shortcuts Registry
 *
 * Compatibility wrapper for the legacy `shortcuts-ui.js` consumer. The single
 * source of truth for shortcuts now lives in `input/keymap.js` — this module
 * tracks user overrides on top of that table and exposes an `id`-keyed map in
 * the legacy `{ key, modifiers, action }` shape so the existing settings UI
 * keeps working unchanged.
 *
 * The dispatcher reads its keymap through `getActiveKeymap()` so overrides are
 * picked up without rebinding event listeners.
 */

import { KEYMAP, parseChord, formatChord } from './input/keymap.js';

// Customizable rows are those with an `id` field. Non-customizable rows
// (palette, cycle-recent, digit ranges like 1..9) live in the keymap but are
// not exposed through this legacy API.
function customizableRows() {
  return KEYMAP.filter((row) => typeof row.id === 'string' && !row.chord.includes('..'));
}

function chordToLegacy(chord) {
  const [first] = parseChord(chord);
  const modifiers = [];
  if (first.ctrl)  modifiers.push('ctrl');
  if (first.shift) modifiers.push('shift');
  if (first.alt)   modifiers.push('alt');
  return { key: normalizeLegacyKey(first.key), modifiers };
}

function legacyToChord({ key, modifiers }) {
  const tokens = [];
  if (modifiers.includes('ctrl'))  tokens.push('Ctrl');
  if (modifiers.includes('shift')) tokens.push('Shift');
  if (modifiers.includes('alt'))   tokens.push('Alt');
  tokens.push(key);
  return tokens.join('+');
}

function normalizeLegacyKey(key) {
  // Legacy storage keeps single letters lowercase (e.g. 'b'); other keys
  // (ArrowLeft, Enter, Tab) are preserved verbatim.
  return typeof key === 'string' && key.length === 1 ? key.toLowerCase() : key;
}

// Default legacy-shape map derived from KEYMAP defaults.
const DEFAULTS_BY_ID = {};
for (const row of customizableRows()) {
  DEFAULTS_BY_ID[row.id] = {
    ...chordToLegacy(row.chord),
    action: row.action,
    platform: 'all',
  };
}

/**
 * Public for tests / external introspection — same shape as the old constant
 * even though it's now derived from the keymap table.
 */
export const DEFAULT_SHORTCUTS = { ...DEFAULTS_BY_ID };

let overrides = {}; // id -> { key, modifiers }

function legacyShortcut(row) {
  const override = overrides[row.id];
  const base = chordToLegacy(row.chord);
  return {
    key: override?.key ?? base.key,
    modifiers: override?.modifiers ?? base.modifiers,
    action: row.action,
    platform: 'all',
    mode: row.mode,
  };
}

/**
 * The active keymap, with user overrides applied. Re-computed whenever
 * overrides change so the dispatcher's parsed-chord cache invalidates.
 */
let activeKeymap = computeActiveKeymap();

function computeActiveKeymap() {
  const result = KEYMAP.map((row) => {
    if (!row.id) return row;
    const override = overrides[row.id];
    if (!override) {
      // No override, keep original chord with all alternatives
      return row;
    }

    // Check if the override is identical to the default
    const defaultLegacy = chordToLegacy(row.chord);
    const overrideMatchesDefault =
      override.key === defaultLegacy.key &&
      JSON.stringify(override.modifiers) === JSON.stringify(defaultLegacy.modifiers);

    // If override matches default, keep original chord to preserve alternatives
    if (overrideMatchesDefault) {
      return row;
    }

    // Override is different from default, apply it
    return { ...row, chord: legacyToChord(override) };
  });
  return result;
}

function refreshActiveKeymap() {
  activeKeymap = computeActiveKeymap();
}

/**
 * Returns the active keymap (defaults + overrides). Used by the dispatcher.
 * Returns a new array reference whenever overrides change.
 */
export function getActiveKeymap() {
  return activeKeymap;
}

// ---------------------------------------------------------------------------
// Legacy public API consumed by `shortcuts-ui.js`
// ---------------------------------------------------------------------------

export function getKeyboardShortcuts() {
  const out = {};
  for (const row of customizableRows()) {
    out[row.id] = legacyShortcut(row);
  }
  return out;
}

export function updateKeyboardShortcut(id, shortcut) {
  if (!DEFAULTS_BY_ID[id]) return;
  overrides[id] = {
    key: shortcut.key,
    modifiers: [...(shortcut.modifiers ?? [])],
  };
  refreshActiveKeymap();
}

export function parseShortcutEvent(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey && !event.ctrlKey) modifiers.push('ctrl'); // Cmd ≡ Ctrl
  if (event.shiftKey) modifiers.push('shift');
  if (event.altKey) modifiers.push('alt');
  return { key: event.key, modifiers };
}

export function formatShortcut(shortcut, platform = 'linux') {
  return formatChord(legacyToChord(shortcut), platform);
}

export function shortcutsConflict(s1, s2) {
  return normalizeLegacyKey(s1.key) === normalizeLegacyKey(s2.key) &&
    JSON.stringify([...s1.modifiers].sort()) === JSON.stringify([...s2.modifiers].sort());
}

export function findConflict(newShortcut, excludeId = null) {
  const all = getKeyboardShortcuts();
  for (const [id, shortcut] of Object.entries(all)) {
    if (id !== excludeId && shortcutsConflict(newShortcut, shortcut)) {
      return id;
    }
  }
  return null;
}

export function resetShortcutsToDefaults() {
  overrides = {};
  refreshActiveKeymap();
}

export function loadShortcutsFromSettings(settings, version = 0) {
  overrides = {};
  if (settings && typeof settings.shortcuts === 'object' && settings.shortcuts !== null) {
    for (const [id, shortcut] of Object.entries(settings.shortcuts)) {
      if (DEFAULTS_BY_ID[id] && shortcut && Array.isArray(shortcut.modifiers)) {
        // Skip entries that match the current default — old saved defaults
        // should not block keymap updates.
        // Older releases could persist the former navigation default alongside overrides.
        if (version < 5 && id === 'navigation-mode' && shortcutsConflict(shortcut, { key: 'b', modifiers: ['ctrl'] })) continue;
        const defaultLegacy = DEFAULTS_BY_ID[id];
        if (
          normalizeLegacyKey(shortcut.key) === normalizeLegacyKey(defaultLegacy.key) &&
          JSON.stringify([...shortcut.modifiers].sort()) ===
            JSON.stringify([...defaultLegacy.modifiers].sort())
        ) {
          continue;
        }
        overrides[id] = {
          key: shortcut.key,
          modifiers: [...shortcut.modifiers],
        };
      }
    }
  }
  refreshActiveKeymap();
}

export function getShortcutsForSave() {
  const out = {};
  for (const [id, override] of Object.entries(overrides)) {
    out[id] = {
      key: override.key,
      modifiers: [...override.modifiers],
    };
  }
  return out;
}
