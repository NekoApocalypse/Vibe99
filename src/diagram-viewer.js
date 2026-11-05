// Owlet interaction model, adapted to Vibe99's DOM renderer and native dialog.
// Move Mermaid SVGs to keep IDs unique; clone image snapshots for live refresh.
import './diagram-viewer.css';

let activeViewer = null;

export function openDiagramViewer({ svg, trigger, focusFallback, title = 'Mermaid diagram' }) {
  return openMediaViewer({ media: svg, trigger, focusFallback, title });
}

export function openImageViewer({ image, trigger = image, focusFallback }) {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  // Keep the inline image in place: image-only refreshes must still find it.
  const snapshot = image.cloneNode(true);
  snapshot.removeAttribute('role'); snapshot.removeAttribute('tabindex');
  snapshot.removeAttribute('aria-label'); snapshot.removeAttribute('title');
  snapshot.loading = 'eager';
  return openMediaViewer({ media: snapshot, trigger, focusFallback, title: image.alt || 'Image',
    imageSize: { width: image.naturalWidth, height: image.naturalHeight } });
}

function openMediaViewer({ media, trigger, focusFallback, title, imageSize }) {
  activeViewer?.();
  const kind = imageSize ? 'image' : 'diagram';
  const origin = media.parentNode;
  const anchor = document.createComment('expanded diagram');
  const bounds = media.getBoundingClientRect();
  const viewBox = media.viewBox?.baseVal;
  const width = imageSize?.width || viewBox?.width || bounds.width || 800;
  const height = imageSize?.height || viewBox?.height || bounds.height || 600;
  const style = media.getAttribute('style');
  origin?.insertBefore(anchor, media);
  const dialog = document.createElement('dialog');
  dialog.className = 'diagram-viewer';
  dialog.setAttribute('aria-label', imageSize ? 'Expanded image' : 'Expanded Mermaid diagram');
  dialog.innerHTML = `<div class="diagram-viewer-toolbar">
    <strong></strong><span class="diagram-help">Snapshot · Drag to pan · Scroll to zoom</span>
    <button type="button" data-action="out" aria-label="Zoom ${kind} out" title="Zoom out (-)">−</button>
    <button type="button" data-action="actual" aria-label="${imageSize ? 'Image' : 'Diagram'} actual size" title="Actual size (1)">100%</button>
    <button type="button" data-action="in" aria-label="Zoom ${kind} in" title="Zoom in (+)">+</button>
    <button type="button" data-action="fit" aria-label="Fit ${kind}" title="Fit (0)">Fit</button>
    <button type="button" data-action="close" aria-label="Close ${kind}" title="Close (Esc)">Close</button>
    </div><div class="diagram-canvas" tabindex="0" aria-label="${kind} canvas; drag to pan, scroll to zoom"><div class="diagram-transform"></div></div>`;
  dialog.querySelector('strong').textContent = title;
  const canvas = dialog.querySelector('.diagram-canvas');
  const transform = dialog.querySelector('.diagram-transform');
  const percentage = dialog.querySelector('[data-action="actual"]');
  transform.style.width = `${width}px`;
  transform.style.height = `${height}px`;
  media.style.cssText = 'width:100%;height:100%;max-width:none;display:block';
  transform.append(media);
  document.body.append(dialog);
  let scale = 1, x = 0, y = 0, drag = null, closed = false;
  const paint = () => {
    transform.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    percentage.textContent = `${Math.round(scale * 100)}%`;
  };
  const fit = () => {
    scale = Math.max(0.01, Math.min(1, (canvas.clientWidth - 48) / width, (canvas.clientHeight - 48) / height));
    x = (canvas.clientWidth - width * scale) / 2;
    y = (canvas.clientHeight - height * scale) / 2;
    paint();
  };
  const zoom = (factor, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) => {
    const next = Math.max(0.01, Math.min(8, scale * factor));
    x = cx - (cx - x) * next / scale;
    y = cy - (cy - y) * next / scale;
    scale = next;
    paint();
  };
  const observer = new ResizeObserver(fit);
  function close() {
    if (closed) return;
    closed = true;
    observer.disconnect();
    if (style === null) media.removeAttribute('style'); else media.setAttribute('style', style);
    if (anchor.parentNode) anchor.replaceWith(media);
    dialog.close();
    dialog.remove();
    if (activeViewer === close) activeViewer = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else if (focusFallback?.isConnected) focusFallback.focus({ preventScroll: true });
  }
  const actions = { close, fit, in: () => zoom(1.25), out: () => zoom(0.8), actual: () => zoom(1 / scale) };
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) actions[action]();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', close);
  dialog.addEventListener('keydown', event => {
    // No app shortcuts or terminal input should leak through the modal.
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) event.preventDefault();
    const action = { Escape: 'close', '+': 'in', '=': 'in', '-': 'out', '0': 'fit', '1': 'actual' }[event.key];
    if (action) { event.preventDefault(); actions[action](); }
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      x += event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0;
      y += event.key === 'ArrowUp' ? 60 : event.key === 'ArrowDown' ? -60 : 0;
      paint();
    } else if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button, [tabindex="0"]')];
      const at = controls.indexOf(document.activeElement);
      event.preventDefault();
      controls[(at + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
    }
  });
  dialog.addEventListener('keyup', event => event.stopPropagation());
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    zoom(Math.exp(-Math.max(-1000, Math.min(1000, delta)) * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.classList.add('is-panning');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    x += event.clientX - drag.x; y += event.clientY - drag.y;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    paint();
  });
  const stopDrag = event => {
    drag = null;
    canvas.classList.remove('is-panning');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, stopDrag);
  canvas.addEventListener('dblclick', fit);
  activeViewer = close;
  dialog.showModal();
  fit();
  observer.observe(canvas);
  dialog.querySelector('[data-action="close"]').focus();
  return close;
}
