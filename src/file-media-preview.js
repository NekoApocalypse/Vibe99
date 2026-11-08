import { openImageViewer } from './diagram-viewer.js';

const MAX_BYTES = 16 * 1024 * 1024;
const MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
export function decodeMedia(file) {
  if (!MIMES.has(file.mime) || typeof file.data !== 'string' || file.data.length > 22369624) throw Error('Unsupported or oversized preview file (16 MiB limit).');
  const raw = atob(file.data);
  if (raw.length > MAX_BYTES) throw Error('File exceeds the 16 MiB preview limit.');
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

/** One owned renderer per document; workers, canvases and URLs die with the pane. */
export function createFileMediaPreview({ container, controlsHost, onError }) {
  let revision = 0, disposed = false, url = null, closeViewer = null, loadingTask = null;
  let pdf = null, renderTask = null, pageNumber = 1, zoom = null, pageRevision = 0, resizeTimer;
  let toolbar, viewport, label, pageInput, canvas;
  const fail = error => onError(error instanceof Error ? error : Error(String(error)));
  function clear() {
    revision++; pageRevision++;
    clearTimeout(resizeTimer); closeViewer?.(); closeViewer = null;
    renderTask?.cancel(); renderTask = null;
    if (loadingTask) void loadingTask.destroy().catch(() => {});
    loadingTask = null; pdf = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    toolbar?.remove();
    canvas = null; toolbar = null; viewport = null;
    container.replaceChildren();
  }
  async function draw() {
    if (!pdf || disposed || !viewport?.clientWidth) return;
    const current = ++pageRevision, document = pdf;
    renderTask?.cancel(); renderTask = null;
    const targetViewport = viewport;
    try {
      const page = await document.getPage(pageNumber);
      if (current !== pageRevision || document !== pdf) return;
      const base = page.getViewport({ scale: 1 });
      const scale = zoom ?? Math.min(2, Math.max(.05, (targetViewport.clientWidth - 32) / base.width));
      const view = page.getViewport({ scale });
      // Bound allocation regardless of PDF dimensions, zoom or monitor scale.
      const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (view.width * view.height)), 8192 / view.width, 8192 / view.height);
      const next = window.document.createElement('canvas');
      next.setAttribute('aria-label', `PDF page ${pageNumber} of ${document.numPages}`);
      next.width = Math.max(1, Math.floor(view.width * density)); next.height = Math.max(1, Math.floor(view.height * density));
      next.style.width = `${view.width}px`; next.style.height = `${view.height}px`;
      const task = page.render({ canvasContext: next.getContext('2d'), viewport: view, transform: [density, 0, 0, density, 0, 0] });
      renderTask = task;
      await task.promise;
      if (current !== pageRevision || document !== pdf) { next.width = 0; next.height = 0; return; }
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      canvas = next; targetViewport.replaceChildren(canvas);
      label.textContent = `/ ${document.numPages} · ${Math.round(scale * 100)}%`;
      pageInput.value = String(pageNumber);
      toolbar.querySelector('[data-action="previous"]').disabled = pageNumber <= 1;
      toolbar.querySelector('[data-action="next"]').disabled = pageNumber >= document.numPages;
      renderTask = null;
      return true;
    } catch (error) {
      if (current === pageRevision && document === pdf && error?.name !== 'RenderingCancelledException') fail(error);
      return false;
    }
  }
  const observer = new ResizeObserver(() => {
    if (pdf && zoom === null) { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => void draw(), 120); }
  });
  observer.observe(container);
  async function render(file) {
    clear(); const current = revision;
    const bytes = decodeMedia(file);
    container.className = 'file-media-preview'; container.tabIndex = 0;
    if (file.mime !== 'application/pdf') {
      container.setAttribute('aria-label', 'Image preview');
      const image = document.createElement('img');
      image.alt = file.path.replaceAll('\\', '/').split('/').pop();
      image.tabIndex = 0; image.setAttribute('role', 'button'); image.setAttribute('aria-label', `Expand image: ${image.alt}`);
      image.title = 'Click to expand · scroll to zoom · drag to pan';
      url = URL.createObjectURL(new Blob([bytes], { type: file.mime })); image.src = url;
      container.append(image);
      image.addEventListener('click', () => { closeViewer = openImageViewer({ image, focusFallback: container }); });
      image.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); image.click(); } });
      await image.decode().catch(() => { throw Error('This image could not be decoded.'); });
      if (current === revision && image.naturalWidth * image.naturalHeight > 100_000_000) { image.remove(); throw Error('Image dimensions exceed the 100 megapixel limit.'); }
      return;
    }
    container.setAttribute('aria-label', 'PDF preview');
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    if (disposed || current !== revision) return;
    GlobalWorkerOptions.workerSrc = workerUrl;
    const asset = folder => new URL(`pdfjs/${folder}/`, document.baseURI).href;
    loadingTask = getDocument({ data: bytes, cMapUrl: asset('cmaps'), cMapPacked: true,
      standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm'), iccUrl: asset('iccs'),
      enableXfa: false, isEvalSupported: false });
    const task = loadingTask;
    const password = new Promise((_, reject) => { task.onPassword = () => {
      reject(Error('Password-protected PDFs are not supported.'));
      void task.destroy().catch(() => {});
    }; });
    const loaded = await Promise.race([task.promise, password]);
    if (disposed || current !== revision) return;
    pdf = loaded;
    pageNumber = 1; zoom = null;
    toolbar = document.createElement('div'); toolbar.className = 'file-media-toolbar';
    toolbar.innerHTML = `<button data-action="previous" aria-label="Previous PDF page">←</button><input type="number" min="1" aria-label="PDF page"><span></span><button data-action="next" aria-label="Next PDF page">→</button><button data-action="out" aria-label="Zoom PDF out">−</button><button data-action="in" aria-label="Zoom PDF in">+</button><button data-action="fit">Fit width</button>`;
    label = toolbar.querySelector('span'); pageInput = toolbar.querySelector('input'); pageInput.max = String(pdf.numPages);
    viewport = document.createElement('div'); viewport.className = 'file-media-viewport';
    controlsHost.append(toolbar);
    container.append(viewport);
    pageInput.addEventListener('change', () => { pageNumber = Math.max(1, Math.min(pdf.numPages, Number(pageInput.value) || 1)); viewport.scrollTop = 0; void draw(); });
    toolbar.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.action;
      if (!action || !pdf) return;
      if (action === 'previous' || action === 'next') { pageNumber = Math.max(1, Math.min(pdf.numPages, pageNumber + (action === 'next' ? 1 : -1))); viewport.scrollTop = 0; }
      if (action === 'fit') zoom = null;
      if (action === 'in' || action === 'out') {
        const fitted = Number(label.textContent.match(/([\d]+)%/)?.[1] || 100) / 100;
        zoom = Math.max(.1, Math.min(4, (zoom ?? fitted) * (action === 'in' ? 1.25 : .8)));
      }
      void draw();
    });
    if (await draw() === false) throw Error('This PDF page could not be rendered.');
  }
  return { render, clear, focus() { container.focus({ preventScroll: true }); },
    dispose() { disposed = true; observer.disconnect(); clear(); } };
}
