// One remote request in flight; keystrokes arriving during its round trip form
// the next bounded byte batch. Raw mouse bytes and UTF-8 text share one FIFO.
export function createPreviewInput({ send, onError, batchBytes = 16 * 1024, maxBytes = 256 * 1024 }) {
  if (!Number.isInteger(batchBytes) || !Number.isInteger(maxBytes) || batchBytes < 1 || maxBytes < batchBytes) {
    throw new Error('Invalid terminal input queue limits');
  }
  const buffer = new Uint8Array(maxBytes);
  const encoder = new TextEncoder();
  let head = 0, length = 0, inFlight = 0, stopped = false;

  function stop() {
    stopped = true;
    head = 0;
    length = 0;
    buffer.fill(0);
  }
  function fail(error) {
    if (stopped) return;
    stop();
    onError(error);
  }
  function transportFailed(error) {
    fail(new Error(`SSH terminal input failed. Queued input was discarded; reconnect before typing again. ${String(error?.message || error)}`));
  }
  function pump() {
    if (stopped || inFlight || !length) return;
    const count = Math.min(length, batchBytes);
    let raw = '';
    for (let i = 0; i < count; i++) {
      raw += String.fromCharCode(buffer[head]);
      buffer[head] = 0;
      head = (head + 1) % maxBytes;
    }
    length -= count;
    inFlight = count;
    let pending;
    try { pending = send(btoa(raw)); }
    catch (error) { transportFailed(error); return; }
    Promise.resolve(pending).then(() => {
      inFlight = 0;
      pump();
    }, error => {
      inFlight = 0;
      transportFailed(error);
    });
  }
  function overflow() {
    fail(new Error(`SSH terminal input exceeds ${maxBytes} bytes. Queued input was discarded; reconnect before typing again.`));
    return false;
  }
  return {
    push(data, binary = false) {
      if (stopped) return false;
      if (data.length > maxBytes - length - inFlight) return overflow();
      const bytes = binary ? Uint8Array.from(data, char => char.charCodeAt(0) & 0xff) : encoder.encode(data);
      if (bytes.length > maxBytes - length - inFlight) return overflow();
      for (const byte of bytes) {
        buffer[(head + length) % maxBytes] = byte;
        length++;
      }
      pump();
      return true;
    },
    dispose: stop,
  };
}
