import { createMarkdownPreview } from './markdown-preview.js';
import { resolvePreviewPath } from './preview-paths.js';
import './preview-workspace.css';

/** Read-only document workspace; the supplied terminal remains a normal shell. */
export function createPreviewWorkspace({ container, workspaceId, api, createTerminal, openExternalUrl, onTitle = () => {}, onError = () => {} }) {
  const element = document.createElement('section');
  element.className = 'preview-workspace';
  element.setAttribute('aria-label', 'Markdown workspace');
  element.innerHTML = `
    <form class="preview-toolbar" aria-label="Preview connection">
      <div class="preview-connection-row">
        <label class="preview-kind-label"><span>Source</span><select name="kind" aria-label="Preview source"><option value="local">Local</option><option value="ssh">SSH</option></select></label>
        <label class="preview-host-label" hidden><span>Host</span><input name="target" placeholder="user@host or SSH alias" autocomplete="off" spellcheck="false"></label>
        <label class="preview-root-label"><span>Folder</span><input name="root" placeholder="Workspace folder" autocomplete="off" spellcheck="false"></label>
        <button type="submit" class="preview-connect">Connect</button>
      </div>
      <div class="preview-document-row">
        <label class="preview-path-label"><span>File</span><input name="path" placeholder="README.md or a Markdown path" value="README.md" autocomplete="off" spellcheck="false"></label>
        <button type="button" class="preview-open">Open</button>
        <button type="button" class="preview-refresh" disabled>Refresh</button>
        <button type="button" class="preview-terminal-toggle" aria-pressed="false" disabled>Terminal</button>
      </div>
      <div class="preview-status" role="status" aria-live="polite">Choose a folder and open a Markdown file.</div>
      <p class="preview-ssh-hint" hidden>SSH requires configured keys and a known host. After 60 s without contact, workspace terminal jobs are stopped.</p>
    </form>
    <div class="preview-body">
      <div class="preview-scroll"><article></article></div>
      <section class="preview-terminal-panel" aria-label="Workspace terminal" hidden><div class="preview-terminal-host"></div></section>
    </div>`;
  container.appendChild(element);
  const form = element.querySelector('form'), kindInput = form.elements.kind, targetInput = form.elements.target;
  const rootInput = form.elements.root, pathInput = form.elements.path;
  rootInput.value = api.defaultRoot || '';
  const status = element.querySelector('.preview-status'), connectButton = element.querySelector('.preview-connect');
  const refreshButton = element.querySelector('.preview-refresh'), terminalButton = element.querySelector('.preview-terminal-toggle');
  const terminalPanel = element.querySelector('.preview-terminal-panel'), terminalHost = element.querySelector('.preview-terminal-host');
  const scroll = element.querySelector('.preview-scroll');
  let disposed = false, lifecycle = 0, readGeneration = 0, connection = null, terminal = null;
  let opening = null, terminalOpening = null, terminalVisible = false, active = null, polling = false, unlisten = null;
  const message = (text, error = false) => { status.textContent = text; status.classList.toggle('is-error', error); };
  const errorText = (error) => String(error?.message || error).replace(/^Error: /, '');
  const report = (error) => { if (!disposed) { message(errorText(error), true); onError(error); } };
  const isCurrent = (scope) => !disposed && connection === scope;
  const request = (scope, method, args) => api.request({ workspaceId: scope.id, method, args });
  const preview = createMarkdownPreview({ container: element.querySelector('article'),
    readImage: (args) => {
      const scope = connection;
      if (!scope?.ready) return Promise.reject(new Error('Workspace is disconnected.'));
      return request(scope, 'image', args);
    }, onOpen: (path) => openFile(path, { useForm: false }), openExternalUrl, onError: report,
  });
  preview.clear('Open a Markdown file to preview it here. Code, math, diagrams, and local images are supported.');
  const safeClose = (scope) => scope && Promise.resolve(api.close({ workspaceId: scope.id })).catch(() => {});
  function resetTerminal() {
    terminal?.dispose(); terminal = null; terminalOpening = null;
    terminalHost.replaceChildren();
  }
  function updateControls() {
    refreshButton.disabled = !connection?.ready || !active;
    terminalButton.disabled = !connection?.ready;
    connectButton.textContent = connection?.ready ? 'Reconnect' : opening ? 'Connecting…' : 'Connect';
    terminalPanel.hidden = !terminalVisible;
    terminalButton.setAttribute('aria-pressed', String(terminalVisible));
    element.classList.toggle('has-terminal', terminalVisible);
  }
  async function ensureTerminal() {
    if (terminal || terminalOpening || !connection?.ready || !terminalVisible || !createTerminal) return terminalOpening;
    const scope = connection;
    const host = document.createElement('div');
    host.className = 'preview-terminal-instance';
    terminalHost.appendChild(host);
    const pending = Promise.resolve().then(() => createTerminal({ host, workspaceId: scope.id, target: scope.target, root: scope.root }));
    terminalOpening = pending;
    try {
      const created = await pending;
      if (!isCurrent(scope)) { created?.dispose(); return; }
      terminal = created;
      if (terminalVisible) terminal?.resize();
    } catch (error) { host.remove(); if (isCurrent(scope)) report(error); }
    finally { if (terminalOpening === pending) terminalOpening = null; }
  }
  async function connect(options = {}) {
    if (disposed) return false;
    const target = options.target === null ? null : options.target ?? (kindInput.value === 'ssh' ? targetInput.value.trim() : null);
    const root = (options.root ?? rootInput.value).trim();
    if (target !== null && !target) { report(new Error('Enter an SSH host or alias.')); targetInput.focus(); return false; }
    if (!root) { report(new Error('Enter the workspace folder.')); rootInput.focus(); return false; }
    kindInput.value = target === null ? 'local' : 'ssh'; targetInput.value = target || ''; rootInput.value = root;
    element.querySelector('.preview-host-label').hidden = target === null;
    element.querySelector('.preview-ssh-hint').hidden = target === null;
    const old = connection;
    const scope = { id: `${workspaceId}-${++lifecycle}-${crypto.randomUUID()}`, target, root, ready: false };
    connection = scope; readGeneration++; active = null;
    resetTerminal(); preview.clear('Connecting to workspace…'); onTitle('Markdown');
    void safeClose(old);
    message(target ? `Connecting to ${target}…` : 'Opening local folder…');
    const pending = (async () => {
      try {
        const result = await api.open({ workspaceId: scope.id, target, root });
        if (!isCurrent(scope)) { await safeClose(scope); return false; }
        scope.root = result?.root || root;
        rootInput.value = scope.root;
        scope.ready = true;
        message(target ? `Connected · ${target}` : 'Connected · Local');
        preview.clear('Workspace connected. Open a Markdown file above.');
        updateControls();
        await ensureTerminal();
        return isCurrent(scope);
      } catch (error) {
        if (isCurrent(scope)) { scope.ready = false; preview.clear('Connection failed. Check the folder and connection details, then reconnect.'); report(error); }
        await safeClose(scope);
        return false;
      }
    })();
    opening = pending; updateControls();
    try { return await pending; }
    finally { if (opening === pending) { opening = null; if (!disposed) updateControls(); } }
  }
  async function openFile(path = pathInput.value, options = {}) {
    if (disposed) return false;
    const inputPath = String(path || '').trim();
    if (!inputPath) { report(new Error('Enter a Markdown file path.')); pathInput.focus(); return false; }
    if (opening) { if (!await opening) return false; }
    if (options.useForm !== false && connection?.ready) {
      const target = kindInput.value === 'ssh' ? targetInput.value.trim() : null;
      if (target !== connection.target || rootInput.value.trim() !== connection.root) {
        if (!await connect()) return false;
      }
    }
    if (!connection?.ready) { if (!await connect()) return false; }
    const scope = connection, revision = ++readGeneration;
    const requestedPath = resolvePreviewPath(scope.root, inputPath);
    message(`Opening ${inputPath}…`);
    try {
      const file = await request(scope, 'read', { path: requestedPath, root: scope.root });
      if (!isCurrent(scope) || revision !== readGeneration) return false;
      const changedPath = active?.path !== file.path;
      preview.render({ text: file.text, path: file.path || requestedPath, root: scope.root, refreshImages: options.refreshImages || changedPath });
      active = { path: file.path || requestedPath, stamp: file.stamp };
      pathInput.value = active.path;
      onTitle(active.path.replaceAll('\\', '/').split('/').pop() || 'Markdown');
      if (changedPath) scroll.scrollTop = 0;
      message(`${scope.target || 'Local'} · ${active.path}`);
      updateControls();
      return true;
    } catch (error) { if (isCurrent(scope) && revision === readGeneration) report(error); return false; }
  }
  function refresh() { return active ? openFile(active.path, { refreshImages: true, useForm: false }) : openFile(); }
  async function toggleTerminal(show = !terminalVisible) {
    if (disposed) return;
    terminalVisible = Boolean(show); updateControls();
    if (terminalVisible) { await ensureTerminal(); if (!disposed && terminalVisible) { terminal?.resize(); terminal?.focus(); } }
    else preview.focus();
  }
  async function poll() {
    if (disposed || polling || !connection?.ready || !active || document.hidden) return;
    const scope = connection, file = active, revision = readGeneration;
    polling = true;
    try {
      const stat = await request(scope, 'stat', { path: file.path, root: scope.root });
      if (!isCurrent(scope) || active !== file || revision !== readGeneration) return;
      if (stat.stamp !== file.stamp) await openFile(file.path, { useForm: false });
      else if (status.textContent.startsWith('Preview may be out of date')) message(`${scope.target || 'Local'} · ${file.path}`);
    } catch (error) { if (isCurrent(scope) && active === file && revision === readGeneration) message(`Preview may be out of date · ${errorText(error)}`, true); }
    finally { polling = false; }
  }
  const onSubmit = (event) => { event.preventDefault(); void connect(); };
  const onOpenClick = () => { void openFile(); };
  const onRefreshClick = () => { void refresh(); };
  const onToggleClick = () => { void toggleTerminal(); };
  const onKindChange = () => {
    element.querySelector('.preview-host-label').hidden = kindInput.value !== 'ssh';
    element.querySelector('.preview-ssh-hint').hidden = kindInput.value !== 'ssh';
  };
  const onPathKey = (event) => { if (event.key === 'Enter') { event.preventDefault(); void openFile(); } };
  form.addEventListener('submit', onSubmit);
  element.querySelector('.preview-open').addEventListener('click', onOpenClick);
  refreshButton.addEventListener('click', onRefreshClick); terminalButton.addEventListener('click', onToggleClick);
  kindInput.addEventListener('change', onKindChange); pathInput.addEventListener('keydown', onPathKey);
  Promise.resolve(api.onEvent((event) => {
    if (disposed || !connection || event.workspaceId !== connection.id) return;
    if (event.event === 'open' && event.path && !event.directory && (connection.ready || opening)) void openFile(event.path, { useForm: false });
    else if (event.event === 'change' && (!event.path || event.path === active?.path)) void refresh();
    else if (event.event === 'disconnected') { connection.ready = false; message('Disconnected · Reconnect to refresh the preview.', true); updateControls(); }
  })).then((release) => { if (disposed) release?.(); else unlisten = release; }).catch(report);
  const interval = setInterval(() => { void poll(); }, 2000);
  return {
    connect, openFile, refresh, toggleTerminal,
    getTerminal: () => terminal,
    focus() { if (terminalVisible && terminal) terminal.focus(); else if (active) preview.focus(); else rootInput.focus(); },
    blur() { terminal?.blur?.(); },
    resize() { if (terminalVisible) terminal?.resize(); },
    recoverMouseInput() { terminal?.recoverMouseInput?.(); },
    dispose() {
      if (disposed) return;
      disposed = true; lifecycle++; readGeneration++;
      clearInterval(interval); unlisten?.();
      const scope = connection; connection = null;
      resetTerminal(); preview.dispose(); element.remove();
      void safeClose(scope);
    },
  };
}
