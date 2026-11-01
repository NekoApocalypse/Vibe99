import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createTerminalOutput } from '../src/terminal-output.mjs';
import { encodeTerminalInput } from '../src/terminal-input.mjs';

test('binary mouse coordinates stay bytes while keyboard input stays UTF-8', () => {
  assert.deepEqual([...Buffer.from(encodeTerminalInput('\x1b[M\x80\xff\x21', true), 'base64')],
    [27, 91, 77, 128, 255, 33]);
  assert.equal(Buffer.from(encodeTerminalInput('你好🙂'), 'base64').toString('utf8'), '你好🙂');
});

test('output acknowledges only after parsing, preserves order, and yields between batches', async () => {
  const writes = [], acks = [], events = [];
  const output = createTerminalOutput({
    terminal: { write(data, parsed) { writes.push({ data, parsed }); } },
    acknowledge: id => acks.push(id), onError: error => { throw error; },
  });
  for (let sequence = 1; sequence <= 8; sequence++) output.push({ sequence, data: String(sequence).repeat(8192) });
  output.finish(() => events.push('finished'));
  await delay(15);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data, [1, 2, 3, 4].map(n => String(n).repeat(8192)).join(''));
  assert.deepEqual(acks, []);
  writes[0].parsed();
  assert.equal(writes.length, 1);
  assert.deepEqual(acks, [4]);
  await delay(15);
  assert.equal(writes.length, 2);
  assert.deepEqual(events, []);
  writes[1].parsed();
  await delay(15);
  assert.deepEqual(acks, [4, 8]);
  assert.deepEqual(events, ['finished']);
  output.dispose();
});

test('recovery barrier runs before later output and disposing cancels old generation callbacks', async () => {
  const writes = [], acks = [], events = [];
  const output = createTerminalOutput({
    terminal: { write(data, parsed) { writes.push({ data, parsed }); events.push(data); } },
    acknowledge: id => acks.push(id), onError: error => { throw error; },
  });
  output.push({ sequence: 1, data: '\x1b[?1000h' });
  output.finish(() => events.push('recover'));
  output.push({ sequence: 2, data: 'prompt' });
  await delay(15);
  writes[0].parsed();
  await delay(15);
  assert.deepEqual(events, ['\x1b[?1000h', 'recover', 'prompt']);
  output.finish(() => events.push('old exit'));
  output.dispose();
  writes[1].parsed();
  await delay(15);
  assert.deepEqual(acks, [1]);
  assert(!events.includes('old exit'));
});
