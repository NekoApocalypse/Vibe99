/**
 * Actions — the table of side-effects each keymap row may invoke.
 *
 * Actions are pure dispatchers: they know nothing about keyboard events,
 * modifiers, or modes. The dispatcher (input/dispatcher.js) is the only
 * thing that bridges between a key press and an action call.
 *
 * Adding a new shortcut means:
 *   1. Add a row to KEYMAP in keymap.js with a fresh action name.
 *   2. Add a handler with that name to the table returned here.
 * The shortcut is then live everywhere — settings UI, status hints, dispatch.
 *
 * `deps` injects the renderer-level callbacks so this file has no transitive
 * import on the rest of the renderer; it's testable in isolation.
 */

export function createActions(deps) {
  return {
    recoverMouseInput: () => deps.recoverMouseInput(),
    // Pane lifecycle / focus
    newPane: () => deps.addPane(),
    enterNav: () => deps.enterNavigationMode(),
    cycleRecent: () => deps.cycleToRecentPane({ reverse: false }),
    cycleRecentReverse: () => deps.cycleToRecentPane({ reverse: true }),
    navigateLeft: () => deps.navigateLeft(),
    navigateRight: () => deps.navigateRight(),

    // Clipboard
    copyTerminalSelection: () => deps.copyTerminalSelection(),
    pasteIntoTerminal: () => { void deps.pasteIntoTerminal(); },

    // Command palette
    toggleCommandPalette: () => {
      if (deps.isCommandPaletteOpen()) {
        deps.closeCommandPalette();
      } else {
        deps.openTabSwitcher();
      }
    },

    // Navigation mode
    focusPrev: () => deps.moveFocus(-1),
    focusNext: () => deps.moveFocus(1),
    commitFocus: () => deps.focusPane(deps.getFocusedPaneId()),
    cancelNav: () => deps.cancelNavigationMode(),

    // Navigation mode — movement (VIB-33)
    focusFirst:    () => deps.focusPaneAt(0),
    focusLast:     () => deps.focusPaneAt(deps.getPaneCount() - 1),
    jumpTo:        (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= deps.getPaneCount()) {
        const paneId = deps.getPaneIdAt(n - 1);
        if (paneId) deps.focusPane(paneId);
      }
    },

    // Navigation mode — editing (VIB-33)
    closePane:   () => deps.requestClosePane(deps.getFocusedPaneId()),
    renamePane:  () => deps.startInlineRename(deps.getFocusedPaneId()),
  };
}
