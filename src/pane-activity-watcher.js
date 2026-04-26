// Tracks whether each pane has "settled background activity" — output that
// arrived while the pane was off-screen, then quieted down. The watcher is
// pure logic with no DOM access; pair it with an alert renderer (e.g.
// `pane-alert-breathing-mask`) to surface the state visually. This split
// lets us swap the visual strategy later (border flash, tab badge, sound,
// …) without touching the detection logic.
//
// Lifecycle expected from the host:
//   - call `noteData(paneId)` for every chunk of PTY output
//   - call `noteResize(paneId)` whenever a pane's PTY is resized (window
//     resize, font-size change, layout change, …) — the SIGWINCH redraw
//     burst that follows is not "real" new content, and we mute data
//     notifications for a short window so it doesn't trip the alert.
//   - call `setFocus(paneId | null)` whenever the focused pane changes
//   - call `forget(paneId)` when a pane is destroyed
//
// Two enable/disable surfaces let the host turn detection off without
// having to gate `noteData` calls itself:
//   - `setGlobalEnabled(bool)`     — kill switch for the whole feature
//   - `setPaneEnabled(paneId, bool)` — opt a specific pane out
// Disabling either one immediately clears any pending timer and active
// alert for the affected pane(s).
//
// The watcher fires `onAlert(paneId)` once per "quiet period after burst",
// and `onClear(paneId)` whenever the alerted state ends (focus, forget,
// disable, or programmatic clear). Output that arrives before the user has
// *ever* focused a pane is ignored, so newly-spawned panes don't pulse
// from their own startup banner.

const DEFAULT_SETTLE_MS = 1500;
// Window after a resize during which incoming data is treated as redraw
// residue (SIGWINCH → shell redraw) rather than fresh content. Long enough
// to cover the redraw of typical TUI apps (vim, htop, tmux) without
// noticeably delaying genuine post-resize output detection.
const DEFAULT_RESIZE_QUIET_MS = 800;

/**
 * @typedef {object} PaneActivityWatcherOptions
 * @property {number} [settleMs]                — quiet period before alerting (ms).
 * @property {number} [resizeQuietMs]           — window after resize during which data is ignored (ms).
 * @property {boolean} [globalEnabled]          — initial value for the global kill switch.
 * @property {(paneId: string) => void} [onAlert]
 * @property {(paneId: string) => void} [onClear]
 */

/**
 * @param {PaneActivityWatcherOptions} [options]
 */
export function createPaneActivityWatcher(options = {}) {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const resizeQuietMs = options.resizeQuietMs ?? DEFAULT_RESIZE_QUIET_MS;
  const onAlert = options.onAlert;
  const onClear = options.onClear;

  // paneId -> { hasBeenFocused, timer, alerted, paneEnabled, resizeQuietUntil }
  const states = new Map();
  let focusedPaneId = null;
  let globalEnabled = options.globalEnabled ?? true;

  function ensure(paneId) {
    let s = states.get(paneId);
    if (!s) {
      s = {
        hasBeenFocused: false,
        timer: null,
        alerted: false,
        paneEnabled: true,
        resizeQuietUntil: 0,
      };
      states.set(paneId, s);
    }
    return s;
  }

  function clearState(paneId, s) {
    if (s.timer !== null) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    if (s.alerted) {
      s.alerted = false;
      onClear?.(paneId);
    }
  }

  function isActive(paneId, s) {
    return globalEnabled && s.paneEnabled;
  }

  return {
    /** Update which pane is currently focused (or null if none). */
    setFocus(paneId) {
      focusedPaneId = paneId;
      if (paneId == null) return;
      const s = ensure(paneId);
      s.hasBeenFocused = true;
      clearState(paneId, s);
    },

    /** Record a chunk of output for `paneId`. */
    noteData(paneId) {
      const s = ensure(paneId);
      if (!isActive(paneId, s)) return;
      if (!s.hasBeenFocused) return;
      if (paneId === focusedPaneId) return;
      if (s.alerted) return;
      // Within the resize quiet window, treat incoming chunks as SIGWINCH
      // redraw residue: don't alert, and don't extend any pending timer
      // — the genuine pre-resize burst (if any) keeps its own timer.
      if (Date.now() < s.resizeQuietUntil) return;
      if (s.timer !== null) clearTimeout(s.timer);
      s.timer = setTimeout(() => {
        s.timer = null;
        if (paneId === focusedPaneId) return;
        if (!isActive(paneId, s)) return;
        s.alerted = true;
        onAlert?.(paneId);
      }, settleMs);
    },

    /**
     * Mark a pane as having just been resized. Opens a brief quiet window
     * during which `noteData` calls are ignored, since a PTY resize triggers
     * SIGWINCH and the shell typically responds by redrawing the screen —
     * not "real" new output the user has missed.
     */
    noteResize(paneId) {
      const s = ensure(paneId);
      s.resizeQuietUntil = Date.now() + resizeQuietMs;
    },

    /** Drop all state for `paneId` (clears any pending timer or alert). */
    forget(paneId) {
      const s = states.get(paneId);
      if (!s) return;
      clearState(paneId, s);
      states.delete(paneId);
    },

    /**
     * Toggle activity monitoring for a single pane. When turned off the
     * pane stops generating new alerts and any existing alert is cleared.
     */
    setPaneEnabled(paneId, enabled) {
      const s = ensure(paneId);
      const next = !!enabled;
      if (s.paneEnabled === next) return;
      s.paneEnabled = next;
      if (!next) clearState(paneId, s);
    },

    /**
     * Global kill switch. When turned off all panes stop generating new
     * alerts and any existing alert is cleared. Per-pane enabled flags are
     * preserved so re-enabling globally restores their previous behavior.
     */
    setGlobalEnabled(enabled) {
      const next = !!enabled;
      if (globalEnabled === next) return;
      globalEnabled = next;
      if (!next) {
        for (const [paneId, s] of states) clearState(paneId, s);
      }
    },
  };
}
