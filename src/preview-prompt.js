// Only used when a file reference lacks enough pane context, or for manual entry.
export function askPreviewDetails({ title, message = '', fields }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'preview-context-dialog';
    const form = document.createElement('form'); form.method = 'dialog';
    const heading = document.createElement('h2'); heading.textContent = title;
    const text = document.createElement('p'); text.textContent = message;
    form.append(heading, text);
    for (const field of fields) {
      const label = document.createElement('label'); label.textContent = field.label;
      const input = document.createElement('input'); input.name = field.name;
      input.value = field.value || ''; input.placeholder = field.placeholder || '';
      input.required = Boolean(field.required); input.autocomplete = 'off'; input.spellcheck = false;
      label.append(input); form.append(label);
    }
    const buttons = document.createElement('div'); buttons.className = 'preview-context-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const open = document.createElement('button'); open.type = 'submit'; open.textContent = 'Open preview';
    buttons.append(cancel, open); form.append(buttons); dialog.append(form); document.body.append(dialog);
    let settled = false;
    const finish = value => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); };
    form.addEventListener('submit', event => { event.preventDefault(); finish(Object.fromEntries(new FormData(form))); });
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.showModal(); form.querySelector('input')?.focus();
  });
}
