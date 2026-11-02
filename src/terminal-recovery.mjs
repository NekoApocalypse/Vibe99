export const MOUSE_RESET = '\x1b[?9;1000;1002;1003;1004;1006;1016l';
const PROMPT_PREFIX = '\x1b]633;Vibe99Prompt;';
const DIAGNOSTIC_LIMIT = 64;

export function promptMarker(sessionId) {
  return typeof sessionId === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(sessionId)
    ? `${PROMPT_PREFIX}${sessionId}\x07` : '';
}

// Uses only xterm's public buffer, modes, parser and write interfaces.
export function createTerminalRecovery({ terminal, getSessionId, onLocalPrompt }) {
  let disposed = false;
  let suppressAltWheelArrows = false;
  let sessionId = getSessionId();
  let carry = '';
  let diagnostics = false;
  let wheelUntil = 0;
  let lastWheel = null;
  const records = [];
  const queue = [];
  let writing = false;
  const isAlt = () => terminal.buffer.active.type === 'alternate';
  function record(kind, detail = {}) {
    if (!diagnostics) return;
    records.push({ kind, ...detail });
    if (records.length > DIAGNOSTIC_LIMIT) records.shift();
  }
  function syncSession() {
    const next = getSessionId();
    if (next !== sessionId) {
      sessionId = next;
      carry = '';
      suppressAltWheelArrows = false;
      wheelUntil = 0;
      records.length = 0;
    }
  }
  function observeWheel(event) {
    if (disposed || !diagnostics || event === lastWheel) return;
    syncSession();
    lastWheel = event;
    wheelUntil = Date.now() + 100;
    const tracking = terminal.modes.mouseTrackingMode;
    record('wheel', { buffer: terminal.buffer.active.type, tracking,
      blocked: suppressAltWheelArrows && isAlt() && tracking === 'none',
      direction: Math.sign(event.deltaY), deltaMode: event.deltaMode });
  }
  // Capture also observes wheels routed directly to mouse-reporting listeners.
  const element = terminal.element;
  element?.addEventListener('wheel', observeWheel, { capture: true, passive: true });
  const subscriptions = [
    terminal.buffer.onBufferChange(buffer => {
      if (buffer.type !== 'alternate') suppressAltWheelArrows = false;
      record('buffer', { buffer: buffer.type });
    }),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
      // 1006/1016 select an encoding; 1004 reports focus. None enables mouse tracking.
      if (params.some(p => [9, 1000, 1002, 1003].includes(p))) {
        suppressAltWheelArrows = false;
        record('mouse-tracking-enabled');
      }
      return false;
    }),
  ];

  function runNext() {
    if (writing || disposed || !queue.length) return;
    writing = true;
    const job = queue.shift();
    const done = () => {
      writing = false;
      if (disposed) return;
      job.callback?.();
      runNext();
    };
    syncSession();
    if (job.recover) {
      terminal.write(MOUSE_RESET, () => {
        if (disposed) return;
        suppressAltWheelArrows = isAlt();
        record('manual-recovery', { buffer: terminal.buffer.active.type });
        done();
      });
      return;
    }
    const marker = promptMarker(sessionId);
    let text = carry + job.data;
    carry = '';
    if (marker) {
      // Retain only a possible exact-marker suffix. ACK it after the preceding
      // text drains: this bounded carry must never hold up backend flow credits.
      for (let n = Math.min(text.length, marker.length - 1); n > 0; n--) {
        if (text.endsWith(marker.slice(0, n))) {
          carry = text.slice(-n);
          text = text.slice(0, -n);
          break;
        }
      }
    }
    const parts = marker ? text.split(marker) : [text];
    function writePart(index) {
      if (disposed) return;
      const next = () => {
        if (index === parts.length - 1) { done(); return; }
        // A top-level local prompt proves its foreground child returned. Never
        // restore the saved cursor on ordinary prompts already in normal mode.
        record('local-prompt', { buffer: terminal.buffer.active.type });
        onLocalPrompt?.();
        if (isAlt()) terminal.write('\x1b[?1049l', () => writePart(index + 1));
        else writePart(index + 1);
      };
      if (parts[index]) terminal.write(parts[index], next);
      else next();
    }
    writePart(0);
  }

  return {
    write(data, callback) {
      if (disposed) return;
      queue.push({ data, callback });
      runNext();
    },
    recover(callback) {
      if (disposed) return;
      queue.push({ recover: true, callback });
      runNext();
    },
    handleWheel(event) {
      syncSession();
      if (disposed) return true;
      const tracking = terminal.modes.mouseTrackingMode;
      if (!isAlt() || tracking !== 'none') suppressAltWheelArrows = false;
      const blocked = suppressAltWheelArrows && isAlt() && tracking === 'none';
      observeWheel(event);
      if (blocked) {
        // Returning false only bypasses xterm. Also stop ancestor preview scroll.
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
      return true;
    },
    classifyInput(data) {
      if (!diagnostics || Date.now() > wheelUntil) return;
      const classification = /^(?:\x1b(?:\[|O)[AB])+$/.test(data) ? 'arrow'
        : /^\x1b\[<\d+;\d+;\d+[mM]$/.test(data) ? 'sgr-mouse'
        : /^\x1b\[M[\s\S]{3}$/.test(data) ? 'legacy-mouse' : null;
      if (classification) record('wheel-output', { classification });
    },
    setDiagnostics(enabled) {
      diagnostics = Boolean(enabled);
      if (diagnostics) records.length = 0;
      wheelUntil = 0;
      lastWheel = null;
    },
    getDiagnostics() { return records.map(record => ({ ...record })); },
    diagnosticsEnabled: () => diagnostics,
    dispose() {
      disposed = true;
      carry = '';
      queue.length = 0;
      records.length = 0;
      element?.removeEventListener('wheel', observeWheel, { capture: true });
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}
