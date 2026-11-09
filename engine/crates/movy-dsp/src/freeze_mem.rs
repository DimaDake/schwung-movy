//! A freeze's memory, allocated and freed off the audio thread.
//!
//! A capture buffer is the whole loop — 60 s of stereo is 10 MB — and `frz`
//! arrives on the audio thread. Allocating it there is an `mmap` and, as the
//! capture writes it, a page fault per 4 KB inside audio callbacks; freeing a
//! loop at a thaw or a Set switch is the `munmap`. So both happen here, on a
//! helper thread: a request names the track and a ticket, the helper allocates
//! and TOUCHES every page (`resize` writes the zeros), and the buffer comes
//! back through `poll` a block or two later. The freeze bank keeps the track
//! Pending meanwhile (freeze_bank.rs). A buffer handed back for a request that
//! was cancelled in between is simply freed again.
//!
//! The audio thread never allocates or blocks here, the same discipline as
//! chain_reaper.rs: every queue holds its capacity from the start, the
//! hand-overs are `try_lock` (a miss retries next block), and the wake is an
//! `unpark`. Until `start`, and in host tests, both happen in place.
//!
//! The helper also reads the system's free RAM about once a second, for the
//! freeze bank's budget (`avail`): `/proc/meminfo` is a file read, which the
//! audio thread may not do either.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Requests in flight at once: one per track is all a bank can ask for.
const SLOTS: usize = crate::chain_slots::MOVY_CHAINS;
/// Loops waiting to be freed. Past it a loop is dropped where it is (the
/// old behaviour), never queued with an allocation.
const FREES: usize = SLOTS * 4;
/// How often the helper reads `/proc/meminfo`.
const AVAIL_EVERY: Duration = Duration::from_secs(1);
/// `avail` before a first read, without a helper, or off Linux: no limit.
pub const AVAIL_UNKNOWN: usize = usize::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ask {
    pub track: usize,
    pub ticket: u32,
    pub samples: usize,
}

/// A buffer on its way to be freed; held only to be dropped on the helper.
pub enum Gone {
    Buf(#[allow(dead_code)] Vec<i16>),
    Shared(#[allow(dead_code)] Arc<Vec<i16>>),
}

struct Shared {
    asks: Mutex<Vec<Ask>>,
    ready: Mutex<Vec<(Ask, Vec<i16>)>>,
    frees: Mutex<Vec<Gone>>,
    stop: AtomicBool,
    /// MemAvailable in bytes, or `AVAIL_UNKNOWN`.
    avail: AtomicUsize,
    /// Buffers handed to the helper and not yet freed (`frees_done`).
    freeing: AtomicUsize,
}

pub struct FreezeMem {
    shared: Arc<Shared>,
    /// Not yet through the locks (audio side).
    asks: Vec<Ask>,
    frees: Vec<Gone>,
    /// What `poll` swaps the helper's results into.
    got: Vec<(Ask, Vec<i16>)>,
    worker: Option<JoinHandle<()>>,
}

fn alloc(n: usize) -> Vec<i16> {
    let mut v = Vec::with_capacity(n);
    v.resize(n, 0); // writes every page: no fault later, on the audio thread
    v
}

impl FreezeMem {
    pub fn new() -> Self {
        let shared = Arc::new(Shared {
            asks: Mutex::new(Vec::with_capacity(SLOTS)),
            ready: Mutex::new(Vec::with_capacity(SLOTS)),
            frees: Mutex::new(Vec::with_capacity(FREES)),
            stop: AtomicBool::new(false),
            avail: AtomicUsize::new(AVAIL_UNKNOWN),
            freeing: AtomicUsize::new(0),
        });
        FreezeMem {
            shared,
            asks: Vec::with_capacity(SLOTS),
            frees: Vec::with_capacity(FREES),
            got: Vec::with_capacity(SLOTS),
            worker: None,
        }
    }

    /// Spawn the helper. Off the audio thread only (`ChainSlots::configure`).
    pub fn start(&mut self) {
        if self.worker.is_some() {
            return;
        }
        let shared = Arc::clone(&self.shared);
        self.worker = std::thread::Builder::new()
            .name("movy-freeze-mem".into())
            .spawn(move || {
                crate::threads::leave_audio_core();
                let mut asks: Vec<Ask> = Vec::with_capacity(SLOTS);
                let mut frees: Vec<Gone> = Vec::with_capacity(FREES);
                let mut read_at: Option<Instant> = None;
                loop {
                    let stop = shared.stop.load(Ordering::Acquire);
                    if read_at.is_none_or(|at| at.elapsed() >= AVAIL_EVERY) {
                        read_at = Some(Instant::now());
                        let n = std::fs::read_to_string("/proc/meminfo").ok()
                            .and_then(|m| mem_available(&m)).unwrap_or(AVAIL_UNKNOWN);
                        shared.avail.store(n, Ordering::Relaxed);
                    }
                    if let Ok(mut q) = shared.frees.lock() {
                        std::mem::swap(&mut *q, &mut frees);
                    }
                    let n = frees.len();
                    frees.clear(); // the frees, here
                    shared.freeing.fetch_sub(n, Ordering::Release);
                    if let Ok(mut q) = shared.asks.lock() {
                        std::mem::swap(&mut *q, &mut asks);
                    }
                    for a in asks.drain(..) {
                        let buf = alloc(a.samples);
                        if let Ok(mut r) = shared.ready.lock() {
                            r.push((a, buf));
                        }
                    }
                    if stop {
                        return;
                    }
                    std::thread::park_timeout(Duration::from_millis(50));
                }
            })
            .ok();
    }

    /// The system's free RAM as of the helper's last read (bytes), or
    /// `AVAIL_UNKNOWN`. Audio thread: one atomic load.
    pub fn avail(&self) -> usize {
        self.shared.avail.load(Ordering::Relaxed)
    }

    /// Every buffer retired so far is freed: the RAM is the kernel's again.
    /// Audio thread. An open reads its loops only after this (lib.rs
    /// `frozen_due`), so two Sets' loops are never in RAM at once.
    pub fn frees_done(&self) -> bool {
        self.frees.is_empty() && self.shared.freeing.load(Ordering::Acquire) == 0
    }

    #[cfg(test)]
    pub fn fake_avail(&self, n: usize) {
        self.shared.avail.store(n, Ordering::Relaxed);
    }

    /// Ask for a zeroed buffer of `samples`. Audio thread. `false` when the
    /// queue is full (cannot happen with one ask per track).
    pub fn request(&mut self, a: Ask) -> bool {
        if self.worker.is_none() {
            self.got.push((a, alloc(a.samples)));
            return true;
        }
        if self.asks.len() == self.asks.capacity() {
            return false;
        }
        self.asks.push(a);
        self.flush();
        true
    }

    /// Free `g` off the audio thread. Audio thread.
    pub fn retire(&mut self, g: Gone) {
        if self.worker.is_none() || self.frees.len() == self.frees.capacity() {
            return; // dropped here
        }
        self.frees.push(g);
        self.flush();
    }

    /// Hand over what is waiting and take back what is ready. Audio thread,
    /// each block. `f` gets every buffer that came back since the last poll.
    pub fn poll(&mut self, mut f: impl FnMut(Ask, Vec<i16>) -> Option<Vec<i16>>) {
        self.flush();
        if self.worker.is_some() {
            if let Ok(mut r) = self.shared.ready.try_lock() {
                if !r.is_empty() {
                    std::mem::swap(&mut *r, &mut self.got);
                }
            }
        }
        while let Some((a, buf)) = self.got.pop() {
            if let Some(unused) = f(a, buf) {
                self.retire(Gone::Buf(unused));
            }
        }
    }

    fn flush(&mut self) {
        if self.worker.is_none() || (self.asks.is_empty() && self.frees.is_empty()) {
            return;
        }
        let mut woke = false;
        if !self.asks.is_empty() {
            if let Ok(mut q) = self.shared.asks.try_lock() {
                /* Within capacity: both sides hold SLOTS. What does not fit
                 * waits here for the next flush, as a free does: `request`
                 * has already said yes to it. */
                let room = SLOTS - q.len().min(SLOTS);
                let n = self.asks.len().min(room);
                q.extend(self.asks.drain(..n));
                woke = true;
            }
        }
        if !self.frees.is_empty() {
            if let Ok(mut q) = self.shared.frees.try_lock() {
                let room = FREES - q.len().min(FREES);
                let n = self.frees.len().min(room);
                q.extend(self.frees.drain(..n));
                /* Under the lock the helper swaps with, so it can never
                 * subtract these before they are counted. */
                self.shared.freeing.fetch_add(n, Ordering::Release);
                woke = true;
            }
        }
        if woke {
            if let Some(w) = &self.worker {
                w.thread().unpark();
            }
        }
    }
}

/// MemAvailable from `/proc/meminfo`, in bytes: what the kernel says can be
/// had without swapping (there is no swap here), page cache included.
fn mem_available(meminfo: &str) -> Option<usize> {
    let kb = meminfo.lines().find_map(|l| l.strip_prefix("MemAvailable:"))?;
    kb.trim().trim_end_matches("kB").trim().parse::<usize>().ok()?.checked_mul(1024)
}

impl Drop for FreezeMem {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::Release);
        if let Some(w) = self.worker.take() {
            w.thread().unpark();
            let _ = w.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mem_available_is_read_in_bytes() {
        let m = "MemTotal:        1893376 kB\nMemFree:          411320 kB\nMemAvailable:    1391204 kB\n";
        assert_eq!(mem_available(m), Some(1_391_204 * 1024));
        assert_eq!(mem_available("MemTotal: 1 kB\n"), None, "an old kernel has no line");
        assert_eq!(FreezeMem::new().avail(), AVAIL_UNKNOWN, "no helper, no limit");
    }

    #[test]
    fn without_a_helper_a_request_is_answered_at_the_next_poll() {
        let mut m = FreezeMem::new();
        assert!(m.request(Ask { track: 3, ticket: 7, samples: 10 }));
        let mut seen = None;
        m.poll(|a, b| { seen = Some((a.track, a.ticket, b.len())); None });
        assert_eq!(seen, Some((3, 7, 10)));
    }

    #[test]
    fn the_helper_allocates_off_the_calling_thread_and_hands_it_back() {
        let mut m = FreezeMem::new();
        m.start();
        assert!(m.request(Ask { track: 1, ticket: 2, samples: 1 << 20 }));
        let mut got = None;
        for _ in 0..200 {
            m.poll(|a, b| { got = Some((a.ticket, b.len(), b.iter().all(|&s| s == 0))); None });
            if got.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(got, Some((2, 1 << 20, true)));
        m.retire(Gone::Buf(vec![0; 8]));
        m.retire(Gone::Shared(Arc::new(vec![0; 8])));
        assert!(m.frees.len() <= 2);
    }

    /// Reviewed: asks past the shared queue's room were dropped while
    /// `request` had answered true, so that track waited at 0% forever.
    #[test]
    fn an_ask_that_does_not_fit_yet_waits_for_the_next_flush() {
        let mut m = FreezeMem::new();
        m.worker = Some(std::thread::spawn(|| {})); // a helper that is busy elsewhere
        {
            let mut q = m.shared.asks.lock().unwrap();
            for t in 0..SLOTS - 1 {
                q.push(Ask { track: t, ticket: 0, samples: 1 });
            }
        }
        // Not through `request`: its flush runs after each push.
        m.asks.push(Ask { track: 14, ticket: 1, samples: 1 });
        m.asks.push(Ask { track: 15, ticket: 2, samples: 1 });
        m.flush();
        assert_eq!(m.shared.asks.lock().unwrap().len(), SLOTS);
        assert_eq!(m.asks, vec![Ask { track: 15, ticket: 2, samples: 1 }], "the ask that did not fit was dropped");
        m.shared.asks.lock().unwrap().clear();
        m.flush();
        assert!(m.asks.is_empty());
        assert_eq!(m.shared.asks.lock().unwrap()[0].ticket, 2);
    }
}
