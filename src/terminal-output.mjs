// One bounded batch per pane in xterm at a time. The backend holds at most
// 256 KiB / 64 unacknowledged packets and stops reading when either limit is hit.
export function createTerminalOutput({ terminal, acknowledge, onError }) {
  const queue = [];
  let timer = null;
  let writing = false;
  let disposed = false;

  function schedule() {
    if (!disposed && !writing && timer === null) timer = setTimeout(flush, 0);
  }

  function flush() {
    timer = null;
    if (disposed) return;
    while (queue[0]?.callback) queue.shift().callback();
    if (!queue.length || disposed) return;
    let data = '';
    let sequence;
    do {
      const packet = queue.shift();
      data += packet.data;
      sequence = packet.sequence;
    } while (queue.length && !queue[0].callback && data.length < 32768);
    writing = true;
    try {
      terminal.write(data, () => {
        writing = false;
        if (disposed) return;
        Promise.resolve(acknowledge(sequence)).catch(onError);
        schedule();
      });
    } catch (error) {
      writing = false;
      onError(error);
    }
  }

  return {
    push(packet) {
      if (disposed) return;
      queue.push(packet);
      schedule();
    },
    finish(callback) {
      if (disposed) return;
      queue.push({ callback });
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      queue.length = 0;
    },
  };
}
