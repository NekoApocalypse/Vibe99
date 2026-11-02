import { createMarkdownPreview } from './markdown-preview.js';
import { resolvePreviewPath } from './preview-paths.js';
import './preview-document.css';

/** A companion reader opened directly from a file link in an existing terminal. */
export function createPreviewDocument({ container, workspaceId, api, openExternalUrl, onTitle = () => {}, onClose = () => {} }) {
  const element = document.createElement('section');
  element.className = 'preview-workspace preview-document';
  element.setAttribute('aria-label', 'Document preview');
  element.innerHTML = `
    <header class="preview-document-header">
      <span class="preview-document-name">Document</span>
      <button class="preview-document-close" type="button" aria-label="Close document preview" title="Close document preview">Close</button>
    </header>
    <div class="preview-document-status" role="status" aria-live="polite" hidden>
      <span></span><button type="button" class="preview-document-retry" hidden>Retry</button>
    </div>
    <div class="preview-scroll"><article></article></div>`;
  container.appendChild(element);
  const name = element.querySelector('.preview-document-name');
  const closeButton = element.querySelector('.preview-document-close');
  const status = element.querySelector('.preview-document-status');
  const statusText = status.querySelector('span');
  const retryButton = element.querySelector('.preview-document-retry');
  const scroll = element.querySelector('.preview-scroll');
  let disposed = false, generation = 0, connection = null, requested = null, active = null, unlisten = null;
  let polling = false, busy = false, statusKind = '';
  const current = (scope, revision = generation) => !disposed && connection === scope && revision === generation;
  const request = (scope, method, args) => api.request({ workspaceId: scope.id, method, args });
  const closeScope = (scope) => scope && Promise.resolve().then(() => api.close({ workspaceId: scope.id })).catch(() => {});
  function showStatus(text = '', kind = '') {
    if (disposed) return;
    statusKind = kind;
    status.hidden = !text;
    statusText.textContent = text;
    status.classList.toggle('is-error', kind === 'error' || kind === 'stale');
    retryButton.hidden = kind !== 'error' && kind !== 'stale';
    element.setAttribute('aria-busy', String(kind === 'loading'));
  }
  const errorMessage = (error) => String(error?.message || error).replace(/^Error: /, '');
  function showName(path, target) {
    const title = path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'Document';
    name.textContent = title;
    name.title = target ? `${target}: ${path}` : path;
    onTitle(title);
  }
  const preview = createMarkdownPreview({
    container: element.querySelector('article'), openExternalUrl,
    readImage(args) {
      const scope = connection;
      if (!scope?.ready) return Promise.reject(new Error('Document connection is unavailable.'));
      return request(scope, 'image', args);
    },
    onOpen(path) { return requested && open({ ...requested, path }); },
    onError(error) { showStatus(errorMessage(error), 'error'); },
  });

  function ensureConnection({ target, root }) {
    if (connection && connection.target === target && (connection.inputRoot === root || connection.root === root) && !connection.failed) return connection;
    const previous = connection;
    const scope = { id: `${workspaceId}-${crypto.randomUUID()}`, target, inputRoot: root, root, ready: false, failed: false, promise: null };
    connection = scope;
    void closeScope(previous);
    scope.promise = Promise.resolve().then(() => current(scope) ? api.open({ workspaceId: scope.id, target, root }) : null).then((result) => {
      if (!current(scope)) { void closeScope(scope); return false; }
      scope.root = result?.root || root;
      scope.ready = true;
      return true;
    }).catch((error) => {
      scope.failed = true;
      void closeScope(scope);
      // Every open awaits the same connection promise and reports only if still current.
      throw error;
    });
    return scope;
  }

  async function load(options, { quiet = false, refreshImages = false } = {}) {
    if (disposed) return false;
    const revision = ++generation;
    let scope;
    try {
      const target = options?.target || null;
      const root = options?.root;
      const path = options?.path;
      if (typeof root !== 'string' || !root || typeof path !== 'string' || !path) throw new Error('The file link has no folder or document path.');
      if (target !== null && typeof target !== 'string') throw new Error('The SSH target is invalid.');
      const sameRoot = requested && (requested.root === root || (connection?.target === target && (connection.inputRoot === root || connection.root === root)));
      const pathRoot = sameRoot && connection ? connection.root : root;
      const contextChanged = !requested || requested.target !== target || !sameRoot || resolvePreviewPath(pathRoot, requested.path) !== resolvePreviewPath(pathRoot, path);
      requested = { target, root, path };
      if (contextChanged) { active = null; preview.clear(); scroll.scrollTop = 0; }
      busy = true;
      if (!quiet) { showName(path, target); showStatus(`Opening ${name.textContent}…`, 'loading'); }
      scope = ensureConnection(requested);
      if (!await scope.promise || !current(scope, revision)) return false;
      const resolvedPath = resolvePreviewPath(scope.root, path);
      const file = await request(scope, 'read', { path: resolvedPath, root: scope.root });
      if (!current(scope, revision)) return false;
      const finalPath = file.path || resolvedPath;
      preview.render({ text: file.text, path: finalPath, root: scope.root, refreshImages });
      active = { path: finalPath, stamp: file.stamp };
      requested = { target, root: scope.root, path: finalPath };
      showName(finalPath, target);
      showStatus();
      return true;
    } catch (error) {
      if (!disposed && revision === generation && (!scope || connection === scope)) showStatus(errorMessage(error), quiet ? 'stale' : 'error');
      return false;
    } finally { if (!disposed && revision === generation) busy = false; }
  }
  function open(options) { return load(options); }
  function refresh() { return requested ? load(requested, { refreshImages: true }) : Promise.resolve(false); }
  async function poll() {
    if (disposed || polling || busy || !connection?.ready || !active || document.hidden || !element.getClientRects().length || !element.clientWidth || !element.clientHeight) return;
    const scope = connection, file = active, revision = generation;
    polling = true;
    try {
      const stat = await request(scope, 'stat', { path: file.path, root: scope.root });
      if (!current(scope, revision) || active !== file) return;
      if (stat.stamp !== file.stamp) await load(requested, { quiet: true });
      else if (statusKind === 'stale') showStatus();
    } catch (error) {
      if (current(scope, revision) && active === file) showStatus(`Could not refresh this document: ${errorMessage(error)}`, 'stale');
    } finally { polling = false; }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++;
    clearInterval(interval); unlisten?.();
    const scope = connection; connection = null;
    preview.dispose(); element.remove();
    void closeScope(scope);
  }
  closeButton.addEventListener('click', () => { dispose(); onClose(); });
  retryButton.addEventListener('click', () => { void refresh(); });
  const interval = setInterval(() => { void poll(); }, 2000);
  Promise.resolve().then(() => api.onEvent?.((event) => {
    const scope = connection;
    if (disposed || !scope || event.workspaceId !== scope.id) return;
    if (event.event === 'disconnected') {
      scope.ready = false; scope.failed = true;
      generation++; busy = false;
      showStatus('The document connection was lost.', 'error');
    } else if (event.event === 'open' && !event.directory && event.path && scope.ready) {
      void open({ target: scope.target, root: scope.root, path: event.path });
    } else if (event.event === 'change' && scope.ready && (!event.path || event.path === active?.path)) {
      void refresh();
    }
  })).then((release) => { if (disposed) release?.(); else unlisten = release; }).catch((error) => showStatus(errorMessage(error), 'error'));
  return {
    open, refresh, dispose,
    setCloseEnabled(enabled) { closeButton.disabled = !enabled; },
    focus() { if (!disposed) preview.focus(); },
    blur() { if (element.contains(document.activeElement)) document.activeElement.blur(); },
    resize() { /* Document layout follows its companion container. */ },
  };
}
