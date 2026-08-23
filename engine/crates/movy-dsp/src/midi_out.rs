//! MIDI a module emits from inside its render, funnelled back onto the audio
//! thread before it reaches schwung.
//!
//! **The hazard.** `midi_send_internal` and `midi_send_external` are
//! SINGLE-producer (`plans/2026-08-21-parallel-chain-render-schwung-review.md`
//! §4): the external one advances a plain `volatile` head with a non-atomic
//! increment, and the internal one dispatches straight into schwung's own four
//! chain slots — instances schwung's SPI thread also touches. Rendering movy's
//! chains on more than one thread puts a second producer behind both. That is a
//! data race in schwung's process, and it is one the equivalence oracle cannot
//! see: a desynchronised ring index need never perturb a single sample.
//!
//! **Why it is not a live bug, and why that is not enough.** The 93-repo fleet
//! audit (`scripts/audit-render-globals.py`) resolves `render_block` in 78 of
//! them and finds *no* module reaching either function from it — the one module
//! that calls `midi_send_internal` at all, essaim, calls it from `on_midi` and
//! `set_param`, which movy never runs off the audio thread. But that is a fact
//! about today's fleet, not a property of the design. Those repos were written
//! against "one thread, one chain at a time", and a module added tomorrow is
//! entitled to send MIDI from render. Movy owns the host vtable it hands the
//! chain host (`chain_host.rs`), so rather than police the promise it can keep
//! it.
//!
//! **The mechanism.** A send issued while a chain is rendering is parked in that
//! chain's queue and replayed on the audio thread after the join, in slot order.
//! One producer per queue, because a chain renders on exactly one lane. Two
//! things fall out that are worth more than the safety alone: schwung sees a
//! single producer again, and the emission ORDER becomes deterministic — the
//! same reason the mix is summed serially after the join rather than as lanes
//! finish. Serial and parallel therefore emit identical MIDI, not merely
//! identical audio.
//!
//! `midi_inject_to_move` is deliberately NOT routed through here: it is a real
//! bounded MPSC queue (Vyukov per-slot-sequence, `shadow_constants.h:520`)
//! documented for concurrent producers across processes, and the chain host's
//! Pre-mode path already uses it from render. Making a working, safety-correct
//! path depend on this one would add risk to buy nothing.

use std::cell::{Cell, UnsafeCell};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use crate::chain_slots::MOVY_CHAINS;

/// Messages one chain may emit per block before the queue starts dropping.
///
/// Sized against the host API's own advice on the neighbouring inject path —
/// "callers should not burst more than 8 packets per render block"
/// (`plugin_api_v1.h:168`) — with headroom. The whole table is 12 x 16 x 8
/// bytes, so there is no reason to be tight.
const CAP: usize = 16;

/// Sentinel for "not inside a chain's render". Movy's own engine sends — the
/// transport clock, automation CC — run on the audio thread outside any chain
/// and must reach schwung directly, exactly as they do today.
const NO_CHAIN: usize = usize::MAX;

thread_local! {
    /// The chain this thread is currently rendering. Set by `Scope`, which
    /// wraps every call to a module's `render_block` on both the serial and the
    /// parallel path, so the two behave identically.
    static CHAIN: Cell<usize> = const { Cell::new(NO_CHAIN) };
}

#[derive(Clone, Copy)]
struct Msg {
    bytes: [u8; 4],
    len: u8,
    external: bool,
}

const EMPTY: Msg = Msg { bytes: [0; 4], len: 0, external: false };

pub struct MidiOut {
    /// Written only by the lane rendering that chain, read only by the audio
    /// thread after the join. That is the same ownership argument the scratch
    /// buffers rely on, and the pool's release/acquire pair on `pending`
    /// publishes both.
    q: [UnsafeCell<[Msg; CAP]>; MOVY_CHAINS],
    n: [AtomicUsize; MOVY_CHAINS],
    dropped: AtomicU32,
}

// Safe by the per-chain ownership above: no two threads ever touch the same
// entry, and the pool's join is what makes a helper's writes visible.
unsafe impl Sync for MidiOut {}

pub static QUEUE: MidiOut = MidiOut::new();

/// Serialises every test that touches `QUEUE`.
///
/// `QUEUE` is process-global by design — it is the one place a module's
/// render-time MIDI is parked — and `cargo test` runs tests on concurrent
/// threads, so two of them sharing it is a race between the tests, not in the
/// code. It was a real intermittent: `render_pool`'s attribution test parks two
/// messages and drains, while its neighbour drains the queue to clear it, so
/// whichever ran second saw the other's messages already taken (`left: [69],
/// right: [66, 69]`), roughly one run in eight.
///
/// Take it FIRST in any test that parks or drains, and drain once while holding
/// it — a test that starts on someone else's leftovers is the same bug wearing
/// the other hat.
#[cfg(test)]
pub static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The lock, plus an emptied queue. Poisoning is deliberately ignored: a test
/// that fails while holding it has already reported, and cascading every later
/// test into a panic would bury which one actually broke.
#[cfg(test)]
pub fn test_guard() -> std::sync::MutexGuard<'static, ()> {
    let g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    QUEUE.drain(|_, _| {});
    g
}

impl MidiOut {
    const fn new() -> Self {
        Self {
            q: [const { UnsafeCell::new([EMPTY; CAP]) }; MOVY_CHAINS],
            n: [const { AtomicUsize::new(0) }; MOVY_CHAINS],
            dropped: AtomicU32::new(0),
        }
    }

    /// Park a send if one is in progress on this thread.
    ///
    /// `None` means "not inside a chain render" and the caller must pass the
    /// call straight through. `Some(n)` is the byte count to report back to the
    /// module, 0 being the host API's own failure value.
    pub fn park(&self, msg: &[u8], external: bool) -> Option<c_len> {
        let chain = CHAIN.with(|c| c.get());
        if chain >= MOVY_CHAINS {
            return None;
        }
        // A packet longer than the 4-byte USB-MIDI shape the API documents is
        // dropped rather than forwarded: forwarding is precisely the race this
        // exists to remove, and there is no such caller to accommodate.
        if msg.is_empty() || msg.len() > 4 {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return Some(0);
        }
        let n = self.n[chain].load(Ordering::Relaxed);
        if n >= CAP {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return Some(0);
        }
        let mut m = EMPTY;
        m.bytes[..msg.len()].copy_from_slice(msg);
        m.len = msg.len() as u8;
        m.external = external;
        // Safe: this thread owns `chain` for the duration of its render_block.
        unsafe { (*self.q[chain].get())[n] = m };
        self.n[chain].store(n + 1, Ordering::Relaxed);
        Some(msg.len() as c_len)
    }

    /// Replay everything parked this block, in slot order. Audio thread only,
    /// and only after the join.
    pub fn drain(&self, mut send: impl FnMut(&[u8], bool)) {
        for chain in 0..MOVY_CHAINS {
            let n = self.n[chain].swap(0, Ordering::Relaxed).min(CAP);
            for i in 0..n {
                // Safe: every producer is joined, and `swap` means no other
                // drain can be walking the same entries.
                let m = unsafe { (*self.q[chain].get())[i] };
                send(&m.bytes[..m.len as usize], m.external);
            }
        }
    }

    /// `dropped=<n>` — messages the queue refused. Never resets: a count that
    /// clears on read cannot answer "has this ever happened".
    pub fn report(&self) -> String {
        format!("dropped={}", self.dropped.load(Ordering::Relaxed))
    }
}

/// The host API returns "bytes queued, or 0 on failure", as a C `int`.
#[allow(non_camel_case_types)]
pub type c_len = i32;

/// Marks the calling thread as rendering `chain` for as long as it lives.
///
/// A guard rather than a pair of calls because the wrapped call is FFI into a
/// module: an early return inside movy would otherwise leave the thread
/// attributed to a chain it is no longer rendering, and every later send on
/// that thread — including movy's own — would be parked into a stranger's
/// queue.
pub struct Scope;

impl Scope {
    pub fn enter(chain: usize) -> Self {
        CHAIN.with(|c| c.set(chain));
        Scope
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        CHAIN.with(|c| c.set(NO_CHAIN));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drained(q: &MidiOut) -> Vec<(Vec<u8>, bool)> {
        let mut out = Vec::new();
        q.drain(|m, e| out.push((m.to_vec(), e)));
        out
    }

    /* The whole point: movy's own sends run outside any chain and must not be
     * delayed, reordered or attributed to a chain that did not make them. */
    #[test]
    fn a_send_outside_a_chain_render_is_not_parked() {
        let q = MidiOut::new();
        assert!(q.park(&[0x09, 0x90, 60, 100], false).is_none());
        assert!(drained(&q).is_empty());
    }

    #[test]
    fn a_send_inside_a_chain_render_is_parked_and_replayed() {
        let q = MidiOut::new();
        let _s = Scope::enter(3);
        assert_eq!(q.park(&[0x09, 0x90, 60, 100], false), Some(4));
        assert_eq!(drained(&q), vec![(vec![0x09, 0x90, 60, 100], false)]);
    }

    /* Determinism is half of what this buys. Chains queue in whatever order the
     * lanes ran; the drain must undo that and emit in slot order, or parallel
     * still changes what schwung sees. */
    #[test]
    fn the_drain_is_in_slot_order_whatever_order_the_lanes_queued_in() {
        let q = MidiOut::new();
        for chain in [7usize, 1, 4] {
            let _s = Scope::enter(chain);
            q.park(&[0x09, 0x90, chain as u8, 100], false);
        }
        let notes: Vec<u8> = drained(&q).iter().map(|(m, _)| m[2]).collect();
        assert_eq!(notes, vec![1, 4, 7]);
    }

    /* Within one chain the module's own ordering is musical — an arp's note-off
     * before its note-on is a stuck note — so the queue must be FIFO. */
    #[test]
    fn messages_from_one_chain_keep_the_order_the_module_sent_them_in() {
        let q = MidiOut::new();
        let _s = Scope::enter(0);
        for note in 1..=5u8 {
            q.park(&[0x09, 0x90, note, 100], false);
        }
        let notes: Vec<u8> = drained(&q).iter().map(|(m, _)| m[2]).collect();
        assert_eq!(notes, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn the_two_destinations_stay_distinct() {
        let q = MidiOut::new();
        let _s = Scope::enter(0);
        q.park(&[0x09, 0x90, 60, 100], false);
        q.park(&[0x09, 0x90, 61, 100], true);
        assert_eq!(drained(&q).iter().map(|(_, e)| *e).collect::<Vec<_>>(), vec![false, true]);
    }

    /* Overflow has to be reported as failure to the module AND counted, because
     * the alternative — forwarding it — is the race itself. */
    #[test]
    fn overflow_is_refused_rather_than_forwarded() {
        let q = MidiOut::new();
        let _s = Scope::enter(0);
        for _ in 0..CAP {
            assert_eq!(q.park(&[0x09, 0x90, 60, 100], false), Some(4));
        }
        assert_eq!(q.park(&[0x09, 0x90, 60, 100], false), Some(0));
        assert_eq!(q.report(), "dropped=1");
        assert_eq!(drained(&q).len(), CAP);
    }

    #[test]
    fn a_packet_that_is_not_usb_midi_shaped_is_refused_not_forwarded() {
        let q = MidiOut::new();
        let _s = Scope::enter(0);
        assert_eq!(q.park(&[0xF0, 0x7E, 0, 1, 2], false), Some(0));
        assert_eq!(q.park(&[], false), Some(0));
        assert_eq!(q.report(), "dropped=2");
    }

    /* The guard, not the pair of calls. A `park` after the render returned must
     * reach schwung directly — parking it would hold movy's own transport clock
     * until the next block's drain. */
    #[test]
    fn leaving_the_scope_restores_direct_sending() {
        let q = MidiOut::new();
        {
            let _s = Scope::enter(2);
            assert!(q.park(&[0x09, 0x90, 60, 100], false).is_some());
        }
        assert!(q.park(&[0x09, 0x90, 60, 100], false).is_none());
    }

    /* A helper thread that never rendered a chain must not inherit the audio
     * thread's attribution — the state is per thread, and the test is what says
     * so rather than the `thread_local!` keyword. */
    #[test]
    fn the_scope_does_not_leak_across_threads() {
        let _lock = test_guard();
        let _s = Scope::enter(5);
        std::thread::spawn(|| {
            assert!(QUEUE.park(&[0x09, 0x90, 60, 100], false).is_none());
        })
        .join()
        .unwrap();
    }
}
