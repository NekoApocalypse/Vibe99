use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

const MAX_BYTES: usize = 256 * 1024;
const MAX_PACKETS: usize = 64;

#[derive(Default)]
struct State {
    pending: VecDeque<(u64, usize)>,
    bytes: usize,
    sequence: u64,
    cancelled: bool,
}

/// Credits belong to one PTY generation. Only parsed output returns credits.
/// The reader waits here without holding the session map, writer, or PTY locks.
#[derive(Default)]
pub struct OutputFlow {
    state: Mutex<State>,
    available: Condvar,
}

impl OutputFlow {
    pub fn reserve(&self, bytes: usize) -> Option<u64> {
        assert!(bytes <= MAX_BYTES);
        let mut state = self.state.lock().unwrap();
        while !state.cancelled
            && (state.bytes + bytes > MAX_BYTES || state.pending.len() >= MAX_PACKETS)
        {
            state = self.available.wait(state).unwrap();
        }
        if state.cancelled {
            return None;
        }
        state.sequence += 1;
        let sequence = state.sequence;
        state.pending.push_back((sequence, bytes));
        state.bytes += bytes;
        Some(sequence)
    }

    pub fn acknowledge(&self, sequence: u64) {
        let mut state = self.state.lock().unwrap();
        // Ignore impossible acknowledgements and make duplicate ACKs harmless.
        if sequence > state.sequence {
            return;
        }
        while state.pending.front().is_some_and(|(id, _)| *id <= sequence) {
            let (_, bytes) = state.pending.pop_front().unwrap();
            state.bytes -= bytes;
        }
        self.available.notify_all();
    }

    pub fn cancel(&self) {
        self.state.lock().unwrap().cancelled = true;
        self.available.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn byte_limit_blocks_until_parsed_and_duplicate_ack_does_not_add_credit() {
        let flow = Arc::new(OutputFlow::default());
        let first = flow.reserve(MAX_BYTES).unwrap();
        let (tx, rx) = mpsc::channel();
        let worker = flow.clone();
        let join = std::thread::spawn(move || tx.send(worker.reserve(1)).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        flow.acknowledge(first + 1); // A future ACK must not free output.
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        flow.acknowledge(first);
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), Some(2));
        flow.acknowledge(first);
        assert_eq!(flow.state.lock().unwrap().bytes, 1);
        join.join().unwrap();
    }

    #[test]
    fn tiny_packets_are_bounded_and_close_wakes_blocked_reader() {
        let flow = Arc::new(OutputFlow::default());
        for _ in 0..MAX_PACKETS {
            flow.reserve(1).unwrap();
        }
        let (tx, rx) = mpsc::channel();
        let worker = flow.clone();
        let join = std::thread::spawn(move || tx.send(worker.reserve(1)).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        flow.cancel();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), None);
        assert_eq!(flow.reserve(1), None);
        join.join().unwrap();
    }

    #[test]
    fn cumulative_ack_releases_only_consumed_packets() {
        let flow = OutputFlow::default();
        flow.reserve(100);
        flow.reserve(200);
        flow.reserve(300);
        flow.acknowledge(2);
        assert_eq!(flow.state.lock().unwrap().bytes, 300);
    }
}
