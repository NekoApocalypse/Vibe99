import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

function getRuntimePlatform() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) {
    return 'win32';
  }
  if (platform.includes('mac')) {
    return 'darwin';
  }
  return 'linux';
}

function getDefaultFontFamily(platform = getRuntimePlatform()) {
  if (platform === 'win32' || platform === 'windows') {
    return 'Consolas, "Cascadia Mono", "Courier New", monospace';
  }
  if (platform === 'darwin') {
    return 'Menlo, Monaco, "SF Mono", monospace';
  }
  return '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", monospace';
}

function basename(path) {
  return path.replace(/\/+$/, '').split('/').pop() || '/';
}

function splitArgs(str) {
  const args = [];
  let cur = '';
  let inQuote = false;
  let quoteChar = '';
  for (const ch of str) {
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; } else { cur += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { args.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) { args.push(cur); }
  return args;
}


function createUnavailableBridge() {
  const fail = () => {
    throw new Error('Tauri bridge is unavailable');
  };

  const defaultCwd = '/';

  return {
    platform: getRuntimePlatform(),
    defaultCwd,
    defaultTabTitle: basename(defaultCwd),
    createTerminal: fail,
    writeTerminal: fail,
    resizeTerminal: fail,
    destroyTerminal: fail,
    closeWindow: fail,
    readClipboardText: () => Promise.reject(new Error('Clipboard bridge is unavailable')),
    writeClipboardText: fail,
    getClipboardSnapshot: () => ({ text: '', hasImage: false }),
    openExternalUrl: fail,
    showContextMenu: fail,
    loadSettings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve({}),
    listShellProfiles: () => Promise.resolve({ profiles: [], defaultProfile: '' }),
    addShellProfile: fail,
    removeShellProfile: fail,
    setDefaultShellProfile: fail,
    detectShellProfiles: () => Promise.resolve([]),
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
    onMenuAction: () => () => {},
    cwdReady: Promise.resolve(),
  };
}

function createTauriBridge(tauri) {
  const { invoke } = tauri.core;
  const { getCurrentWindow } = tauri.window;
  const { readText: clipboardReadText, writeText: clipboardWriteText } =
    tauri.clipboardManager;
  const { openUrl } = tauri.opener;

  function base64Encode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function onTauriEvent(event, handler) {
    const unlisten = tauri.event.listen(event, (e) => handler(e.payload));
    return () => unlisten.then((fn) => fn());
  }

  // Resolve the real CWD from the Tauri backend so the initial tab title
  // shows the directory basename (e.g. "/home/yar/projects" → "projects").
  let _resolvedCwd = '.';
  const _cwdReady = invoke('get_cwd')
    .then((cwd) => { _resolvedCwd = cwd; })
    .catch(() => {});

  return {
    platform: getRuntimePlatform(),
    get defaultCwd() { return _resolvedCwd; },
    get defaultTabTitle() { return basename(_resolvedCwd); },
    createTerminal: (payload) =>
      invoke('terminal_create', {
        paneId: payload.paneId,
        cols: payload.cols,
        rows: payload.rows,
        cwd: payload.cwd,
        shellProfileId: payload.shellProfileId ?? null,
      }),
    writeTerminal: (payload) =>
      invoke('terminal_write', {
        paneId: payload.paneId,
        data: base64Encode(payload.data),
      }),
    resizeTerminal: (payload) =>
      invoke('terminal_resize', {
        paneId: payload.paneId,
        cols: payload.cols,
        rows: payload.rows,
      }),
    destroyTerminal: (payload) =>
      invoke('terminal_destroy', { paneId: payload.paneId }),
    closeWindow: () => getCurrentWindow().close(),
    readClipboardText: () => clipboardReadText(),
    writeClipboardText: (text) => clipboardWriteText(text),
    getClipboardSnapshot: async () => {
      try {
        const text = await clipboardReadText();
        return { text: text ?? '', hasImage: false };
      } catch {
        return { text: '', hasImage: false };
      }
    },
    openExternalUrl: (url) => openUrl(url),
    showContextMenu: () => {},
    loadSettings: () => invoke('settings_load'),
    saveSettings: (payload) => invoke('settings_save', { settings: payload }),
    listShellProfiles: () => invoke('shell_profiles_list'),
    addShellProfile: (profile) => invoke('shell_profile_add', { profile }),
    removeShellProfile: (profileId) => invoke('shell_profile_remove', { profileId }),
    setDefaultShellProfile: (profileId) => invoke('shell_profile_set', { profileId }),
    detectShellProfiles: () => invoke('shell_profiles_detect'),
    onTerminalData: (handler) => onTauriEvent('vibe99:terminal-data', handler),
    onTerminalExit: (handler) => onTauriEvent('vibe99:terminal-exit', handler),
    onMenuAction: (handler) => onTauriEvent('vibe99:menu-action', handler),
    cwdReady: _cwdReady,
  };
}

const bridge = window.__TAURI__
  ? createTauriBridge(window.__TAURI__)
  : window.vibe99 ?? createUnavailableBridge();

const initialPanes = [
  {
    id: 'p1',
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: bridge.defaultCwd,
    accent: '#ff6b57',
    shellProfileId: null,
  },
  {
    id: 'p2',
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: bridge.defaultCwd,
    accent: '#ff9f1c',
    shellProfileId: null,
  },
  {
    id: 'p3',
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: bridge.defaultCwd,
    accent: '#ffd166',
    shellProfileId: null,
  },
];

const accentPalette = [
  '#ff6b57',
  '#ff9f1c',
  '#ffd166',
  '#06d6a0',
  '#118ab2',
  '#9b5de5',
  '#ef476f',
  '#7bd389',
  '#5cc8ff',
  '#f4a261',
];

let panes = initialPanes.map((pane) => ({ ...pane }));
let focusedPaneId = panes[0].id;
let nextPaneNumber = panes.length + 1;
let renamingPaneId = null;
let isRenderingTabs = false; // Guard against re-entrant renderTabs calls
let dragState = null;
let isNavigationMode = false;
let pendingTabFocus = null;
let sessionRestoreComplete = false;

const paneNodeMap = new Map();

const stageEl = document.getElementById('stage');
const tabsListEl = document.getElementById('tabs-list');
const statusLabelEl = document.getElementById('status-label');
const statusHintEl = document.getElementById('status-hint');
const addPaneButtonEl = document.getElementById('tabs-add');
const settingsButtonEl = document.getElementById('tabs-settings');
const fullscreenButtonEl = document.getElementById('tabs-fullscreen');
const settingsPanelEl = document.getElementById('settings-panel');
const fontSizeInputEl = document.getElementById('font-size-input');
const fontFamilyInputEl = document.getElementById('font-family-input');
const paneWidthRangeEl = document.getElementById('pane-width-range');
const paneWidthInputEl = document.getElementById('pane-width-input');
const paneWidthValueEl = document.getElementById('pane-width-value');
const paneOpacityRangeEl = document.getElementById('pane-opacity-range');
const paneOpacityInputEl = document.getElementById('pane-opacity-input');
const paneOpacityValueEl = document.getElementById('pane-opacity-value');
const paneMaskOpacityRangeEl = document.getElementById('pane-mask-alpha-range');
const paneMaskOpacityInputEl = document.getElementById('pane-mask-alpha-input');
const paneMaskOpacityValueEl = document.getElementById('pane-mask-alpha-value');

const settings = {
  fontSize: 13,
  fontFamily: getDefaultFontFamily(bridge.platform),
  paneOpacity: 0.8,
  paneMaskOpacity: 0.25,
  paneWidth: 720,
};
let pendingSettingsSave = null;

let shellProfiles = [];
let defaultShellProfileId = '';
let editingShellProfile = null; // null or { id?, name, command, args }

const shellProfileListEl = document.getElementById('shell-profile-list');
const shellProfileAddBtn = document.getElementById('shell-profile-add');

// Batch terminal writes within a single animation frame so that rapid TUI
// updates (cursor move → clear → rewrite) are parsed as one coherent chunk
// instead of many tiny fragments that can leave stale cells in the renderer.
const terminalWriteBuffer = new Map();
let terminalWriteRaf = null;

function flushTerminalWrites() {
  terminalWriteRaf = null;
  for (const [node, chunks] of terminalWriteBuffer) {
    node.terminal.write(chunks.join(''));
  }
  terminalWriteBuffer.clear();
}

const removeTerminalDataListener = bridge.onTerminalData(({ paneId, data }) => {
  const node = paneNodeMap.get(paneId);
  if (!node) return;
  const chunks = terminalWriteBuffer.get(node);
  if (chunks) {
    chunks.push(data);
  } else {
    terminalWriteBuffer.set(node, [data]);
  }
  if (!terminalWriteRaf) {
    terminalWriteRaf = requestAnimationFrame(flushTerminalWrites);
  }
});

const removeTerminalExitListener = bridge.onTerminalExit(({ paneId, exitCode }) => {
  const node = paneNodeMap.get(paneId);
  if (!node) {
    return;
  }

  // If the terminal was destroyed for a shell change, or the process exited
  // within a short grace period after a shell change, don't close the pane.
  const graceMs = 3000;
  const recentShellChange = node._shellChangeTime && (Date.now() - node._shellChangeTime < graceMs);
  if (node._shellChanging || recentShellChange) {
    node.sessionReady = false;
    node.terminal.writeln('');
    node.terminal.writeln(`\x1b[38;5;204m[shell exited with code ${exitCode}]\x1b[0m`);
    return;
  }

  node.sessionReady = false;
  node.terminal.writeln('');
  node.terminal.writeln(`\x1b[38;5;244m[process exited with code ${exitCode}]\x1b[0m`);

  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) {
    return;
  }

  if (panes.length === 1) {
    void bridge.closeWindow().catch(reportError);
    return;
  }

  closePane(paneIndex, { destroyTerminal: false });
});

const removeMenuActionListener = bridge.onMenuAction(({ action, paneId }) => {
  try {
    handleMenuAction(action, paneId);
  } catch (error) {
    reportError(error);
  }
});

function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  statusLabelEl.textContent = `Error: ${message}`;
  statusHintEl.textContent = '';
  console.error(error);
}

function getPreviewWidth(stageWidth, count) {
  if (count <= 1) {
    return 0;
  }

  if (stageWidth >= settings.paneWidth * count) {
    return settings.paneWidth;
  }

  return (stageWidth - settings.paneWidth) / (count - 1);
}

function getPaneLabel(pane) {
  return pane.title ?? pane.terminalTitle ?? '';
}

function applySettings() {
  document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--pane-opacity', settings.paneOpacity.toFixed(2));
  document.documentElement.style.setProperty('--pane-bg-mask-opacity', settings.paneMaskOpacity.toFixed(2));
  document.documentElement.style.setProperty('--pane-width', `${settings.paneWidth}px`);
  fontSizeInputEl.value = String(settings.fontSize);
  fontFamilyInputEl.value = settings.fontFamily;
  paneWidthRangeEl.value = String(settings.paneWidth);
  paneWidthInputEl.value = String(settings.paneWidth);
  paneWidthValueEl.textContent = `${settings.paneWidth}px`;
  paneOpacityRangeEl.value = settings.paneOpacity.toFixed(2);
  paneOpacityInputEl.value = settings.paneOpacity.toFixed(2);
  paneOpacityValueEl.textContent = settings.paneOpacity.toFixed(2);
  paneMaskOpacityRangeEl.value = settings.paneMaskOpacity.toFixed(2);
  paneMaskOpacityInputEl.value = settings.paneMaskOpacity.toFixed(2);
  paneMaskOpacityValueEl.textContent = settings.paneMaskOpacity.toFixed(2);
}

function applyPersistedSettings(nextSettings) {
  if (!nextSettings || typeof nextSettings !== 'object') {
    return;
  }

  const uiSettings =
    nextSettings && typeof nextSettings.ui === 'object' && nextSettings.ui !== null
      ? nextSettings.ui
      : nextSettings;

  if (Number.isFinite(uiSettings.fontSize)) {
    settings.fontSize = uiSettings.fontSize;
  }

  if (typeof uiSettings.fontFamily === 'string') {
    settings.fontFamily = uiSettings.fontFamily;
  }

  if (Number.isFinite(uiSettings.paneOpacity)) {
    settings.paneOpacity = Math.max(0.55, Math.min(1, uiSettings.paneOpacity));
  }

  if (Number.isFinite(uiSettings.paneMaskOpacity)) {
    settings.paneMaskOpacity = Math.max(0, Math.min(0.8, uiSettings.paneMaskOpacity));
  }

  // Migrate legacy paneMaskAlpha → paneMaskOpacity
  if (Number.isFinite(uiSettings.paneMaskAlpha) && !Number.isFinite(uiSettings.paneMaskOpacity)) {
    settings.paneMaskOpacity = Math.max(0, Math.min(0.8, uiSettings.paneMaskAlpha));
  }

  if (Number.isFinite(uiSettings.paneWidth)) {
    settings.paneWidth = uiSettings.paneWidth;
  }
}

function buildSessionData() {
  const focusedIndex = getFocusedIndex();
  return {
    panes: panes.map((p) => ({
      title: p.title,
      cwd: p.cwd,
      accent: p.accent,
      shellProfileId: p.shellProfileId,
    })),
    focusedPaneIndex: focusedIndex >= 0 ? focusedIndex : 0,
  };
}

function restoreSession(session) {
  const validPanes = (session.panes ?? [])
    .filter((p) => p && typeof p.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.accent))
    .map((p, index) => ({
      id: `p${index + 1}`,
      title: (typeof p.title === 'string' && p.title) || null,
      terminalTitle: bridge.defaultTabTitle,
      cwd: (typeof p.cwd === 'string' && p.cwd) || bridge.defaultCwd,
      accent: p.accent,
      shellProfileId: (typeof p.shellProfileId === 'string' && p.shellProfileId) || null,
    }));

  if (validPanes.length === 0) {
    panes = initialPanes.map((p) => ({
      ...p,
      cwd: bridge.defaultCwd,
      terminalTitle: bridge.defaultTabTitle,
    }));
    focusedPaneId = panes[0].id;
    nextPaneNumber = panes.length + 1;
    return;
  }

  panes = validPanes;
  const focusedIndex = Math.min(
    Number.isFinite(session.focusedPaneIndex) ? session.focusedPaneIndex : 0,
    panes.length - 1,
  );
  focusedPaneId = panes[Math.max(0, focusedIndex)].id;
  nextPaneNumber = panes.length + 1;
}

function scheduleSettingsSave() {
  if (pendingSettingsSave !== null) {
    window.clearTimeout(pendingSettingsSave);
  }

  pendingSettingsSave = window.setTimeout(() => {
    pendingSettingsSave = null;
    bridge.saveSettings({ version: 3, ui: settings, session: buildSessionData() }).catch(reportError);
  }, 150);
}

function flushSettingsSave() {
  if (pendingSettingsSave !== null) {
    window.clearTimeout(pendingSettingsSave);
    pendingSettingsSave = null;
    void bridge.saveSettings({ version: 3, ui: settings, session: buildSessionData() }).catch(reportError);
  }
}

// ----------------------------------------------------------------
// Shell profile management
// ----------------------------------------------------------------

let detectedShellProfiles = [];

function loadShellProfiles() {
  Promise.all([
    bridge.listShellProfiles(),
    bridge.detectShellProfiles().catch(() => []),
  ]).then(([config, detected]) => {
    detectedShellProfiles = detected;
    const userProfiles = config.profiles ?? [];
    const userIds = new Set(userProfiles.map((p) => p.id));
    // Merge: user profiles first, then detected ones not already present.
    shellProfiles = [...userProfiles, ...detected.filter((p) => !userIds.has(p.id))];
    defaultShellProfileId = config.defaultProfile ?? '';
    renderShellProfiles();
  }).catch(reportError);
}

function renderShellProfiles() {
  shellProfileListEl.replaceChildren();

  if (editingShellProfile) {
    shellProfileListEl.appendChild(createShellProfileEditor());
    return;
  }

  if (shellProfiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'shell-profile-empty';
    empty.textContent = 'No profiles configured';
    shellProfileListEl.appendChild(empty);
    return;
  }

  const detectedIds = new Set(detectedShellProfiles.map((p) => p.id));

  for (const profile of shellProfiles) {
    const isDetected = detectedIds.has(profile.id);
    const item = document.createElement('div');
    item.className = `shell-profile-item${profile.id === defaultShellProfileId ? ' is-default' : ''}${isDetected ? ' is-detected' : ''}`;

    const info = document.createElement('div');
    info.className = 'shell-profile-info';

    const name = document.createElement('div');
    name.className = 'shell-profile-name';
    name.textContent = profile.name || profile.id;

    const cmd = document.createElement('div');
    cmd.className = 'shell-profile-cmd';
    cmd.textContent = profile.command + (profile.args?.length ? ` ${profile.args.join(' ')}` : '');

    info.append(name, cmd);

    // Click the profile info area to apply this shell to the focused pane.
    info.addEventListener('click', () => {
      if (focusedPaneId) {
        changePaneShell(focusedPaneId, profile.id);
      }
    });

    const actions = document.createElement('div');
    actions.className = 'shell-profile-actions';

    if (profile.id !== defaultShellProfileId) {
      actions.appendChild(createProfileActionButton('★', 'Set as default', () => {
        const apply = (config) => {
          const userIds = new Set((config.profiles ?? []).map((p) => p.id));
          shellProfiles = [...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))];
          defaultShellProfileId = config.defaultProfile ?? '';
          renderShellProfiles();
        };
        if (isDetected) {
          bridge.addShellProfile(profile).then(() => {
            bridge.setDefaultShellProfile(profile.id).then(apply).catch(reportError);
          }).catch(reportError);
        } else {
          bridge.setDefaultShellProfile(profile.id).then(apply).catch(reportError);
        }
      }));
    }

    actions.appendChild(createProfileActionButton('✎', 'Edit', () => {
      editingShellProfile = {
        id: profile.id,
        name: profile.name || '',
        command: profile.command,
        args: (profile.args ?? []).join(' '),
      };
      renderShellProfiles();
    }));

    if (!isDetected) {
      actions.appendChild(createProfileActionButton('✕', 'Delete', () => {
        bridge.removeShellProfile(profile.id).then((config) => {
          const userIds = new Set((config.profiles ?? []).map((p) => p.id));
          shellProfiles = [...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))];
          defaultShellProfileId = config.defaultProfile ?? '';
          renderShellProfiles();
        }).catch(reportError);
      }));
    }

    item.append(info, actions);
    shellProfileListEl.appendChild(item);
  }
}

function createProfileActionButton(label, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-btn';
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function createShellProfileEditor() {
  const editor = document.createElement('div');
  editor.className = 'shell-profile-editor';

  const fields = [
    { key: 'name', label: 'Name (optional)', placeholder: 'e.g. Zsh' },
    { key: 'id', label: 'ID', placeholder: 'e.g. zsh' },
    { key: 'command', label: 'Command', placeholder: '/bin/zsh' },
    { key: 'args', label: 'Arguments', placeholder: '-il' },
  ];

  const inputs = {};
  for (const field of fields) {
    const label = document.createElement('label');
    label.textContent = field.label;
    label.setAttribute('for', `shell-edit-${field.key}`);

    const input = document.createElement('input');
    input.id = `shell-edit-${field.key}`;
    input.type = 'text';
    input.value = editingShellProfile[field.key] ?? '';
    input.placeholder = field.placeholder;
    input.dataset.field = field.key;
    inputs[field.key] = input;

    // Auto-fill id from name when creating new profile
    if (field.key === 'name' && !editingShellProfile.id) {
      input.addEventListener('input', () => {
        const idInput = inputs.id;
        if (!idInput.value && input.value.trim()) {
          idInput.value = input.value.trim().toLowerCase().replace(/\s+/g, '-');
        }
      });
    }

    editor.append(label, input);
  }

  const actions = document.createElement('div');
  actions.className = 'shell-profile-editor-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'settings-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    editingShellProfile = null;
    renderShellProfiles();
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'settings-btn is-primary';
  save.textContent = 'Save';
  save.addEventListener('click', () => {
    const profile = {
      id: inputs.id.value.trim(),
      name: inputs.name.value.trim(),
      command: inputs.command.value.trim(),
      args: splitArgs(inputs.args.value.trim()),
    };

    if (!profile.id || !profile.command) {
      reportError(new Error('ID and Command are required'));
      return;
    }

    bridge.addShellProfile(profile).then((config) => {
      const userIds = new Set((config.profiles ?? []).map((p) => p.id));
      shellProfiles = [...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))];
      defaultShellProfileId = config.defaultProfile ?? '';
      editingShellProfile = null;
      renderShellProfiles();
    }).catch(reportError);
  });

  actions.append(cancel, save);
  editor.appendChild(actions);

  queueMicrotask(() => {
    const firstInput = editor.querySelector('input');
    if (firstInput) {
      firstInput.focus();
      firstInput.select();
    }
  });

  return editor;
}

function changePaneShell(paneId, profileId) {
  const node = paneNodeMap.get(paneId);
  if (!node) return;

  const previousProfileId = panes.find((p) => p.id === paneId)?.shellProfileId ?? null;

  panes = panes.map((p) =>
    p.id === paneId ? { ...p, shellProfileId: profileId } : p
  );
  scheduleSettingsSave();

  // Suppress the exit handler — the old PTY is about to be replaced.
  // spawn() on the backend already destroys any previous session.
  node._shellChanging = true;
  node._shellChangeTime = Date.now();
  node.sessionReady = false;
  node.terminal.clear();
  initializePaneTerminal(node).finally(() => {
    node._shellChanging = false;
    // Revert profile on failure so the session doesn't persist a broken profile.
    if (!node.sessionReady) {
      panes = panes.map((p) =>
        p.id === paneId ? { ...p, shellProfileId: previousProfileId } : p
      );
      scheduleSettingsSave();
    }
  });
}

function createTerminalTheme(accent) {
  return {
    background: '#11111100',
    foreground: '#d9d4c7',
    cursor: accent,
    cursorAccent: '#111111',
    selectionBackground: `${accent}44`,
    black: '#111111',
    red: '#ff6b57',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#d9d4c7',
    brightBlack: '#5a6374',
    brightRed: '#ff8578',
    brightGreen: '#b0d98b',
    brightYellow: '#f0d58a',
    brightBlue: '#7eb7ff',
    brightMagenta: '#d9a5e8',
    brightCyan: '#7fd8e6',
    brightWhite: '#ffffff',
  };
}

function isLinkOpenModifierPressed(event) {
  return event.ctrlKey || (bridge.platform === 'darwin' && event.metaKey);
}

function handleTerminalLinkActivation(event, uri) {
  if (!isLinkOpenModifierPressed(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void bridge.openExternalUrl(uri).catch(reportError);
}

function getFocusedIndex() {
  const focusedIndex = panes.findIndex((pane) => pane.id === focusedPaneId);
  if (focusedIndex !== -1) {
    return focusedIndex;
  }

  focusedPaneId = panes[0]?.id ?? null;
  return panes.length > 0 ? 0 : -1;
}

function getPaneLeft(index, previewWidth, focusedIndex) {
  if (previewWidth >= settings.paneWidth) {
    return index * settings.paneWidth;
  }

  const focusedLeft = focusedIndex * previewWidth;

  if (index < focusedIndex) {
    return index * previewWidth;
  }

  if (index === focusedIndex) {
    return focusedLeft;
  }

  return focusedLeft + settings.paneWidth + (index - focusedIndex - 1) * previewWidth;
}

function getTextColorForBackground(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

function createTab(pane, index, focusedIndex, dragMeta) {
  const tab = document.createElement('div');
  tab.className = `tab${index === focusedIndex ? ' is-focused' : ''}`;
  if (dragMeta?.isDragging) {
    tab.classList.add('is-dragging');
    tab.style.transform = `translateX(${dragMeta.offsetX}px)`;
  }
  if (dragMeta?.insertBefore) {
    tab.classList.add('insert-before');
  }
  tab.style.setProperty('--pane-accent', pane.accent);
  tab.style.setProperty('--tab-text-color', getTextColorForBackground(pane.accent));
  tab.dataset.paneId = pane.id;
  tab.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    void showTabContextMenu(pane.id, event);
  });

  const tabMain = document.createElement('button');
  tabMain.type = 'button';
  tabMain.className = 'tab-main';
  tabMain.setAttribute('aria-pressed', String(index === focusedIndex));
  tabMain.addEventListener('pointerdown', (event) => {
    beginTabDrag(index, event);
  });
  tabMain.addEventListener('dblclick', (event) => {
    event.preventDefault();
    beginRenamePane(index);
  });

  const swatch = document.createElement('span');
  swatch.className = 'tab-swatch';

  let label;
  if (renamingPaneId === pane.id) {
    label = document.createElement('input');
    label.className = 'tab-input';
    label.type = 'text';
    label.value = getPaneLabel(pane);
    label.setAttribute('aria-label', `Rename tab ${pane.id}`);
    label.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    label.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        commitRenamePane(pane.id, label.value);
      }

      if (event.key === 'Escape') {
        cancelRenamePane();
      }
    });
    label.addEventListener('blur', () => {
      commitRenamePane(pane.id, label.value);
    });
    queueMicrotask(() => {
      label.focus();
      label.select();
    });
  } else {
    label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = getPaneLabel(pane);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.textContent = 'x';
  close.setAttribute('aria-label', `Close tab ${pane.id}`);
  close.disabled = panes.length === 1;
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closePane(index);
  });

  tabMain.append(swatch, label);
  tab.append(tabMain, close);
  return tab;
}

function createPane(pane) {
  const paneEl = document.createElement('article');
  paneEl.className = 'pane';
  paneEl.style.setProperty('--pane-accent', pane.accent);
  paneEl.addEventListener('click', () => {
    focusPane(pane.id);
  });

  const shell = document.createElement('div');
  shell.className = 'pane-shell';

  const body = document.createElement('div');
  body.className = 'pane-body';

  const surface = document.createElement('div');
  surface.className = 'pane-surface';

  const terminalHost = document.createElement('div');
  terminalHost.className = 'terminal-host';
  surface.append(terminalHost);
  body.append(surface);
  shell.append(body);
  paneEl.append(shell);

  const terminal = new Terminal({
    allowTransparency: true,
    convertEol: false,
    customGlyphs: true,
    cursorBlink: true,
    disableStdin: false,
    drawBoldTextInBrightColors: false,
    fontFamily: settings.fontFamily || getDefaultFontFamily(bridge.platform),
    fontSize: settings.fontSize,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: createTerminalTheme(pane.accent),
  });
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon(handleTerminalLinkActivation);
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.open(terminalHost);
  try { terminal.loadAddon(new WebglAddon()); } catch {}
  terminal.attachCustomKeyEventHandler((event) => {
    if (!isWindowsCtrlVPasteHotkey(event)) {
      return true;
    }
    return false;
  });

  const node = {
    paneId: pane.id,
    cwd: pane.cwd,
    root: paneEl,
    terminalHost,
    terminal,
    fitAddon,
    sessionReady: false,
    sizeKey: '',
    needsFit: true,
    accent: pane.accent,
  };

  terminalHost.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    focusPane(node.paneId, { focusTerminal: false });
    void showTerminalContextMenu(node, event);
  });

  terminal.onData((data) => {
    if (node.sessionReady) {
      bridge.writeTerminal({ paneId: node.paneId, data });
    }
  });

  terminal.onTitleChange((nextTitle) => {
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) {
      return;
    }
    panes = panes.map((entry) =>
      entry.id === pane.id ? { ...entry, terminalTitle: trimmedTitle } : entry
    );
    if (entryNeedsTabRefresh(pane.id)) {
      renderTabs();
    }
  });

  terminal.onSelectionChange(() => {
    const selection = terminal.getSelection();
    if (selection) {
      bridge.writeClipboardText(selection);
    }
  });

  terminal.parser.registerOscHandler(52, (data) => {
    const semicolon = data.indexOf(';');
    if (semicolon === -1) {
      return true;
    }
    const base64Text = data.slice(semicolon + 1);
    if (!base64Text || base64Text === '?') {
      return true;
    }
    try {
      const bytes = atob(base64Text);
      const text = new TextDecoder().decode(
        Uint8Array.from(bytes, (c) => c.charCodeAt(0))
      );
      bridge.writeClipboardText(text);
    } catch {}
    return true;
  });

  return node;
}

function entryNeedsTabRefresh(paneId) {
  const pane = panes.find((entry) => entry.id === paneId);
  return Boolean(pane && pane.title === null);
}

function fitTerminal(node, force = false) {
  node.terminal.options.fontSize = settings.fontSize;
  node.terminal.options.fontFamily = settings.fontFamily || getDefaultFontFamily(bridge.platform);
  node.fitAddon.fit();

  const cols = Math.max(20, node.terminal.cols || 80);
  const rows = Math.max(8, node.terminal.rows || 24);
  const nextSizeKey = `${cols}x${rows}`;

  if (node.sessionReady && (force || nextSizeKey !== node.sizeKey)) {
    bridge.resizeTerminal({
      paneId: node.paneId,
      cols,
      rows,
    });
  }

  node.sizeKey = nextSizeKey;
  node.needsFit = false;
}

async function initializePaneTerminal(node) {
  fitTerminal(node, true);
  const pane = panes.find((p) => p.id === node.paneId);
  const profileId = pane?.shellProfileId ?? null;
  try {
    await bridge.createTerminal({
      paneId: node.paneId,
      cols: node.terminal.cols,
      rows: node.terminal.rows,
      cwd: node.cwd,
      shellProfileId: profileId,
    });
    node.sessionReady = true;
    fitTerminal(node, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    node.terminal.writeln(`\x1b[38;5;204mFailed to start shell${profileId ? ` "${profileId}"` : ''}: ${message}\x1b[0m`);
  }
}

function ensurePaneNodes() {
  const activeIds = new Set(panes.map((pane) => pane.id));

  for (const [paneId, node] of paneNodeMap.entries()) {
    if (!activeIds.has(paneId)) {
      bridge.destroyTerminal({ paneId });
      node.terminal.dispose();
      node.root.remove();
      paneNodeMap.delete(paneId);
    }
  }

  for (const pane of panes) {
    if (!paneNodeMap.has(pane.id)) {
      const node = createPane(pane);
      paneNodeMap.set(pane.id, node);
      stageEl.append(node.root);
      requestAnimationFrame(() => {
        initializePaneTerminal(node);
      });
    }
  }
}

function createPaneData() {
  const accent = accentPalette[(nextPaneNumber - 1) % accentPalette.length];
  const focusedPane = panes[getFocusedIndex()];
  const pane = {
    id: `p${nextPaneNumber}`,
    title: null,
    terminalTitle: bridge.defaultTabTitle,
    cwd: focusedPane?.cwd || bridge.defaultCwd,
    accent,
    shellProfileId: null,
  };

  nextPaneNumber += 1;
  return pane;
}

function focusPane(paneId, options = {}) {
  const { focusTerminal = true } = options;
  focusedPaneId = paneId;
  isNavigationMode = false;
  render();
  const node = paneNodeMap.get(paneId);
  if (node && focusTerminal) {
    requestAnimationFrame(() => {
      node.terminal.focus();
    });
  }
}

function addPane() {
  const newPane = createPaneData();
  panes = [...panes, newPane];
  focusedPaneId = newPane.id;
  render(true);
}

function closePane(index, options = {}) {
  const { destroyTerminal = true } = options;

  if (panes.length === 1) {
    return;
  }

  const closingPane = panes[index];
  if (!closingPane) {
    return;
  }

  if (closingPane.id === renamingPaneId) {
    renamingPaneId = null;
  }

  if (closingPane.id === dragState?.paneId) {
    endTabDrag();
  }

  if (closingPane.id === pendingTabFocus?.paneId) {
    clearPendingTabFocus();
  }

  if (destroyTerminal) {
    bridge.destroyTerminal({ paneId: closingPane.id });
  }

  const remainingPanes = panes.filter((_, paneIndex) => paneIndex !== index);
  if (closingPane.id === focusedPaneId) {
    const fallbackIndex = Math.max(0, index - 1);
    focusedPaneId = remainingPanes[fallbackIndex]?.id ?? remainingPanes[0]?.id ?? null;
  }
  panes = remainingPanes;

  render(true);
}

function beginRenamePane(index) {
  const pane = panes[index];
  if (!pane) {
    return;
  }

  clearPendingTabFocus();
  renamingPaneId = pane.id;
  try {
    render();
  } catch (error) {
    renamingPaneId = null;
    reportError(error);
  }
}

function cancelRenamePane() {
  renamingPaneId = null;
  try {
    render();
  } catch (error) {
    reportError(error);
  }
}

function commitRenamePane(paneId, nextTitle) {
  const trimmedTitle = nextTitle.trim();
  renamingPaneId = null;

  panes = panes.map((entry) =>
    entry.id === paneId ? { ...entry, title: trimmedTitle || null } : entry
  );

  try {
    render();
  } catch (error) {
    reportError(error);
  }
}

function clearPendingTabFocus() {
  if (!pendingTabFocus) {
    return;
  }

  window.clearTimeout(pendingTabFocus.timerId);
  pendingTabFocus = null;
}

function scheduleTabFocus(paneId) {
  clearPendingTabFocus();
  pendingTabFocus = {
    paneId,
    timerId: window.setTimeout(() => {
      pendingTabFocus = null;
      focusPane(paneId);
    }, 180),
  };
}

function activateTabPointerUp(paneId) {
  if (pendingTabFocus?.paneId === paneId) {
    clearPendingTabFocus();
    const paneIndex = panes.findIndex((pane) => pane.id === paneId);
    if (paneIndex !== -1) {
      beginRenamePane(paneIndex);
    }
    return;
  }

  scheduleTabFocus(paneId);
}

function beginTabDrag(index, event) {
  if (event.button !== 0 || renamingPaneId !== null) {
    return;
  }

  const pane = panes[index];
  if (!pane) {
    return;
  }

  event.preventDefault();
  dragState = {
    paneId: pane.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    currentX: event.clientX,
    dropIndex: index,
    hasMoved: false,
  };

  document.body.classList.add('is-dragging-tabs');
  window.addEventListener('pointermove', handleTabPointerMove);
  window.addEventListener('pointerup', handleTabPointerUp);
  window.addEventListener('pointercancel', handleTabPointerUp);
}

function handleTabPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  dragState.currentX = event.clientX;
  const offsetX = dragState.currentX - dragState.startX;
  const hasMoved = Math.abs(offsetX) > 4;

  if (!hasMoved && !dragState.hasMoved) {
    return;
  }

  dragState.hasMoved = true;
  dragState.dropIndex = getTabDropIndex(event.clientX);
  renderTabs();
}

function handleTabPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const { paneId, dropIndex, hasMoved } = dragState;
  endTabDrag();

  if (!hasMoved) {
    activateTabPointerUp(paneId);
    return;
  }

  const pane = panes.find((entry) => entry.id === paneId);
  const nextPanes = panes.filter((entry) => entry.id !== paneId);
  const insertionIndex = Math.max(0, Math.min(dropIndex, nextPanes.length));
  nextPanes.splice(insertionIndex, 0, pane);
  panes = nextPanes;
  render();
}

function endTabDrag() {
  dragState = null;
  document.body.classList.remove('is-dragging-tabs');
  window.removeEventListener('pointermove', handleTabPointerMove);
  window.removeEventListener('pointerup', handleTabPointerUp);
  window.removeEventListener('pointercancel', handleTabPointerUp);
}

function getTabDropIndex(clientX) {
  const tabElements = [...tabsListEl.querySelectorAll('.tab')].filter(
    (tab) => tab.dataset.paneId !== dragState?.paneId
  );

  let slot = 0;
  for (const tab of tabElements) {
    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return slot;
    }
    slot += 1;
  }

  return slot;
}

function renderTabs() {
  if (isRenderingTabs) {
    return;
  }
  isRenderingTabs = true;
  const focusedIndex = getFocusedIndex();
  const draggedPaneId = dragState?.paneId ?? null;
  let slot = 0;

  tabsListEl.replaceChildren(
    ...panes.map((pane, index) => {
      const isDragging = pane.id === draggedPaneId && dragState?.hasMoved;
      const insertBefore = !isDragging && dragState?.hasMoved && dragState.dropIndex === slot;
      const dragMeta = {
        isDragging,
        insertBefore,
        offsetX: isDragging ? dragState.currentX - dragState.startX : 0,
      };
      if (!isDragging) {
        slot += 1;
      }
      return createTab(pane, index, focusedIndex, dragMeta);
    })
  );
  isRenderingTabs = false;
}

function renderPanes(refit = false) {
  const stageWidth = stageEl.clientWidth;
  const stageHeight = stageEl.clientHeight;
  const previewWidth = getPreviewWidth(stageWidth, panes.length);
  const focusedIndex = getFocusedIndex();

  ensurePaneNodes();

  panes.forEach((pane, index) => {
    const node = paneNodeMap.get(pane.id);
    const left = getPaneLeft(index, previewWidth, focusedIndex);
    const isFocused = index === focusedIndex;

    node.root.classList.toggle('is-focused', isFocused);
    node.root.classList.toggle('is-navigation-target', isFocused && isNavigationMode);
    node.root.style.setProperty('--pane-accent', pane.accent);
    node.root.style.left = `${left}px`;
    node.root.style.zIndex = String(index + 1);
    node.root.style.height = `${stageHeight}px`;

    if (node.accent !== pane.accent) {
      node.terminal.options.theme = createTerminalTheme(pane.accent);
      node.accent = pane.accent;
    }

    if (refit || node.needsFit) {
      fitTerminal(node, true);
    }
  });
}

function render(refit = false) {
  renderTabs();
  renderPanes(refit);
  updateStatus();
  if (sessionRestoreComplete) {
    scheduleSettingsSave();
  }
}

function moveFocus(delta) {
  if (panes.length === 0) {
    return;
  }

  const focusedIndex = getFocusedIndex();
  const nextIndex = (focusedIndex + delta + panes.length) % panes.length;
  focusedPaneId = panes[nextIndex].id;
  render();
}

function isEditableTarget() {
  return (
    document.activeElement?.tagName === 'INPUT' ||
    document.activeElement?.classList?.contains('xterm-helper-textarea')
  );
}

function getPaneIndex(paneId) {
  return panes.findIndex((pane) => pane.id === paneId);
}

function getPaneNode(paneId) {
  return paneNodeMap.get(paneId) ?? null;
}

async function getClipboardSnapshot() {
  try {
    return await bridge.getClipboardSnapshot?.() ?? { text: '', hasImage: false };
  } catch {
    return { text: '', hasImage: false };
  }
}

function isWindowsCtrlVPasteHotkey(event) {
  return (
    bridge.platform === 'win32' &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'v'
  );
}

function copyTerminalSelection(paneId = focusedPaneId) {
  const node = getPaneNode(paneId);
  if (!node) {
    return false;
  }

  const selection = node.terminal.getSelection();
  if (!selection) {
    return false;
  }

  bridge.writeClipboardText(selection);
  return true;
}

async function pasteIntoTerminal(paneId = focusedPaneId, options = {}) {
  const node = getPaneNode(paneId);
  if (!node?.sessionReady) {
    return false;
  }

  const text = options.clipboardSnapshot?.text ?? (await bridge.readClipboardText());
  if (!text) {
    return false;
  }

  if (bridge.platform === 'win32') {
    node.terminal.paste(text);
  } else {
    bridge.writeTerminal({ paneId: node.paneId, data: text });
  }
  return true;
}

function selectAllInTerminal(paneId = focusedPaneId) {
  const node = getPaneNode(paneId);
  if (!node) {
    return false;
  }

  node.terminal.selectAll();
  return true;
}

function showContextMenu(items, x, y, paneId) {
  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      continue;
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'context-menu-item';
    row.setAttribute('role', 'menuitem');
    row.disabled = item.disabled || false;

    const label = document.createElement('span');
    label.className = 'context-menu-label';
    label.textContent = item.label;
    row.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement('span');
      shortcut.className = 'context-menu-shortcut';
      shortcut.textContent = item.shortcut;
      row.appendChild(shortcut);
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      handleMenuAction(item.action, paneId);
    });

    if (item.children?.length) {
      row.classList.add('context-menu-parent');
      const submenu = document.createElement('div');
      submenu.className = 'context-menu-submenu';
      submenu.setAttribute('role', 'menu');
      for (const child of item.children) {
        const childRow = document.createElement('button');
        childRow.type = 'button';
        childRow.className = 'context-menu-item';
        childRow.setAttribute('role', 'menuitem');
        childRow.disabled = child.disabled || false;

        const childLabel = document.createElement('span');
        childLabel.className = 'context-menu-label';
        childLabel.textContent = child.label;
        childRow.appendChild(childLabel);

        if (child.isDefault) {
          const check = document.createElement('span');
          check.className = 'context-menu-shortcut';
          check.textContent = '★';
          childRow.appendChild(check);
        }

        childRow.addEventListener('click', (e) => {
          e.stopPropagation();
          hideContextMenu();
          handleMenuAction(child.action, paneId);
        });

        submenu.appendChild(childRow);
      }
      row.appendChild(submenu);
    }

    menu.appendChild(row);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    if (rect.right > winW) {
      menu.style.left = `${Math.max(0, x - rect.width)}px`;
    }
    if (rect.bottom > winH) {
      menu.style.top = `${Math.max(0, y - rect.height)}px`;
    }
  });

  queueMicrotask(() => {
    document.addEventListener('pointerdown', dismissContextMenuOnOutside);
    window.addEventListener('blur', hideContextMenu);
  });
}

function hideContextMenu() {
  const menu = document.querySelector('.context-menu');
  if (menu) {
    menu.remove();
  }
  document.removeEventListener('pointerdown', dismissContextMenuOnOutside);
  window.removeEventListener('blur', hideContextMenu);
}

function dismissContextMenuOnOutside(event) {
  if (!event.target.closest('.context-menu')) {
    hideContextMenu();
  }
}

async function showTerminalContextMenu(node, event) {
  const clipboardSnapshot = await getClipboardSnapshot();

  const shellChildren = shellProfiles.map((p) => ({
    label: p.name || p.id,
    action: `terminal-change-shell:${p.id}`,
    isDefault: p.id === defaultShellProfileId,
  }));

  const items = [
    { label: 'Copy', action: 'terminal-copy', disabled: !node.terminal.hasSelection(), shortcut: '⇧⌘C' },
    { label: 'Paste', action: 'terminal-paste', disabled: !clipboardSnapshot.text, shortcut: '⇧⌘V' },
    { label: 'Paste Image', action: 'terminal-paste-image', disabled: !clipboardSnapshot.hasImage },
    { type: 'separator' },
    { label: 'Select All', action: 'terminal-select-all', shortcut: '⌘A' },
  ];

  if (shellChildren.length > 0) {
    items.push(
      { type: 'separator' },
      { label: 'Change Shell', children: shellChildren },
    );
  }

  showContextMenu(items, event.clientX, event.clientY, node.paneId);
}

function showTabContextMenu(paneId, event) {
  const paneIndex = getPaneIndex(paneId);
  if (paneIndex === -1) {
    return;
  }

  focusedPaneId = paneId;
  render();

  const items = [
    { label: 'Rename Tab', action: 'tab-rename' },
    { label: 'Close Tab', action: 'tab-close', disabled: panes.length <= 1 },
  ];
  showContextMenu(items, event.clientX, event.clientY, paneId);
}

async function pasteImageIntoTerminal(paneId = focusedPaneId, options = {}) {
  const node = getPaneNode(paneId);
  if (!node?.sessionReady) {
    return false;
  }

  const clipboardSnapshot = options.clipboardSnapshot ?? (await getClipboardSnapshot());
  if (!clipboardSnapshot.hasImage) {
    return false;
  }

  bridge.writeTerminal({ paneId: node.paneId, data: '\u0016' });
  return true;
}

function handleMenuAction(action, paneId) {
  if (action === 'terminal-copy') {
    copyTerminalSelection(paneId);
    return;
  }

  if (action === 'terminal-paste') {
    void pasteIntoTerminal(paneId);
    return;
  }

  if (action === 'terminal-paste-image') {
    pasteImageIntoTerminal(paneId);
    return;
  }

  if (action === 'terminal-select-all') {
    selectAllInTerminal(paneId);
    return;
  }

  if (action === 'tab-rename') {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex !== -1) {
      beginRenamePane(paneIndex);
    }
    return;
  }

  if (action === 'tab-close') {
    const paneIndex = getPaneIndex(paneId);
    if (paneIndex !== -1) {
      closePane(paneIndex);
    }
    return;
  }

  if (action.startsWith('terminal-change-shell:')) {
    const profileId = action.slice('terminal-change-shell:'.length);
    changePaneShell(paneId, profileId);
  }
}

function blurFocusedTerminal() {
  const node = paneNodeMap.get(focusedPaneId);
  if (node) {
    node.terminal.blur();
  }
}

function enterNavigationMode() {
  if (panes.length === 0) {
    return;
  }

  isNavigationMode = true;
  blurFocusedTerminal();
  render();
}

function updateStatus() {
  const focusedPane = panes[getFocusedIndex()];

  if (isNavigationMode) {
    statusLabelEl.classList.add('is-navigation-mode');
    statusLabelEl.textContent = 'Navigation Mode';
    statusHintEl.textContent = 'Left/Right or H/L to flip; Enter to Focus';
    return;
  }

  statusLabelEl.classList.remove('is-navigation-mode');
  statusLabelEl.textContent = `Focused: ${getPaneLabel(focusedPane) || focusedPane.id}`;
  statusHintEl.textContent = 'Ctrl+B to enter navigation mode';
}

window.addEventListener(
  'keydown',
  (event) => {
    const key = event.key.toLowerCase();
    const isMac = bridge.platform === 'darwin';
    const openTabHotkey = isMac
      ? event.metaKey && !event.ctrlKey && !event.altKey && key === 't'
      : event.ctrlKey && !event.metaKey && !event.altKey && key === 't';
    const enterNavigationHotkey =
      event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === 'b';
    const copyHotkey = isMac
      ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'c'
      : event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === 'c';
    const pasteHotkey = isMac
      ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'v'
      : event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === 'v';
    const windowsCtrlVPasteHotkey = isWindowsCtrlVPasteHotkey(event);

    if (openTabHotkey) {
      event.preventDefault();
      addPane();
      return;
    }

    if (enterNavigationHotkey && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      enterNavigationMode();
      return;
    }

    if (copyHotkey && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      copyTerminalSelection();
      return;
    }

    if ((pasteHotkey || windowsCtrlVPasteHotkey) && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      void pasteIntoTerminal();
      return;
    }

    if (isEditableTarget() || !isNavigationMode) {
      return;
    }

    if (event.key === 'ArrowLeft' || key === 'h') {
      event.preventDefault();
      moveFocus(-1);
      return;
    }

    if (event.key === 'ArrowRight' || key === 'l') {
      event.preventDefault();
      moveFocus(1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      focusPane(focusedPaneId);
    }
  },
  true
);

addPaneButtonEl.addEventListener('click', () => {
  try {
    addPane();
  } catch (error) {
    reportError(error);
  }
});

settingsButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  const wasHidden = settingsPanelEl.classList.toggle('is-hidden');
  if (wasHidden) {
    editingShellProfile = null;
    loadShellProfiles();
  }
});

// Fullscreen toggle
function isFullscreenSupported() {
  return (
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen ||
    false
  );
}

function getIsFullscreen() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    null
  );
}

function updateFullscreenButton() {
  const isFs = getIsFullscreen();
  fullscreenButtonEl.classList.toggle('is-fullscreen', Boolean(isFs));
  fullscreenButtonEl.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Enter fullscreen');
}

function toggleFullscreen() {
  if (!isFullscreenSupported()) {
    return;
  }

  if (getIsFullscreen()) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } else {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    }
  }
}

function hideFullscreenButtonIfUnsupported() {
  if (!isFullscreenSupported()) {
    fullscreenButtonEl.classList.add('is-hidden');
  }
}

document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

fullscreenButtonEl.addEventListener('click', () => {
  toggleFullscreen();
});

hideFullscreenButtonIfUnsupported();

settingsPanelEl.addEventListener('click', (event) => {
  event.stopPropagation();
});

shellProfileAddBtn.addEventListener('click', () => {
  editingShellProfile = { id: '', name: '', command: '', args: '' };
  renderShellProfiles();
});

fontSizeInputEl.addEventListener('change', () => {
  const nextValue = Number(fontSizeInputEl.value);
  if (!Number.isFinite(nextValue)) {
    applySettings();
    return;
  }

  settings.fontSize = Math.max(10, Math.min(24, Math.round(nextValue)));
  applySettings();
  render(true);
  scheduleSettingsSave();
});

fontFamilyInputEl.addEventListener('change', () => {
  settings.fontFamily = fontFamilyInputEl.value.trim() || getDefaultFontFamily(bridge.platform);
  applySettings();
  render(true);
  scheduleSettingsSave();
});

function updatePaneWidth(nextValue) {
  const parsedValue = Number(nextValue);
  if (!Number.isFinite(parsedValue)) {
    applySettings();
    return;
  }

  settings.paneWidth = Math.max(520, Math.min(2000, Math.round(parsedValue / 10) * 10));
  applySettings();
  render(true);
  scheduleSettingsSave();
}

function updatePaneOpacity(nextValue) {
  const parsedValue = Number(nextValue);
  if (!Number.isFinite(parsedValue)) {
    applySettings();
    return;
  }

  settings.paneOpacity = Math.max(0.55, Math.min(1, Number(parsedValue.toFixed(2))));
  applySettings();
  scheduleSettingsSave();
}

function updatePaneMaskOpacity(nextValue) {
  const parsedValue = Number(nextValue);
  if (!Number.isFinite(parsedValue)) {
    applySettings();
    return;
  }

  settings.paneMaskOpacity = Math.max(0, Math.min(0.8, Number(parsedValue.toFixed(2))));
  applySettings();
  scheduleSettingsSave();
}

paneWidthRangeEl.addEventListener('input', () => {
  updatePaneWidth(paneWidthRangeEl.value);
});

paneWidthInputEl.addEventListener('change', () => {
  updatePaneWidth(paneWidthInputEl.value);
});

paneOpacityRangeEl.addEventListener('input', () => {
  updatePaneOpacity(paneOpacityRangeEl.value);
});

paneOpacityInputEl.addEventListener('change', () => {
  updatePaneOpacity(paneOpacityInputEl.value);
});

paneMaskOpacityRangeEl.addEventListener('input', () => {
  updatePaneMaskOpacity(paneMaskOpacityRangeEl.value);
});

paneMaskOpacityInputEl.addEventListener('change', () => {
  updatePaneMaskOpacity(paneMaskOpacityInputEl.value);
});

window.addEventListener('pointerdown', (event) => {
  if (
    !settingsPanelEl.classList.contains('is-hidden') &&
    !settingsPanelEl.contains(event.target) &&
    !settingsButtonEl.contains(event.target)
  ) {
    settingsPanelEl.classList.add('is-hidden');
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsPanelEl.classList.contains('is-hidden')) {
    settingsPanelEl.classList.add('is-hidden');
  }
});

window.addEventListener('resize', () => {
  try {
    render(true);
  } catch (error) {
    reportError(error);
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await bridge.cwdReady;

    const savedSettings = await bridge.loadSettings();
    applyPersistedSettings(savedSettings);
    applySettings();
    loadShellProfiles();

    if (savedSettings?.session?.panes?.length > 0) {
      restoreSession(savedSettings.session);
    } else {
      panes = panes.map((p) =>
        p.title === null
          ? { ...p, cwd: bridge.defaultCwd, terminalTitle: bridge.defaultTabTitle }
          : p
      );
    }

    render(true);
    sessionRestoreComplete = true;
  } catch (error) {
    reportError(error);
  }
});

window.addEventListener('beforeunload', () => {
  flushSettingsSave();
  removeTerminalDataListener();
  removeTerminalExitListener();
  removeMenuActionListener();
});

window.addEventListener('error', (event) => {
  reportError(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason);
});
