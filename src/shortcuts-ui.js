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
    'new-tab': 'New Tab',
    'navigation-mode': 'Navigation Mode',
    'copy': 'Copy',
    'paste': 'Paste',
    'move-left': 'Move Left',
    'move-right': 'Move Right',
    'focus-terminal': 'Focus Terminal',
  };
  return names[actionId] || actionId;
}

/**
 * Get description for shortcut actions
 */
function getShortcutActionDescription(actionId) {
  const descriptions = {
    'new-tab': 'Create a new terminal pane',
    'navigation-mode': 'Enter keyboard navigation mode',
    'copy': 'Copy selected text to clipboard',
    'paste': 'Paste clipboard content to terminal',
    'move-left': 'Focus previous pane in navigation mode',
    'move-right': 'Focus next pane in navigation mode',
    'focus-terminal': 'Focus the selected terminal',
  };
  return descriptions[actionId] || '';
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
  overlay.querySelector('#modal-shortcuts-reset').addEventListener('click', () => {
    if (confirm('Reset all keyboard shortcuts to their default values?')) {
      ShortcutsRegistry.resetShortcutsToDefaults();
      scheduleSettingsSave();
      renderModalShortcuts();
    }
  });

  document.body.appendChild(overlay);

  // Store reference to modal list for rendering
  overlay._modalShortcutsList = overlay.querySelector('#modal-shortcuts-list');

  renderModalShortcuts();
}

/**
 * Render the shortcuts list in the modal
 */
function renderModalShortcuts() {
  const overlay = document.querySelector('.settings-modal-overlay');
  if (!overlay || !overlay._modalShortcutsList) return;

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
  const overlay = document.createElement('div');
  overlay.className = 'shortcut-recorder-overlay';
  overlay.id = 'shortcut-recorder-overlay';
  overlay.tabIndex = -1; // Make it focusable

  overlay.innerHTML = `
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

  document.body.appendChild(overlay);

  let recordedShortcut = null;
  const keysDisplay = overlay.querySelector('#shortcut-recorder-keys');
  const saveBtn = overlay.querySelector('#shortcut-recorder-save');
  const cancelBtn = overlay.querySelector('#shortcut-recorder-cancel');

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
    overlay.remove();
  };

  cancelBtn.addEventListener('click', closeShortcutRecorder);

  saveBtn.addEventListener('click', () => {
    if (recordedShortcut) {
      // Update the shortcut
      ShortcutsRegistry.updateKeyboardShortcut(shortcutId, {
        key: recordedShortcut.key,
        modifiers: recordedShortcut.modifiers,
      });

      // Save and update UI
      // Note: scheduleSettingsSave should be passed from the caller
      if (onRecordComplete) {
        onRecordComplete();
      }
      closeShortcutRecorder();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeShortcutRecorder();
    }
  });

  // Make overlay focusable and focus it
  overlay.style.outline = 'none';
  overlay.focus();
}