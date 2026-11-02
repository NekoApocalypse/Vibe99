import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewInput } from '../src/preview-input.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const sent = [], pending = [], errors = [];
  const queue = createPreviewInput({ ...options,
    send(data) { sent.push(Buffer.from(data, 'base64')); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    onError: error => errors.push(error),
  });
  return { queue, sent, pending, errors };
}

test('stalled remote request coalesces individual keystrokes without reordering text or binary input', async () => {
  const f = fixture();
  const input = 'echo individually typed input\r';
  for (const char of input) f.queue.push(char);
  f.queue.push('中文🙂');
  f.queue.push('\x1b[M\x80\xff\x21', true);
  assert.equal(f.sent.length, 1, 'only the first request can be in flight');
  assert.equal(f.sent[0].toString(), 'e');
  f.pending[0].resolve(); await tick();
  assert.equal(f.sent.length, 2, 'all input accumulated during RTT is one next batch');
  assert.deepEqual(Buffer.concat(f.sent), Buffer.concat([
    Buffer.from(input + '中文🙂'), Buffer.from([27, 91, 77, 128, 255, 33]),
  ]));
  f.pending[1].resolve(); await tick();
  assert.deepEqual(f.errors, []);
});

test('batches stay bounded and circular-buffer wrap preserves all bytes', async () => {
  const f = fixture({ batchBytes: 4, maxBytes: 16 });
  f.queue.push('abcdefghij');
  assert.equal(f.sent[0].length, 4);
  f.pending[0].resolve(); await tick();
  f.queue.push('klmnop');
  f.pending[1].resolve(); await tick();
  f.queue.push('qrstuv'); // Reuses the freed start of the ring while input is in flight.
  for (let i = 2; i < 6; i++) { f.pending[i].resolve(); await tick(); }
  assert.equal(Buffer.concat(f.sent).toString(), 'abcdefghijklmnopqrstuv');
  assert(f.sent.every(bytes => bytes.length <= 4));
});

test('dispose drops queued input and ignores a late in-flight failure', async () => {
  const f = fixture();
  f.queue.push('a'); f.queue.push('never send'); f.queue.dispose();
  f.pending[0].reject(Error('closed')); await tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.queue.push('later'), false);
  assert.deepEqual(f.errors, []);
});

test('send failure stops input and discards pending bytes without replay', async () => {
  const f = fixture();
  f.queue.push('a'); f.queue.push('not retried');
  f.pending[0].reject(Error('connection lost')); await tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0].message, /discarded; reconnect.*connection lost/);
  assert.equal(f.queue.push('later'), false);
});

test('byte limit includes in-flight input and reports overflow once, including UTF-8 expansion', async () => {
  const f = fixture({ batchBytes: 4, maxBytes: 8 });
  f.queue.push('1234');
  assert.equal(f.queue.push('中文'), false, 'two characters exceed the four remaining UTF-8 bytes');
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0].message, /exceeds 8 bytes.*discarded/);
  f.pending[0].resolve(); await tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.queue.push('x'), false);
  assert.equal(f.errors.length, 1);
});
