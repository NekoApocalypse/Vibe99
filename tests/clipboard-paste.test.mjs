import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipboardPaste } from '../src/clipboard-paste.js';

function fixture() {
  const calls = [];
  let active = 'p1';
  const node = { sessionReady: true, sessionId: 'session-1', root: { append() {} },
    terminal: { focus: () => calls.push('focus'), paste: text => calls.push(['paste', text]) } };
  const bridge = { captureClipboard: async () => ({ text: 'text 中文\nsecond line' }),
    terminalPreviewContext: async () => ({ kind: 'local' }),
    resolveImagePath: async () => '/tmp/space folder/image-test.png' };
  const paste = createClipboardPaste({ bridge, getNode: () => node, getActiveId: () => active,
    askTarget: async () => { throw Error('local paste must not ask for SSH'); }, onError: e => { throw e; } });
  return { calls, node, bridge, paste, focusOther: () => { active = 'p2'; } };
}
test('text context paste restores input focus before one unsubmitted paste', async () => {
  const f = fixture();
  assert.equal(await f.paste('p1'), true);
  assert.deepEqual(f.calls, ['focus', ['paste', 'text 中文\nsecond line']]);
});
test('late clipboard result cannot steal focus or paste after switching panes', async () => {
  const f = fixture(); let resolve;
  f.bridge.captureClipboard = () => new Promise(r => { resolve = r; });
  const pending = f.paste('p1'); f.focusOther(); resolve({ text: 'late text' });
  assert.equal(await pending, false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.node.pastePending, false);
});
test('local image paste focuses once and quotes a space-containing path without Enter', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ setAttribute() {}, remove() {} }) };
  try {
    const f = fixture();
    f.bridge.captureClipboard = async () => ({ imageId: 'image-test.png' });
    assert.equal(await f.paste('p1'), true);
    assert.deepEqual(f.calls, ['focus', ['paste', '"/tmp/space folder/image-test.png"']]);
  } finally { globalThis.document = previous; }
});
