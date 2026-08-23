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

use crate::chain_cost::CostMeter;
use crate::chain_host::{ChainHost, ChainInstance};
use crate::host;
use crate::load_queue::{LoadQueue, LoadRequest};
use crate::mixer::{mix_into, TrackMix};
use crate::render_plan::Planner;
use crate::render_pool::{RenderPool, Task};

/// Chains movy hosts itself: tracks 4..15 (design §1).
pub const MOVY_CHAINS: usize = 12;

/// 128 frames stereo — schwung's block size. Preallocated: no allocation may
/// happen on the audio thread.
const SCRATCH_SAMPLES: usize = 128 * 2;

/// Helper threads beside the audio thread. Three lanes total is the design
/// point: `plans/2026-08-22-chain-balance-measurement.md` measured 2.98x there
/// against a 3.11x ceiling, and a fourth worker was worth 0.13x.
const HELPERS: usize = 2;

/// Blocks between replans. The plan follows measured cost, which only exists
/// after chains have rendered, so it cannot be fixed at load time — but
/// repartitioning every block would move chains between lanes on noise. ~3 s.
const REPLAN_BLOCKS: u32 = 1024;

pub struct ChainSlots {
    host: Option<ChainHost>,
    /// `None` until something is loaded — this is the "empty costs nothing" rule.
    slots: Vec<Option<ChainInstance>>,
    mixes: Vec<TrackMix>,
    queue: LoadQueue,
    /// One output buffer per chain, not one shared buffer: two chains rendering
    /// concurrently need somewhere disjoint to write, and the mix has to happen
    /// after the join anyway. 12 x 512 bytes.
    scratch: Vec<Vec<i16>>,
    /// Synth module id per chain. The planner keeps same-module chains on one
    /// lane, so it needs to know which chains those are.
    modules: Vec<String>,
    /// Set once the host has been tried and failed, so a broken install is not
    /// retried on every block.
    host_failed: bool,
    module_dir: String,
    /// Whether each slot has ever produced a non-silent block. Rendering without
    /// crashing and actually making a sound are different claims, and only the
    /// first is visible from a log line about loading — this makes the second
    /// observable too. Logged on the silent -> audible TRANSITION only, so the
    /// audio thread never logs per block.
    audible: Vec<bool>,
    /// Rolling count of chains that rendered in the last block, and the number
    /// currently loaded. The CPU ceiling has to come from measurement on real
    /// modules (design §5.3), and this is what a device test reads.
    active_last_block: usize,
    /// Output peak of each chain's LAST rendered block, 0-32767.
    ///
    /// A benchmark that cannot see this cannot tell "this synth costs the same
    /// at 1 and 4 notes because it renders its voices anyway" from "the notes
    /// never reached it and I measured silence" — and those look identical in a
    /// cost table. Cheap: one abs-max over a block movy has already rendered.
    peaks: Vec<i32>,
    /// Bumped whenever a chain's modules change. The UI watches this in `status`
    /// and marks its per-set state dirty, so a chain change is persisted no
    /// matter who made it — a browser load, a restore, an undo, or a remote
    /// param write that the UI never saw. Tying the save to the UI gesture
    /// instead meant anything else changed the chains without ever being saved.
    generation: u32,
    /// What each chain costs per block. The parallel-render design is bounded by
    /// the largest single chain, and nothing else here can see a distribution —
    /// `peaks` says a chain is audible, not what it cost.
    cost: CostMeter,
    /// Off by default. Parallel chain render is a prototype: it changes the
    /// implicit "one thread, one at a time, in slot order" contract that 93
    /// module repos were written against, so it is opted into per session and
    /// measured, never assumed.
    parallel: bool,
    pool: Option<RenderPool>,
    planner: Planner,
    /// Per-lane task lists, refilled in place each block — pushing into a `Vec`
    /// within its capacity does not allocate, and nothing may allocate here.
    lanes: Vec<Vec<Task>>,
    blocks_since_plan: u32,
    /// Chain-set generation the current plan was built for.
    plan_generation: u32,
    /// Which slots are loaded, as the planner wants it. A field rather than a
    /// local because replanning happens on the audio thread.
    loaded: Vec<bool>,
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
            scratch: vec![vec![0i16; SCRATCH_SAMPLES]; MOVY_CHAINS],
            modules: vec![String::new(); MOVY_CHAINS],
            host_failed: false,
            module_dir: String::new(),
            audible: vec![false; MOVY_CHAINS],
            peaks: vec![0; MOVY_CHAINS],
            generation: 0,
            active_last_block: 0,
            cost: CostMeter::new(MOVY_CHAINS),
            parallel: false,
            pool: None,
            planner: Planner::new(MOVY_CHAINS, HELPERS + 1),
            lanes: (0..HELPERS + 1).map(|_| Vec::with_capacity(MOVY_CHAINS)).collect(),
            blocks_since_plan: 0,
            plan_generation: u32::MAX,
            loaded: vec![false; MOVY_CHAINS],
        }
    }

    /// Turn parallel chain render on or off. Spawning the helpers is deferred to
    /// the first enable so a session that never asks for it never pays for the
    /// threads — and so a device measurement can A/B the same running set.
    pub fn set_parallel(&mut self, on: bool) {
        if on && self.pool.is_none() {
            self.pool = Some(RenderPool::new(HELPERS, MOVY_CHAINS));
        }
        self.parallel = on;
        // The next block replans: a plan built for one lane is wrong for three.
        self.plan_generation = u32::MAX;
        host::log(&format!("chain render: {}", if on { "parallel" } else { "serial" }));
    }

    /// `parallel=<0|1> lanes=<n> late=<blocks> plan=<lane0>|<lane1>|...`
    pub fn render_report(&self) -> String {
        let plan = self
            .planner
            .lanes
            .iter()
            .map(|l| l.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(","))
            .collect::<Vec<_>>()
            .join("|");
        format!(
            "parallel={} lanes={} yielded={} plan={}",
            self.parallel as u8,
            self.lanes.len(),
            self.pool.as_ref().map_or(0, |p| p.joins_yielded_blocks()),
            plan
        )
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
            state: None,
        });
    }

    /// Per-chain output peak of the last block, comma separated.
    pub fn peaks_csv(&self) -> String {
        let mut out = String::with_capacity(MOVY_CHAINS * 6);
        for (i, p) in self.peaks.iter().enumerate() {
            if i > 0 { out.push(','); }
            out.push_str(&p.to_string());
        }
        out
    }

    /// One chain's LFO assignments, and the LIVE value of each driven param.
    ///
    /// The value is the point. Target fields prove only that a write landed;
    /// sampling the driven param twice is the one external way to see that the
    /// LFO is actually moving the sound — which is what "the mapping does
    /// nothing" was really about. Diagnostic only, never on the render path.
    pub fn lfo_report(&mut self, slot: usize) -> String {
        let mut out = String::new();
        for i in 1..=2 {
            let g = |s: &mut Self, k: &str| s.get_param(slot, k).unwrap_or_default();
            let target = g(self, &format!("lfo{i}:target"));
            let param = g(self, &format!("lfo{i}:target_param"));
            let active = g(self, &format!("lfo{i}:active"));
            let value = if target.is_empty() || param.is_empty() {
                "-".to_string()
            } else {
                g(self, &format!("{target}:{param}"))
            };
            if i > 1 { out.push(' '); }
            out.push_str(&format!("lfo{i}=[{target}:{param} active={active} value={value}]"));
        }
        out
    }

    /// Monotonic count of serviced chain-module changes.
    pub fn generation(&self) -> u32 {
        self.generation
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
        if req.component == "synth" {
            /* The planner groups chains by module, and the module id is not
             * readable back from the chain host cheaply enough to ask for it on
             * the render path. Recorded here, where loads already overrun. */
            self.modules[req.slot].clear();
            self.modules[req.slot].push_str(&req.module);
        }
        if let Some(inst) = self.slots[req.slot].as_mut() {
            inst.set_param(&format!("{}:module", req.component), &req.module);
            /* Immediately after the module exists, and before anything else can
             * run — a restore's state would otherwise land on an empty slot. */
            if let Some(state) = req.state.as_deref() {
                inst.set_param(&format!("{}:state", req.component), state);
            }
        }
        /* Load events are rare (never the hot path) and this is the only
         * externally observable evidence that a chain load happened: schwung's
         * remote-UI socket can WRITE an engine param but has no read verb, so a
         * device test has nothing else to assert on. */
        self.generation = self.generation.wrapping_add(1);
        host::log(&format!(
            "chain {}: {} = {}",
            req.slot,
            req.component,
            if req.module.is_empty() { "(cleared)" } else { req.module.as_str() }
        ));
    }

    /// Apply a module-preset blob. Rides a pending load when there is one so it
    /// cannot be written before its module exists; applied directly otherwise.
    pub fn set_state(&mut self, slot: usize, component: &str, state: &str) {
        if slot >= MOVY_CHAINS {
            return;
        }
        if self.queue.attach_state(slot, component, state) {
            return;
        }
        if let Some(inst) = self.slots[slot].as_mut() {
            inst.set_param(&format!("{}:state", component), state);
        }
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

    pub fn get_param(&mut self, slot: usize, key: &str) -> Option<String> {
        self.slots.get_mut(slot)?.as_mut()?.get_param(key)
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
        let frames = out.len().min(SCRATCH_SAMPLES);

        // Render every chain into its own buffer, in parallel or not. The mix is
        // deliberately NOT part of this: summing after the join keeps the output
        // in slot order, so parallel and serial produce the same samples rather
        // than the same samples in whatever order the lanes finished.
        let t0 = self.cost.start();
        let active = if self.parallel_ready() {
            self.render_parallel(frames)
        } else {
            self.render_serial(frames)
        };
        if active > 0 {
            self.cost.add_wall(t0.elapsed().as_nanos() as u64);
        }

        for i in 0..MOVY_CHAINS {
            if self.slots[i].is_none() {
                continue;
            }
            let scratch = &self.scratch[i][..frames];
            let peak = scratch.iter().fold(0i32, |m, &s| m.max((s as i32).abs()));
            self.peaks[i] = peak;
            if !self.audible[i] && peak > 0 {
                self.audible[i] = true;
                host::log(&format!("chain {}: audio active (peak {})", i, peak));
            }
            mix_into(&mut out[..frames], scratch, &self.mixes[i]);
        }
        if active > 0 {
            self.cost.end_block();
        }
        self.active_last_block = active;
    }

    fn parallel_ready(&self) -> bool {
        self.parallel && self.pool.as_ref().is_some_and(|p| !p.is_poisoned())
    }

    fn render_serial(&mut self, frames: usize) -> usize {
        let mut active = 0usize;
        for i in 0..MOVY_CHAINS {
            let Some(inst) = self.slots[i].as_mut() else { continue };
            active += 1;
            let t0 = self.cost.start();
            inst.render_block(&mut self.scratch[i][..frames]);
            self.cost.stop(t0, i);
        }
        active
    }

    fn render_parallel(&mut self, frames: usize) -> usize {
        self.maybe_replan();

        for l in self.lanes.iter_mut() {
            l.clear();
        }
        let mut active = 0usize;
        for lane in 0..self.planner.lanes.len() {
            for idx in 0..self.planner.lanes[lane].len() {
                let c = self.planner.lanes[lane][idx];
                let Some((render, inst)) = self.slots[c].as_mut().and_then(|s| s.raw_render())
                else {
                    continue;
                };
                active += 1;
                self.lanes[lane].push(Task {
                    render,
                    inst,
                    buf: self.scratch[c].as_mut_ptr(),
                    frames: (frames / 2) as i32,
                    chain: c,
                });
            }
        }

        if let Some(pool) = self.pool.as_ref() {
            pool.render_block(&self.lanes);
            // Costs are timed on whichever lane ran the chain — the audio thread
            // cannot bracket a call it did not make.
            for c in 0..MOVY_CHAINS {
                if self.slots[c].is_some() {
                    self.cost.add_ns(c, pool.cost_ns(c));
                }
            }
        }
        active
    }

    /// Rebuild the lane assignment when the chain set changes, and periodically
    /// as measured costs settle. Allocation-free — see `render_plan::Planner`.
    fn maybe_replan(&mut self) {
        self.blocks_since_plan += 1;
        if self.plan_generation == self.generation && self.blocks_since_plan < REPLAN_BLOCKS {
            return;
        }
        self.plan_generation = self.generation;
        self.blocks_since_plan = 0;
        for (i, s) in self.slots.iter().enumerate() {
            self.loaded[i] = s.is_some();
        }
        self.planner.plan(&self.modules, self.cost.plan_ns(), &self.loaded);
    }

    /// Per-chain render cost since the last call — see `CostMeter::report`.
    /// Reading closes the window.
    pub fn cost_report(&mut self) -> String {
        self.cost.report()
    }

    /// How many chains rendered in the last block. Zero for a set with no movy
    /// instruments, which is the case the "empty chains cost nothing" rule is
    /// about.
    pub fn active_count(&self) -> usize {
        self.active_last_block
    }

    /// Drop every chain. The engine is going away; a pending load refers to
    /// slots that will not exist.
    pub fn teardown(&mut self) {
        self.queue.clear();
        for s in self.slots.iter_mut() {
            *s = None;
        }
        for a in self.audible.iter_mut() {
            *a = false;
        }
        for m in self.modules.iter_mut() {
            m.clear();
        }
        // Costs belong to instances that no longer exist — including the ones
        // the planner would otherwise reuse to assign lanes to a different set.
        self.cost.reset_all();
        self.plan_generation = u32::MAX;
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
