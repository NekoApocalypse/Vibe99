// Breathing-mask alert strategy: a translucent overlay that pulses on top
// of a backgrounded pane to draw the eye, fading into the pane's accent
// color. This is one possible UI for `pane-activity-watcher`'s alert
// signal — swap it out for a different module (border flash, tab badge,
// …) without touching detection logic.
//
// API:
//   - `attach(paneEl, mountEl)`     mount the mask element under `mountEl`.
//   - `setAlerted(paneEl, alerted)` toggle the pulsing state on the pane.
//
// The pane root carries the state class so CSS can also style siblings
// (e.g. tab indicator) off the same selector if needed later.

import './pane-alert-breathing-mask.css';

const ALERTED_CLASS = 'has-pending-activity';

export function createBreathingMaskAlert() {
  return {
    /**
     * Mount the mask element. `mountEl` should be the positioned ancestor
     * the mask should fill (typically `.pane-body`).
     *
     * @param {HTMLElement} _paneEl
     * @param {HTMLElement} mountEl
     */
    attach(_paneEl, mountEl) {
      const mask = document.createElement('div');
      mask.className = 'pane-activity-mask';
      mountEl.append(mask);
    },

    /**
     * @param {HTMLElement} paneEl
     * @param {boolean} alerted
     */
    setAlerted(paneEl, alerted) {
      paneEl.classList.toggle(ALERTED_CLASS, alerted);
    },
  };
}
