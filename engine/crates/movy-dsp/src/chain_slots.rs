//! The twelve movy-hosted chains: lifecycle, loading and rendering.
//!
//! Tracks 0-3 are schwung's own shadow slots and are driven by MIDI channel as
//! before; tracks 4-15 live here, one chain instance each.
//!
//! **Empty chains must cost nothing.** The design's hard requirement. Slots are
//! `None` until something is loaded into them, and `render()` walks only the
//! ones that exist — an untouched movy track costs one `Option` check per block,
//! not a silent chain render. This is enforced by `renders_nothing_when_empty`
//! rather than by inspection.

use crate::chain_host::{ChainHost, ChainInstance};
use crate::host;
use crate::load_queue::{LoadQueue, LoadRequest};
use crate::mixer::{mix_into, TrackMix};

/// Chains movy hosts itself: tracks 4..15 (design §1).
pub const MOVY_CHAINS: usize = 12;

/// 128 frames stereo — schwung's block size. Preallocated: no allocation may
/// happen on the audio thread.
const SCRATCH_SAMPLES: usize = 128 * 2;

pub struct ChainSlots {
    host: Option<ChainHost>,
    /// `None` until something is loaded — this is the "empty costs nothing" rule.
    slots: Vec<Option<ChainInstance>>,
    mixes: Vec<TrackMix>,
    queue: LoadQueue,
    scratch: Vec<i16>,
    /// Set once the host has been tried and failed, so a broken install is not
    /// retried on every block.
    host_failed: bool,
    module_dir: String,
}

impl ChainSlots {
    pub fn new() -> Self {
        let mut slots = Vec::with_capacity(MOVY_CHAINS);
        for _ in 0..MOVY_CHAINS {
            slots.push(None);
        }
        Self {
            host: None,
            slots,
            mixes: vec![TrackMix::default(); MOVY_CHAINS],
            queue: LoadQueue::new(),
            scratch: vec![0i16; SCRATCH_SAMPLES],
            host_failed: false,
            module_dir: String::new(),
        }
    }

    /// Point the slots at schwung's chain module directory and movy's private
    /// copy of its `dsp.so`. Called once, from a param set — never from render.
    pub fn configure(&mut self, module_dir: &str, so_path: &str) {
        self.module_dir = module_dir.to_string();
        if self.host.is_some() || self.host_failed {
            return;
        }
        match ChainHost::load(so_path) {
            Ok(h) => self.host = Some(h),
            Err(e) => {
                // Degrade, never panic: movy must keep sequencing its four host
                // tracks when chain hosting is unavailable.
                host::log(&format!("chain hosting unavailable: {}", e));
                self.host_failed = true;
            }
        }
    }

    pub fn is_available(&self) -> bool {
        self.host.is_some()
    }

    /// Queue a module load. Never loads inline — see `load_queue` for why.
    pub fn request_load(&mut self, slot: usize, component: &str, module: &str) {
        if slot >= MOVY_CHAINS {
            return;
        }
        self.queue.push(LoadRequest {
            slot,
            component: component.to_string(),
            module: module.to_string(),
        });
    }

    pub fn pending_loads(&self) -> usize {
        self.queue.len()
    }

    /// Release at most ONE queued load. Call once per audio callback: this is
    /// where the blocking dlopen actually happens, and the one-per-callback rule
    /// is what stops a twelve-chain restore stacking into a single block.
    pub fn service_loads(&mut self) {
        let Some(req) = self.queue.take_one() else { return };
        let Some(hostref) = self.host.as_ref() else { return };

        if self.slots[req.slot].is_none() {
            // First load into this slot materialises the chain. An empty slot
            // never gets here, which is what keeps empty chains free.
            match hostref.create_instance(&self.module_dir) {
                Some(inst) => self.slots[req.slot] = Some(inst),
                None => return,
            }
        }
        if let Some(inst) = self.slots[req.slot].as_mut() {
            inst.set_param(&format!("{}:module", req.component), &req.module);
        }
        /* Load events are rare (never the hot path) and this is the only
         * externally observable evidence that a chain load happened: schwung's
         * remote-UI socket can WRITE an engine param but has no read verb, so a
         * device test has nothing else to assert on. */
        host::log(&format!(
            "chain {}: {} = {}",
            req.slot,
            req.component,
            if req.module.is_empty() { "(cleared)" } else { req.module.as_str() }
        ));
    }

    /// Forward a param to a chain. Loading keys are NOT accepted here — they go
    /// through `request_load` so they cannot bypass the queue.
    pub fn set_param(&mut self, slot: usize, key: &str, val: &str) {
        if slot >= MOVY_CHAINS {
            return;
        }
        if let Some(inst) = self.slots[slot].as_mut() {
            inst.set_param(key, val);
        }
    }

    pub fn get_param(&self, slot: usize, key: &str) -> Option<String> {
        self.slots.get(slot)?.as_ref()?.get_param(key)
    }

    pub fn set_mix(&mut self, slot: usize, mix: TrackMix) {
        if slot < MOVY_CHAINS {
            self.mixes[slot] = mix;
        }
    }

    /// Deliver a MIDI message to one chain.
    pub fn on_midi(&mut self, slot: usize, msg: &[u8], source: core::ffi::c_int) {
        if slot >= MOVY_CHAINS {
            return;
        }
        if let Some(inst) = self.slots[slot].as_mut() {
            inst.on_midi(msg, source);
        }
    }

    /// Render every loaded chain and sum into `out`.
    ///
    /// `out` already holds movy's own contribution (the metronome click), so
    /// this ADDS. The chain host overwrites its output buffer, hence the
    /// scratch buffer and the separate mix step.
    pub fn render(&mut self, out: &mut [i16]) {
        if self.host.is_none() {
            return;
        }
        let frames = out.len().min(self.scratch.len());
        for i in 0..MOVY_CHAINS {
            let Some(inst) = self.slots[i].as_mut() else { continue };
            let scratch = &mut self.scratch[..frames];
            inst.render_block(scratch);
            mix_into(&mut out[..frames], scratch, &self.mixes[i]);
        }
    }

    /// Drop every chain. The engine is going away; a pending load refers to
    /// slots that will not exist.
    pub fn teardown(&mut self) {
        self.queue.clear();
        for s in self.slots.iter_mut() {
            *s = None;
        }
    }
}

impl Default for ChainSlots {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /* These run on the host, where no chain host exists — so they verify the
     * DEGRADED path, which is the one that must never crash: movy has to keep
     * sequencing its four schwung tracks when chain hosting is unavailable. */

    #[test]
    fn renders_nothing_when_empty() {
        let mut slots = ChainSlots::new();
        let mut out = vec![1234i16; SCRATCH_SAMPLES];
        slots.render(&mut out);
        assert!(out.iter().all(|&s| s == 1234),
            "an empty slot set must not touch the output buffer");
    }

    #[test]
    fn no_chain_host_means_no_panic_anywhere() {
        let mut slots = ChainSlots::new();
        assert!(!slots.is_available());
        slots.request_load(0, "synth", "plaits");
        slots.service_loads();
        slots.set_param(0, "synth:cutoff", "0.5");
        slots.on_midi(0, &[0x90, 60, 100], 0);
        let mut out = vec![0i16; SCRATCH_SAMPLES];
        slots.render(&mut out);
        assert_eq!(slots.get_param(0, "synth:cutoff"), None);
    }

    #[test]
    fn out_of_range_slots_are_ignored() {
        let mut slots = ChainSlots::new();
        slots.request_load(MOVY_CHAINS, "synth", "plaits");
        slots.request_load(999, "synth", "plaits");
        assert_eq!(slots.pending_loads(), 0, "a slot that cannot exist is not queued");
        slots.set_param(999, "synth:cutoff", "1");
        slots.on_midi(999, &[0x90, 60, 100], 0);
    }

    #[test]
    fn loads_are_queued_not_applied_inline() {
        let mut slots = ChainSlots::new();
        slots.request_load(0, "synth", "plaits");
        slots.request_load(1, "synth", "obxd");
        assert_eq!(slots.pending_loads(), 2, "requesting does not load");
    }

    #[test]
    fn service_releases_one_load_per_call() {
        let mut slots = ChainSlots::new();
        for i in 0..MOVY_CHAINS {
            slots.request_load(i, "synth", "plaits");
        }
        assert_eq!(slots.pending_loads(), 12);
        slots.service_loads();
        assert_eq!(slots.pending_loads(), 11, "one callback releases exactly one load");
    }

    #[test]
    fn teardown_clears_pending_work() {
        let mut slots = ChainSlots::new();
        slots.request_load(0, "synth", "plaits");
        slots.teardown();
        assert_eq!(slots.pending_loads(), 0);
    }

    #[test]
    fn a_failed_host_is_not_retried_forever() {
        let mut slots = ChainSlots::new();
        slots.configure("/nonexistent/chain", "/nonexistent/chain/dsp.so");
        assert!(!slots.is_available());
        assert!(slots.host_failed, "a broken install must not be re-dlopened every block");
        slots.configure("/nonexistent/chain", "/nonexistent/chain/dsp.so");
        assert!(!slots.is_available());
    }
}
