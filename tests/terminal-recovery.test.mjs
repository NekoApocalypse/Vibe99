import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalRecovery, promptMarker } from '../src/terminal-recovery.mjs';
import { normalizeExternalUrl } from '../src/external-links.mjs';

function fixture() {
  const writes = [];
  let changeBuffer, csi;
  const terminal = {
    buffer: { active: { type: 'normal' }, onBufferChange(fn) { changeBuffer = fn; return { dispose() {} }; } },
    parser: { registerCsiHandler(_id, fn) { csi = fn; return { dispose() {} }; } },
    modes: { mouseTrackingMode: 'none' },
    write(data, callback) { writes.push({ data, callback }); },
  };
  let session = 'current-session';
  const recovery = createTerminalRecovery({ terminal, getSessionId: () => session });
  return { terminal, recovery, writes, csi: params => csi(params),
    setSession(id) { session = id; },
    setBuffer(type) { terminal.buffer.active = { type }; changeBuffer(terminal.buffer.active); },
    drain() { while (writes.some(w => w.callback)) { const w = writes.find(w => w.callback); const cb = w.callback; w.callback = null; cb(); } },
  };
}
const wheel = () => ({ deltaY: 1, deltaMode: 0, prevented: false, stopped: false,
  preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

test('URL allowlist accepts only absolute HTTP(S) URLs', () => {
  assert.equal(normalizeExternalUrl('HTTPS://example.com/a?q=1#b'), 'https://example.com/a?q=1#b');
  for (const value of ['javascript:alert(1)', 'file:///C:/secret', 'mailto:a@b.com', 'vscode://x',
    '//example.com', '/relative', 'https://exa\nmple.com', ' https://example.com', null]) {
    assert.equal(normalizeExternalUrl(value), null, String(value));
  }
});

test('manual recovery blocks only this alt session and consumes the wheel event', () => {
  const f = fixture();
  f.setBuffer('alternate');
  assert.equal(f.recovery.handleWheel(wheel()), true);
  f.recovery.recover(); f.drain();
  const event = wheel();
  assert.equal(f.recovery.handleWheel(event), false);
  assert(event.prevented && event.stopped);
  assert.equal(f.terminal.buffer.active.type, 'alternate');
  f.csi([1006]);
  assert.equal(f.recovery.handleWheel(wheel()), false, 'encoding alone is not tracking');
  f.csi([1000]);
  assert.equal(f.recovery.handleWheel(wheel()), true);
  f.recovery.recover(); f.drain();
  f.setBuffer('normal'); f.setBuffer('alternate');
  assert.equal(f.recovery.handleWheel(wheel()), true);
  f.recovery.recover(); f.drain(); f.setSession('replacement');
  assert.equal(f.recovery.handleWheel(wheel()), true);
});

test('split authenticated markers preserve write order and bounded partial ACK progress', () => {
  for (let cut = 1; cut < promptMarker('current-session').length; cut++) {
    const f = fixture(), callbacks = [];
    f.setBuffer('alternate');
    const marker = promptMarker('current-session');
    f.recovery.write('before' + marker.slice(0, cut), () => callbacks.push(1));
    assert.deepEqual(callbacks, []);
    f.drain();
    assert.deepEqual(callbacks, [1]);
    assert.equal(f.writes.map(w => w.data).join(''), 'before');
    f.recovery.write(marker.slice(cut) + 'prompt', () => callbacks.push(2));
    assert.equal(f.writes.at(-1).data, '\x1b[?1049l');
    assert.deepEqual(callbacks, [1]);
    f.drain();
    assert.deepEqual(callbacks, [1, 2]);
    assert.equal(f.writes.map(w => w.data).join(''), 'before\x1b[?1049lprompt');
  }
});

test('normal prompt does not restore cursor; stale token and malformed markers pass through', () => {
  const f = fixture();
  f.recovery.write(promptMarker('current-session') + 'PS> '); f.drain();
  assert.equal(f.writes.map(w => w.data).join(''), 'PS> ');
  f.setBuffer('alternate');
  const stale = promptMarker('old-session') + '\x1b]633;Vibe99Prompt;' + 'x'.repeat(500);
  f.recovery.write(stale); f.drain();
  assert.equal(f.writes.at(-1).data, stale);
  assert(!f.writes.some(w => w.data.includes('1049l')));
});

test('diagnostics are opt-in, bounded and never retain ordinary input or screen text', () => {
  const f = fixture();
  f.recovery.handleWheel(wheel()); f.recovery.classifyInput('\x1b[A');
  assert.deepEqual(f.recovery.getDiagnostics(), []);
  f.recovery.setDiagnostics(true);
  f.recovery.classifyInput('\x1b[A');
  assert.deepEqual(f.recovery.getDiagnostics(), []);
  for (let i = 0; i < 100; i++) {
    f.recovery.handleWheel(wheel());
    f.recovery.classifyInput('secret password');
    f.recovery.classifyInput('\x1b[A');
  }
  const records = f.recovery.getDiagnostics();
  assert.equal(records.length, 64);
  assert.equal(records.at(-1).classification, 'arrow');
  assert(!JSON.stringify(records).includes('secret'));
  f.recovery.setDiagnostics(false);
  f.recovery.handleWheel(wheel()); f.recovery.classifyInput('\x1b[A');
  assert.deepEqual(f.recovery.getDiagnostics(), records, 'Stopping retains a copyable recording without adding events');
  assert.equal(f.recovery.diagnosticsEnabled(), false);
  f.recovery.setDiagnostics(true);
  assert.deepEqual(f.recovery.getDiagnostics(), []);
});
