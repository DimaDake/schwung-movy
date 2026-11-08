//! Destroying a chain instance off the audio thread.
//!
//! `destroy_instance` runs every module's own destroy and `dlclose`s it, and
//! for a heavy synth that is not small: measured on the device (2026-10-24),
//! clearing an OB-Xd took 0.1-0.3 ms but a Surge 11-17 ms — four to six blocks
//! of audio, a dropout every time a track froze with the transport running.
//! A frozen track's chain is not needed again until a thaw, which loads a
//! fresh one, so the whole instance is handed here instead and dies on a
//! helper thread.
//!
//! Safe because the instance is unreachable once handed over: it has left
//! `ChainSlots::slots`, and the render plan is rebuilt before the next block
//! (`plan_dirty`). schwung's destroy touches only that instance (its synth and
//! FX unload through locals, not `chain_synth_load.c`'s shared stage), plus
//! `dlclose`, which glibc serialises against the audio thread's own loads.
//!
//! The audio thread never allocates or blocks here: both queues hold
//! `MOVY_CHAINS` from the start, the hand-over is a `try_lock` (a miss keeps
//! the instance for the next block), and the wake is an `unpark`, as the
//! render pool's is. Until `start`, and in host tests, an instance is simply
//! dropped where it is, which is what happened before.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::chain_host::ChainInstance;
use crate::chain_slots::MOVY_CHAINS;

struct Doomed(#[allow(dead_code)] ChainInstance);
// SAFETY: see the module comment — once here, nothing else can reach it.
unsafe impl Send for Doomed {}

struct Shared {
    inbox: Mutex<Vec<Doomed>>,
    stop: AtomicBool,
}

pub struct Reaper {
    shared: Arc<Shared>,
    /// Handed over but not yet through the lock.
    waiting: Vec<Doomed>,
    worker: Option<JoinHandle<()>>,
}

impl Reaper {
    pub fn new() -> Self {
        let shared = Arc::new(Shared {
            inbox: Mutex::new(Vec::with_capacity(MOVY_CHAINS)),
            stop: AtomicBool::new(false),
        });
        Reaper { shared, waiting: Vec::with_capacity(MOVY_CHAINS), worker: None }
    }

    /// Spawn the helper. Off the audio thread only (`ChainSlots::configure`).
    pub fn start(&mut self) {
        if self.worker.is_some() {
            return;
        }
        let shared = Arc::clone(&self.shared);
        self.worker = std::thread::Builder::new()
            .name("movy-reaper".into())
            .spawn(move || {
                crate::threads::leave_audio_core();
                let mut batch: Vec<Doomed> = Vec::with_capacity(MOVY_CHAINS);
                loop {
                    let stop = shared.stop.load(Ordering::Acquire);
                    if let Ok(mut q) = shared.inbox.lock() {
                        std::mem::swap(&mut *q, &mut batch);
                    }
                    batch.clear(); // the destroys, here, off the audio thread
                    if stop {
                        return;
                    }
                    std::thread::park_timeout(Duration::from_millis(100));
                }
            })
            .ok();
    }

    /// Retire `inst`. Audio thread.
    pub fn retire(&mut self, inst: ChainInstance) {
        if self.worker.is_none() {
            return; // dropped here
        }
        self.waiting.push(Doomed(inst));
        self.flush();
    }

    /// Hand over whatever is waiting, if the lock is free. Audio thread, each block.
    pub fn flush(&mut self) {
        if self.waiting.is_empty() {
            return;
        }
        if let Ok(mut q) = self.shared.inbox.try_lock() {
            q.append(&mut self.waiting);
            if let Some(w) = &self.worker {
                w.thread().unpark();
            }
        }
    }
}

impl Drop for Reaper {
    /// Everything still queued is destroyed before the thread is joined, and
    /// the join happens before movy-host can unload this dsp.so.
    fn drop(&mut self) {
        let waiting = std::mem::take(&mut self.waiting);
        if let Ok(mut q) = self.shared.inbox.lock() {
            q.extend(waiting);
        }
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
    fn an_unstarted_reaper_holds_nothing() {
        let mut r = Reaper::new();
        r.flush();
        assert!(r.waiting.is_empty());
    }

    static DESTROYED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    static ON_CALLER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    thread_local!(static CALLER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) });

    unsafe extern "C" fn fake_destroy(_: *mut core::ffi::c_void) {
        DESTROYED.fetch_add(1, Ordering::SeqCst);
        if CALLER.with(|c| c.get()) {
            ON_CALLER.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn retired_instances_die_on_the_helper_and_none_is_lost() {
        let api: &'static crate::ffi::plugin_api_v2_t = Box::leak(Box::new(crate::ffi::plugin_api_v2_t {
            api_version: 0, create_instance: None, destroy_instance: Some(fake_destroy),
            on_midi: None, set_param: None, get_param: None, get_error: None, render_block: None,
        }));
        CALLER.with(|c| c.set(true));
        let mut r = Reaper::new();
        r.start();
        for _ in 0..3 {
            r.retire(ChainInstance::for_test(api));
        }
        drop(r); // drains whatever the helper has not reached yet, then joins
        assert_eq!(DESTROYED.load(Ordering::SeqCst), 3, "every instance destroyed exactly once");
        assert_eq!(ON_CALLER.load(Ordering::SeqCst), 0, "none on the retiring (audio) thread");
    }

    #[test]
    fn a_started_reaper_stops_and_joins() {
        let mut r = Reaper::new();
        r.start();
        assert!(r.worker.is_some());
        drop(r); // must return: stop + unpark + join
    }
}
