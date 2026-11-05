// Clipboard bytes never enter the terminal stream. Only a completed file path does.
export function createClipboardPaste({ bridge, getNode, getActiveId, askTarget, onError }) {
  return async function paste(paneId, { imageOnly = false } = {}) {
    const node = getNode(paneId);
    if (!node?.sessionReady || node.pastePending) return false;
    const sessionId = node.sessionId, epoch = node.previewContextEpoch || 0;
    const current = () => getNode(paneId) === node && node.sessionReady && node.sessionId === sessionId
      && (node.previewContextEpoch || 0) === epoch && getActiveId() === paneId;
    node.pastePending = true;
    let notice;
    try {
      const content = bridge.captureClipboard
        ? await bridge.captureClipboard({ imageOnly })
        : { text: imageOnly ? '' : await bridge.readClipboardText() };
      if (!current()) return false;
      if (!content.imageId) {
        if (content.text) node.terminal.paste(content.text);
        return Boolean(content.text);
      }
      notice = document.createElement('div'); notice.className = 'clipboard-paste-notice';
      notice.setAttribute('role', 'status'); notice.textContent = 'Preparing image…'; node.root.append(notice);
      // Always inspect fresh: an SSH process can start after a local paste.
      const context = await bridge.terminalPreviewContext({ paneId, sessionId });
      if (!current()) return false;
      let target, rememberTarget = false;
      if (context.kind === 'ssh') target = context.target;
      else if (context.kind === 'local') target = null;
      else if (node.imagePasteTarget !== undefined) target = node.imagePasteTarget;
      else {
        const answer = await askTarget(context);
        if (!answer || !current()) return false;
        target = answer.target.trim() || null;
        rememberTarget = true;
      }
      notice.textContent = target ? 'Uploading image…' : 'Preparing image…';
      const path = await bridge.resolveImagePath({ paneId, sessionId, imageId: content.imageId, target });
      if (!current()) return false;
      if (typeof path !== 'string' || !path || /[\x00-\x1f\x7f"`$]/.test(path)) throw Error('Invalid pasted image path');
      if (rememberTarget) node.imagePasteTarget = target;
      // xterm applies bracketed paste according to the TUI's current mode,
      // including when tmux owns that mode. Never append Enter or raw Ctrl+V.
      node.terminal.paste(/\s/.test(path) ? `"${path}"` : path);
      return true;
    } catch (error) {
      if (current()) onError(error);
      return false;
    } finally {
      notice?.remove(); node.pastePending = false;
    }
  };
}
