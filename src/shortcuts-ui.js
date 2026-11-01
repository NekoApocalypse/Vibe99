/**
 * Keyboard Shortcuts UI Module
 *
 * Handles the user interface for keyboard shortcuts management,
 * including the modal dialog and recording functionality.
 */

import * as ShortcutsRegistry from './shortcuts-registry.js';

/**
 * Get human-readable names for shortcut actions
 */
function getShortcutActionName(actionId) {
  const names = {
    'recover-mouse': 'Recover Mouse Input',
    'new-tab': 'New Tab',
    'navigation-mode': 'Navigation Mode',
    'copy': 'Copy',
    'paste': 'Paste',
    'navigate-left': 'Navigate Left',
    'navigate-right': 'Navigate Right',
    'nav-left': 'Focus Previous',
    'nav-right': 'Focus Next',
    'focus-first': 'Focus First',
    'focus-last': 'Focus Last',
    'jump-to': 'Jump to Pane',
    'new-pane': 'New Pane',
    'close-pane': 'Close Pane',
    'rename-pane': 'Rename Pane',
  };
  return names[actionId] || actionId;
}

/**
 * Get description for shortcut actions
 */
function getShortcutActionDescription(actionId) {
  const descriptions = {
    'recover-mouse': 'Stop mouse escape sequences after an interrupted terminal application',
    'new-tab': 'Create a new terminal pane',
    'navigation-mode': 'Enter keyboard navigation mode',
    'copy': 'Copy selected text to clipboard',
    'paste': 'Paste clipboard content to terminal',
    'navigate-left': 'Switch to the pane on the left',
    'navigate-right': 'Switch to the pane on the right',
    'nav-left': 'Focus previous pane (navigation mode)',
    'nav-right': 'Focus next pane (navigation mode)',
    'focus-first': 'Jump to first pane (navigation mode)',
    'focus-last': 'Jump to last pane (navigation mode)',
    'jump-to': 'Jump to pane 1-9 (navigation mode)',
    'new-pane': 'Create a new terminal pane (navigation mode)',
    'close-pane': 'Close current pane (navigation mode)',
    'rename-pane': 'Rename current pane (navigation mode)',
  };
  return descriptions[actionId] || '';
}

/**
 * Show a custom confirmation dialog. Returns a Promise that resolves to true/false.
 */
function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'shortcut-recorder-overlay';
    overlay.style.zIndex = '10002';

    overlay.innerHTML = `
      <div class="shortcut-recorder-dialog" style="max-width: 360px;">
        <div class="shortcut-recorder-title">Confirm</div>
        <div style="margin: 16px 0; color: var(--text); font-size: 14px;">${message}</div>
        <div class="shortcut-recorder-actions">
          <button type="button" class="shortcut-recorder-btn" id="confirm-cancel">Cancel</button>
          <button type="button" class="shortcut-recorder-btn is-primary" id="confirm-ok">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('#confirm-ok');
    const cancelBtn = overlay.querySelector('#confirm-cancel');

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    okBtn.addEventListener('click', () => cleanup(true));
    cancelBtn.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    okBtn.focus();
  });
}

/**
 * Open the keyboard shortcuts modal dialog
 */
export function openKeyboardShortcutsModal(bridge, scheduleSettingsSave) {
  const overlay = document.createElement('div');
  overlay.className = 'settings-modal-overlay';

  overlay.innerHTML = `
    <div class="settings-modal" style="min-width: 420px;">
      <div class="settings-modal-header">
        <span>Keyboard Shortcuts</span>
        <button type="button" class="settings-modal-close" aria-label="Close">×</button>
      </div>
      <div class="settings-modal-body" style="max-height: 450px; overflow-y: auto;">
        <div class="shortcuts-list" id="modal-shortcuts-list"></div>
      </div>
      <div class="settings-modal-footer">
        <button type="button" class="settings-modal-btn" id="modal-shortcuts-reset">Reset to Defaults</button>
        <button type="button" class="settings-modal-btn primary close-btn">Done</button>
      </div>
    </div>
  `;

  const closeModal = () => {
    overlay.remove();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelector('.settings-modal-close').addEventListener('click', closeModal);
  overlay.querySelector('.close-btn').addEventListener('click', closeModal);

  // Reset shortcuts button
  overlay.querySelector('#modal-shortcuts-reset').addEventListener('click', async () => {
    const confirmed = await showConfirmDialog('Reset all keyboard shortcuts to their default values?');
    if (confirmed) {
      ShortcutsRegistry.resetShortcutsToDefaults();
      scheduleSettingsSave();
      renderModalShortcuts();
    }
  });

  document.body.appendChild(overlay);

  // Store reference to modal list for rendering
  overlay._modalShortcutsList = overlay.querySelector('#modal-shortcuts-list');

  renderModalShortcuts();

  /**
   * Render the shortcuts list in the modal
   */
  function renderModalShortcuts() {
    const listEl = overlay._modalShortcutsList;
    if (!listEl) return;

    listEl.replaceChildren();

    const shortcuts = ShortcutsRegistry.getKeyboardShortcuts();

    for (const [id, shortcut] of Object.entries(shortcuts)) {
      const item = document.createElement('div');
      item.className = 'shortcut-item';

      const info = document.createElement('div');
      info.className = 'shortcut-info';

      const name = document.createElement('div');
      name.className = 'shortcut-name';
      name.textContent = getShortcutActionName(id);
      if (shortcut.mode === 'nav') {
        const badge = document.createElement('span');
        badge.className = 'shortcut-mode-badge';
        badge.textContent = 'Nav';
        name.appendChild(badge);
      }

      const description = document.createElement('div');
      description.className = 'shortcut-description';
      description.textContent = getShortcutActionDescription(id);

      info.append(name, description);

      const binding = document.createElement('div');
      binding.className = 'shortcut-binding';

      const keys = document.createElement('div');
      keys.className = 'shortcut-keys';
      keys.textContent = ShortcutsRegistry.formatShortcut(shortcut);
      keys.addEventListener('click', () => {
        startShortcutRecording(id, () => renderModalShortcuts());
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'shortcut-edit-btn';
      editBtn.textContent = '✎';
      editBtn.title = 'Change shortcut';
      editBtn.addEventListener('click', () => {
        startShortcutRecording(id, () => renderModalShortcuts());
      });

      binding.append(keys, editBtn);
      item.append(info, binding);
      listEl.appendChild(item);
    }
  }

  /**
   * Start recording a new keyboard shortcut
   */
  function startShortcutRecording(shortcutId, onRecordComplete) {
    const shortcuts = ShortcutsRegistry.getKeyboardShortcuts();
    const shortcut = shortcuts[shortcutId];
    if (!shortcut) return;

    // Create recording overlay
    const recorderOverlay = document.createElement('div');
    recorderOverlay.className = 'shortcut-recorder-overlay';
    recorderOverlay.id = 'shortcut-recorder-overlay';
    recorderOverlay.tabIndex = -1; // Make it focusable

    recorderOverlay.innerHTML = `
      <div class="shortcut-recorder-dialog">
        <div class="shortcut-recorder-title">Record Shortcut</div>
        <div class="shortcut-recorder-hint">Press your new key combination for "${getShortcutActionName(shortcutId)}"</div>
        <div class="shortcut-recorder-keys" id="shortcut-recorder-keys">
          <div class="shortcut-recorder-key">Press keys...</div>
        </div>
        <div class="shortcut-recorder-actions">
          <button type="button" class="shortcut-recorder-btn" id="shortcut-recorder-cancel">Cancel</button>
          <button type="button" class="shortcut-recorder-btn is-primary" id="shortcut-recorder-save" disabled>Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(recorderOverlay);

    let recordedShortcut = null;
    const keysDisplay = recorderOverlay.querySelector('#shortcut-recorder-keys');
    const saveBtn = recorderOverlay.querySelector('#shortcut-recorder-save');
    const cancelBtn = recorderOverlay.querySelector('#shortcut-recorder-cancel');

    const keydownHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();

      // Handle escape key
      if (event.key === 'Escape') {
        closeShortcutRecorder();
        return;
      }

      // Ignore modifier-only keypresses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
        return;
      }

      // Parse the shortcut
      const parsed = ShortcutsRegistry.parseShortcutEvent(event);

      // Update display
      keysDisplay.innerHTML = '';
      const modifiers = [...parsed.modifiers, parsed.key];
      for (const mod of modifiers) {
        const keyEl = document.createElement('div');
        keyEl.className = 'shortcut-recorder-key';
        keyEl.textContent = mod === 'ctrl' ? (navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl') :
                           mod === 'shift' ? (navigator.platform.toLowerCase().includes('mac') ? '⇧' : 'Shift') :
                           mod === 'alt' ? (navigator.platform.toLowerCase().includes('mac') ? '⌥' : 'Alt') :
                           mod === ' ' ? 'Space' : mod;
        keysDisplay.appendChild(keyEl);
      }

      // Check for conflicts
      const newShortcut = { key: parsed.key, modifiers: parsed.modifiers };
      const conflictId = ShortcutsRegistry.findConflict(newShortcut, shortcutId);

      if (conflictId) {
        const conflictWarning = document.createElement('div');
        conflictWarning.className = 'shortcut-conflict-warning';
        conflictWarning.textContent = `Conflicts with "${getShortcutActionName(conflictId)}"`;
        keysDisplay.appendChild(conflictWarning);
        saveBtn.disabled = true;
      } else {
        saveBtn.disabled = false;
        recordedShortcut = newShortcut;
      }
    };

    // Use window for event capture to ensure we get all keyboard events
    window.addEventListener('keydown', keydownHandler, true);

    const closeShortcutRecorder = () => {
      window.removeEventListener('keydown', keydownHandler, true);
      recorderOverlay.remove();
    };

    cancelBtn.addEventListener('click', closeShortcutRecorder);

    saveBtn.addEventListener('click', () => {
      if (recordedShortcut) {
        // Update the shortcut
        ShortcutsRegistry.updateKeyboardShortcut(shortcutId, {
          key: recordedShortcut.key,
          modifiers: recordedShortcut.modifiers,
        });

        // Persist to settings
        if (scheduleSettingsSave) {
          scheduleSettingsSave();
        }

        // Update UI
        if (onRecordComplete) {
          onRecordComplete();
        }
        closeShortcutRecorder();
      }
    });

    recorderOverlay.addEventListener('click', (e) => {
      if (e.target === recorderOverlay) {
        closeShortcutRecorder();
      }
    });

    // Make overlay focusable and focus it
    recorderOverlay.style.outline = 'none';
    recorderOverlay.focus();
  }
}
