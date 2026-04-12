const { contextBridge, ipcRenderer, clipboard, shell } = require('electron');

function getDefaultWorkingDirectory() {
  const argument = process.argv.find((value) => value.startsWith('--vibe99-default-cwd='));
  if (argument) {
    return argument.slice('--vibe99-default-cwd='.length);
  }

  return process.cwd();
}

const cwd = getDefaultWorkingDirectory();
const defaultTabTitle = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

function openExternalUrl(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  return shell.openExternal(parsed.toString());
}

contextBridge.exposeInMainWorld('vibe99', {
  platform: process.platform,
  defaultCwd: cwd,
  defaultTabTitle,
  createTerminal: (payload) => ipcRenderer.invoke('vibe99:terminal-create', payload),
  writeTerminal: (payload) => ipcRenderer.invoke('vibe99:terminal-write', payload),
  resizeTerminal: (payload) => ipcRenderer.invoke('vibe99:terminal-resize', payload),
  destroyTerminal: (payload) => ipcRenderer.invoke('vibe99:terminal-destroy', payload),
  readClipboardText: () => clipboard.readText(),
  writeClipboardText: (text) => clipboard.writeText(text),
  openExternalUrl,
  showContextMenu: (payload) => ipcRenderer.invoke('vibe99:show-context-menu', payload),
  loadSettings: () => ipcRenderer.invoke('vibe99:settings-load'),
  saveSettings: (payload) => ipcRenderer.invoke('vibe99:settings-save', payload),
  onTerminalData: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('vibe99:terminal-data', listener);
    return () => ipcRenderer.removeListener('vibe99:terminal-data', listener);
  },
  onTerminalExit: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('vibe99:terminal-exit', listener);
    return () => ipcRenderer.removeListener('vibe99:terminal-exit', listener);
  },
  onMenuAction: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('vibe99:menu-action', listener);
    return () => ipcRenderer.removeListener('vibe99:menu-action', listener);
  },
});
