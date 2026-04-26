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
//     burst that follows is not "real" new content. Data arriving after
//     `noteResize` is treated as redraw residue until the pane has been
//     quiet for `resizeSettleMs`.
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
// After a resize, ignore incoming chunks until the pane has been silent
// for this long. Each chunk that arrives during the window is treated as
// SIGWINCH redraw residue and extends the window — i.e. we wait for the
// redraw burst to settle before resuming alert generation.
//
// Why "until quiet" rather than a fixed cap? Heavy multiplexers (zellij,
// tmux) can keep emitting redraw chunks well past any safe fixed cap, and
// a cap long enough to cover the worst case would feel sluggish on plain
// shells. An auto-extending window stays tight when the redraw is small
// and stretches only when the redraw demands it.
//
// Trade-off the user signed off on (VIB-29 follow-up): real activity that
// happens to land inside the post-resize window is dropped. False alerts
// from zellij/tmux redraws are far more annoying than missing a beat of
// output that just happened to coincide with a window resize.
const DEFAULT_RESIZE_SETTLE_MS = 2500;

/**
 * @typedef {object} PaneActivityWatcherOptions
 * @property {number} [settleMs]                — quiet period before alerting (ms).
 * @property {number} [resizeSettleMs]          — silence required to end the post-resize quiet window (ms).
 * @property {boolean} [globalEnabled]          — initial value for the global kill switch.
 * @property {(paneId: string) => void} [onAlert]
 * @property {(paneId: string) => void} [onClear]
 */

/**
 * @param {PaneActivityWatcherOptions} [options]
 */
export function createPaneActivityWatcher(options = {}) {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const resizeSettleMs = options.resizeSettleMs ?? DEFAULT_RESIZE_SETTLE_MS;
  const onAlert = options.onAlert;
  const onClear = options.onClear;

  // paneId -> { hasBeenFocused, timer, alerted, paneEnabled, resizeSettleTimer }
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
        resizeSettleTimer: null,
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
    if (s.resizeSettleTimer !== null) {
      clearTimeout(s.resizeSettleTimer);
      s.resizeSettleTimer = null;
    }
    if (s.alerted) {
      s.alerted = false;
      onClear?.(paneId);
    }
  }

  function isActive(paneId, s) {
    return globalEnabled && s.paneEnabled;
  }

  // (Re)start the post-resize silence countdown. Called both from `noteResize`
  // (to open the window) and from `noteData` while the window is open (to
  // extend it for the duration of the redraw burst).
  function armResizeSettle(s) {
    if (s.resizeSettleTimer !== null) clearTimeout(s.resizeSettleTimer);
    s.resizeSettleTimer = setTimeout(() => {
      s.resizeSettleTimer = null;
    }, resizeSettleMs);
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
      // Inside the post-resize window: this chunk is almost certainly
      // SIGWINCH redraw residue. Don't fire an alert and don't even start
      // a settle timer — instead extend the resize window so we keep
      // ignoring chunks until the redraw burst itself goes silent.
      if (s.resizeSettleTimer !== null) {
        armResizeSettle(s);
        return;
      }
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
     * Mark a pane as having just been resized. Opens a quiet window that
     * stays open as long as redraw chunks keep arriving (each chunk
     * extends it) and closes once the pane has been silent for
     * `resizeSettleMs`. Any in-flight content burst is dropped — its
     * buffer position has been overwritten by the redraw, and we'd rather
     * lose a beat than fire a false alert when the burst ends inside the
     * redraw stream.
     */
    noteResize(paneId) {
      const s = ensure(paneId);
      if (s.timer !== null) {
        clearTimeout(s.timer);
        s.timer = null;
      }
      armResizeSettle(s);
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
