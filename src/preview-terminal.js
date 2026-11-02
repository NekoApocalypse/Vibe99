import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { createTerminalOutput } from './terminal-output.mjs';
import { createPreviewInput } from './preview-input.mjs';
import { createTerminalRecovery } from './terminal-recovery.mjs';

// A terminal owned by one preview workspace. Transport differs; parsing,
// recovery, flow control and disposal have the same lifetime on both paths.
export async function createPreviewTerminal({ host, workspaceId, target, root,
  bridge, api, settings, onLink, onError, onFocus }) {
  const sessionId = crypto.randomUUID();
  const paneId = `preview-${sessionId}`;
  let disposed = false;
  let ready = false;
  let ended = false;
  let sizeKey = '';
  let inputTail = Promise.resolve();
  const terminal = new Terminal({ ...settings(), allowProposedApi: true,
    allowTransparency: true, scrollback: 5000,
    linkHandler: { activate: onLink } });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  terminal.loadAddon(new WebLinksAddon(onLink));
  terminal.open(host);
  const recovery = createTerminalRecovery({ terminal, getSessionId: () => target ? null : sessionId });
  terminal.attachCustomWheelEventHandler(recovery.handleWheel);
  const request = (method, args = {}) => api.request({ workspaceId, method, args: { terminal: sessionId, ...args } });
  const output = createTerminalOutput({ terminal: { write: recovery.write },
    acknowledge: sequence => target
      ? request('terminal-ack', { sequence })
      : bridge.acknowledgeTerminal({ paneId, sessionId, sequence }),
    onError });
  const remoteInput = target ? createPreviewInput({
    send: data => request('terminal-input', { data }),
    onError(error) {
      ready = false; ended = true;
      output.finish(() => terminal.writeln('\r\n[SSH terminal input stopped — reconnect before typing again]'));
      onError(error);
    },
  }) : null;
  const unlisten = [];
  const decoder = new TextDecoder();
  function receive(packet) {
    if (disposed || packet.terminal !== sessionId) return;
    if (packet.event === 'terminal-data') {
      ready = !ended;
      const bytes = Uint8Array.from(atob(packet.data), c => c.charCodeAt(0));
      output.push({ sequence: packet.sequence, data: decoder.decode(bytes, { stream: true }) });
    } else if (packet.event === 'terminal-exit') {
      ready = false;
      ended = true;
      remoteInput?.dispose();
      output.finish(() => terminal.writeln(`\r\n[process exited: ${packet.status ?? packet.exitCode ?? 'closed'}]`));
    }
  }
  if (target) {
    unlisten.push(api.onEvent(packet => {
      if (packet.workspaceId !== workspaceId || disposed) return;
      if (packet.event === 'disconnected') {
        ready = false; ended = true;
        remoteInput?.dispose();
        output.finish(() => terminal.writeln('\r\n[SSH disconnected — reconnect to start a new session]'));
      } else receive(packet);
    }));
  } else {
    unlisten.push(bridge.onTerminalData(packet => {
      if (disposed || packet.paneId !== paneId || packet.sessionId !== sessionId) return;
      ready = !ended;
      output.push(packet);
    }));
    unlisten.push(bridge.onTerminalExit(packet => {
      if (packet.paneId === paneId && packet.sessionId === sessionId) receive({ ...packet, event: 'terminal-exit', terminal: sessionId });
    }));
  }
  function send(data, binary = false) {
    if (!ready || disposed) return;
    recovery.classifyInput(data);
    if (remoteInput) { remoteInput.push(data, binary); return; }
    inputTail = inputTail.catch(() => {}).then(() => {
      if (disposed || !ready) return;
      return bridge.writeTerminal({ paneId, sessionId, data, binary });
    });
    inputTail.catch(onError);
  }
  terminal.onData(data => send(data));
  terminal.onBinary(data => send(data, true));
  terminal.attachCustomKeyEventHandler(event => !(event.type === 'keydown' && event.ctrlKey &&
    (event.key.toLowerCase() === 'v' || (event.shiftKey && event.key.toLowerCase() === 'c'))));
  host.addEventListener('pointerdown', onFocus);
  function resize() {
    if (disposed || !host.clientWidth || !host.clientHeight) return;
    const options = settings();
    if (terminal.options.fontSize !== options.fontSize) terminal.options.fontSize = options.fontSize;
    if (terminal.options.fontFamily !== options.fontFamily) terminal.options.fontFamily = options.fontFamily;
    fit.fit();
    const cols = Math.max(20, terminal.cols), rows = Math.max(8, terminal.rows);
    const next = `${cols}x${rows}`;
    if (ready && sizeKey !== next) {
      sizeKey = next;
      Promise.resolve(target ? request('terminal-resize', { cols, rows })
        : bridge.resizeTerminal({ paneId, sessionId, cols, rows })).catch(onError);
    }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const closeTransport = () => target ? request('terminal-close') : bridge.destroyTerminal({ paneId, sessionId });
  const controller = {
    terminal, paneId, sessionId,
    get sessionReady() { return ready && !disposed; },
    focus: () => { if (!disposed) terminal.focus(); },
    blur: () => terminal.blur(), resize,
    recoverMouseInput: () => output.finish(() => recovery.recover(() => terminal.focus())),
    setDiagnostics: recovery.setDiagnostics, getDiagnostics: recovery.getDiagnostics,
    diagnosticsEnabled: recovery.diagnosticsEnabled,
    dispose() {
      if (disposed) return;
      disposed = true; ready = false;
      remoteInput?.dispose();
      observer.disconnect();
      host.removeEventListener('pointerdown', onFocus);
      for (const stop of unlisten) stop?.();
      output.dispose(); recovery.dispose(); terminal.dispose();
      // Backend workspace closure also owns this terminal; a stale close is harmless.
      return Promise.resolve(closeTransport()).catch(() => {});
    },
  };
  try {
    resize();
    if (target) await request('terminal-start', { path: root, cols: terminal.cols, rows: terminal.rows });
    else await bridge.createTerminal({ paneId, sessionId, cwd: root, cols: terminal.cols, rows: terminal.rows, shellProfileId: '__vibe99_local__' });
    if (!ended) ready = true;
    resize();
    return controller;
  } catch (error) {
    await controller.dispose();
    throw error;
  }
}
