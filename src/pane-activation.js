// Consume the entire first pointer gesture, even if focusing repositions panes.
export function installPaneActivationGate({ activeId, activate }) {
  let activating = false;
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const paneId = event => event.target.closest?.('.pane[data-input-pane-id]')?.dataset.inputPaneId;
  window.addEventListener('pointerdown', event => {
    activating = false;
    const id = paneId(event);
    if (!id || id === activeId()) return;
    activating = true;
    consume(event);
    activate(id);
  }, true);
  for (const type of ['mousedown', 'mouseup', 'pointerup', 'contextmenu']) {
    window.addEventListener(type, event => { if (activating) consume(event); }, true);
  }
  for (const type of ['click', 'auxclick']) {
    window.addEventListener(type, event => {
      if (activating) { consume(event); activating = false; return; }
      const id = paneId(event);
      // Pointer activation is decided at pointerdown. A link may have opened
      // another pane on mouseup; do not focus its old source again on click.
      if (event.detail === 0 && id && id !== activeId()) { consume(event); activate(id); }
    }, true);
  }
  window.addEventListener('pointercancel', () => { activating = false; }, true);
  window.addEventListener('blur', () => { activating = false; });
}
