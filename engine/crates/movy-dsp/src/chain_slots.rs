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
use crate::chain_digest::{ChainDigest, STIMULUS};
use crate::chain_host::{ChainHost, ChainInstance};
use crate::chain_idle::{IdleGate, IdleLevel, Work};
use crate::chain_pin::PinPolicy;
use crate::ffi::MOVE_MIDI_SOURCE_INTERNAL;
use crate::host;
use crate::load_queue::{LoadQueue, LoadRequest};
use crate::mixer::{mix_into, TrackMix};
use crate::render_plan::Planner;
use crate::render_pool::{RenderPool, Task};

/// Chains movy hosts itself: **one per track, and `ch<N>` IS track N.**
///
/// Twelve used to back tracks 4..15, numbered 0..11. The four added for the
/// `chtracks` flag — which lets tracks 0..3 leave schwung's shadow slots and
/// render here, on the parallel lanes instead of serially on the audio thread —
/// could have been appended as 12..15 to leave the twelve where they were. They
/// were not: a mapping with an offset in it is a mapping someone gets wrong, and
/// nothing persisted holds a chain index anyway (movy's saved state records a
/// TRACK, and every param goes through a port), so the renumbering costs no
/// migration.
///
/// Chains 0..3 sit allocated and empty until the flag is turned on — a `Vec`
/// slot and 512 bytes of scratch each.
pub const MOVY_CHAINS: usize = 16;

/// 128 frames stereo — schwung's block size. Preallocated: no allocation may
/// happen on the audio thread.
const SCRATCH_SAMPLES: usize = 128 * 2;

/// Lanes including the audio thread's own, so `DEFAULT_LANES - 1` helpers.
/// Three was the design point from `plans/2026-08-22-chain-balance-measurement.md`
/// — 2.98x against a 3.11x ceiling, with a fourth worker worth 0.13x.
///
/// That pricing assumed the chains cost the same however many render at once,
/// and D1 has since measured them costing **27% more** with three lanes running
/// (`plans/2026-08-23-parallel-render-prototype.md` §6). A lane is therefore
/// also a *cost* to the other lanes, which is why the count is now runtime
/// settable (`chlanes`) rather than a constant: whether 3 beats 2 has to be
/// measured on the device, not assumed here.
const DEFAULT_LANES: usize = 3;

/// Move's four cores, minus none: lane 0 is the audio thread, which is already
/// running. Beyond this the helpers are competing for cores Move's own FIFO 70
/// workers need immediately after us.
const MAX_LANES: usize = 4;

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
    /// Which chains must share a lane. Modules are assumed thread-safe, so this
    /// is empty unless a module is blacklisted or `chpin` is on — see
    /// `chain_pin`.
    pin: PinPolicy,
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
    /// Lanes to plan for, including lane 0 (the audio thread). Changing it is a
    /// measurement control, not a live tuning knob — it rebuilds the pool.
    lane_count: usize,
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
    /// Keep same-module chains on one lane. OFF by default: modules are assumed
    /// thread-safe and the ones proven otherwise go on `chain_pin`'s blacklist.
    pin_duplicates: bool,
    /// Which chains may skip work this block. See `chain_idle`.
    idle: IdleGate,
    /// This block's decision per chain, taken once before anything renders —
    /// the parallel path builds its whole task list up front, so serial and
    /// parallel have to be reading the same answer.
    work: Vec<Work>,
    /// Each chain's peak after its synth stage and before its FX. Written by
    /// whichever lane rendered it; the parallel path copies it back after the
    /// join, exactly as it already does for cost.
    synth_peak: Vec<i32>,
    /// The `idle` epoch the current lane plan was built for.
    plan_idle_epoch: u32,
    /// The equivalence oracle: what each chain rendered, not what it cost.
    /// Idle until `chdigest` arms it.
    digest: ChainDigest,
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
            pin: PinPolicy::new(MOVY_CHAINS),
            host_failed: false,
            module_dir: String::new(),
            audible: vec![false; MOVY_CHAINS],
            peaks: vec![0; MOVY_CHAINS],
            generation: 0,
            active_last_block: 0,
            cost: CostMeter::new(MOVY_CHAINS),
            parallel: false,
            lane_count: DEFAULT_LANES,
            pool: None,
            planner: Planner::new(MOVY_CHAINS, DEFAULT_LANES),
            lanes: (0..DEFAULT_LANES).map(|_| Vec::with_capacity(MOVY_CHAINS)).collect(),
            blocks_since_plan: 0,
            plan_generation: u32::MAX,
            loaded: vec![false; MOVY_CHAINS],
            pin_duplicates: false,
            digest: ChainDigest::new(MOVY_CHAINS),
            idle: IdleGate::new(MOVY_CHAINS),
            work: vec![Work::NONE; MOVY_CHAINS],
            synth_peak: vec![0; MOVY_CHAINS],
            plan_idle_epoch: u32::MAX,
        }
    }

    /// Turn parallel chain render on or off. Spawning the helpers is deferred to
    /// the first enable so a session that never asks for it never pays for the
    /// threads — and so a device measurement can A/B the same running set.
    pub fn set_parallel(&mut self, on: bool) {
        if on && self.pool.is_none() {
            self.pool = Some(RenderPool::new(self.lane_count - 1, MOVY_CHAINS));
        }
        self.parallel = on;
        // The next block replans: a plan built for one lane is wrong for three.
        self.plan_generation = u32::MAX;
        host::log(&format!(
            "chain mode: {} lanes={}",
            if on { "parallel" } else { "serial" },
            self.lane_count
        ));
    }

    /// How many lanes to render across, lane 0 being the audio thread itself.
    ///
    /// `1` is a real setting, not a no-op alias for serial: it runs the parallel
    /// path with no helpers, which is the control arm that separates what the
    /// planner and rendezvous cost from what the extra threads buy.
    ///
    /// Rebuilding the pool rather than resizing it keeps the "written only while
    /// every helper is idle" invariant that `render_block` relies on: the old
    /// pool's helpers are stopped and joined by its `Drop` before the new ones
    /// exist. Both that and the spawn are why this is a between-measurements
    /// control — it blocks, so it must never be called from a render.
    pub fn set_lanes(&mut self, lanes: usize) {
        let lanes = lanes.clamp(1, MAX_LANES);
        if lanes == self.lane_count {
            return;
        }
        self.lane_count = lanes;
        self.planner = Planner::new(MOVY_CHAINS, lanes);
        self.lanes = (0..lanes).map(|_| Vec::with_capacity(MOVY_CHAINS)).collect();
        self.plan_generation = u32::MAX;
        // Drop first: two pools' helpers must never be alive at once, or the
        // measurement is against more threads than it thinks it has.
        self.pool = None;
        if self.parallel {
            self.pool = Some(RenderPool::new(lanes - 1, MOVY_CHAINS));
        }
        host::log(&format!("chain mode: lanes={lanes}"));
    }

    /// Pin EVERY duplicate to one lane, not just the blacklisted ones.
    ///
    /// Unlike `set_lanes` this does not touch the pool, so it is cheap — but it
    /// must still force a replan, or the flag flips while the assignment it
    /// changes stays exactly as it was for up to `REPLAN_BLOCKS`, and an arm
    /// that believes it pinned the duplicates measures the split plan instead.
    pub fn set_pin_duplicates(&mut self, pin: bool) {
        if pin == self.pin_duplicates {
            return;
        }
        self.pin_duplicates = pin;
        self.pin.set_pin_all(pin);
        self.plan_generation = u32::MAX;
        host::log(&format!("chain mode: pin_duplicates={}", pin as u8));
    }

    /// Modules proven to race, whose instances all go back on one lane. Forces
    /// a replan for the same reason `set_pin_duplicates` does — the keys it
    /// rewrites are only read when the plan is rebuilt.
    pub fn set_blacklist(&mut self, csv: &str) {
        self.pin.set_blacklist(csv);
        self.plan_generation = u32::MAX;
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
        // `pin`, `blocked` and `pinned` are reported because the harness cannot
        // infer any of them: a set with no duplicated module plans identically
        // however they are set, so an arm that meant to pin duplicates and did
        // not looks exactly like one that did. `pinned` is the count that
        // separates "pinning was on" from "pinning had nothing to do".
        format!(
            "parallel={} lanes={} pin={} blocked={} pinned={} yielded={} plan={}",
            self.parallel as u8,
            self.lanes.len(),
            self.pin_duplicates as u8,
            self.pin.blacklist_len(),
            self.pin.pinned(),
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

    pub fn idle_level(&self) -> IdleLevel {
        self.idle.level()
    }

    /// Changing the level re-applies external FX mode to every live chain: the
    /// mode is a property of the instance, and a chain loaded under one level
    /// would otherwise keep rendering under the old contract.
    pub fn set_idle_level(&mut self, level: IdleLevel) {
        if self.idle.level() == level {
            return;
        }
        self.idle.set_level(level);
        let split = level.splits();
        for s in self.slots.iter_mut().flatten() {
            let want = split && s.supports_split();
            s.set_external_fx_mode(want);
        }
        self.plan_generation = u32::MAX;
        host::log(&format!("chain idle: level {level:?}"));
    }

    /// Chains whose synth is asleep. Read by `diag` and `status`.
    pub fn asleep_count(&self) -> usize {
        self.idle.asleep_count()
    }

    /// The gate's state, for `chidlelog`.
    ///
    /// The socket a device script drives can WRITE an engine param but has no
    /// read verb, so `diag` and `status` — where these numbers also live — are
    /// unreachable from a benchmark. Same write-to-read trick as `chcostlog`.
    pub fn idle_report(&self) -> String {
        let mut deep = 0;
        for i in 0..MOVY_CHAINS {
            if self.idle.deep_asleep(i) {
                deep += 1;
            }
        }
        // The counts alone cannot answer "is THIS chain asleep?", which is the
        // question any check aimed at one chain has to ask — a global count of
        // ten lets a test pass while the chain it is watching stays awake.
        let mut sleeping = String::new();
        for i in 0..MOVY_CHAINS {
            if self.idle.deep_asleep(i) {
                if !sleeping.is_empty() {
                    sleeping.push(',');
                }
                sleeping.push_str(&i.to_string());
            }
        }
        format!(
            "level={:?} asleep={} deep={} loaded={} sleeping=[{}]",
            self.idle.level(),
            self.idle.asleep_count(),
            deep,
            self.slots.iter().filter(|s| s.is_some()).count(),
            sleeping
        )
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
        self.pin.on_load(req.slot, &req.component, &req.module);
        let t_set = std::time::Instant::now();
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
        self.idle.wake(req.slot);
        /* A freshly created instance is in whatever FX mode the module defaults
         * to. Claim it here, once, rather than per block. */
        if let Some(inst) = self.slots[req.slot].as_mut() {
            let split = self.idle.level().splits() && inst.supports_split();
            inst.set_external_fx_mode(split);
        }
        /* The load path IS the audio thread, so every millisecond here is a
         * dropped frame — and this one is a blocking dlopen, which is the
         * expensive half of opening a set. Logged rather than assumed, because
         * a dropout nobody recorded is indistinguishable from a threading bug
         * in whatever measurement follows it. */
        let set_ms = t_set.elapsed().as_millis();
        if set_ms >= 20 {
            host::log(&format!("chain {}: load blocked {} ms", req.slot, set_ms));
        }
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
        self.idle.wake(slot);
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
        self.idle.wake(slot);
        if let Some(inst) = self.slots[slot].as_mut() {
            inst.set_param(key, val);
        }
    }

    pub fn get_param(&mut self, slot: usize, key: &str) -> Option<String> {
        self.slots.get_mut(slot)?.as_mut()?.get_param(key)
    }

    pub fn set_mix(&mut self, slot: usize, mix: TrackMix) {
        if slot < MOVY_CHAINS {
            self.idle.wake(slot);
            self.mixes[slot] = mix;
        }
    }

    /// Deliver a MIDI message to one chain.
    pub fn on_midi(&mut self, slot: usize, msg: &[u8], source: core::ffi::c_int) {
        if slot >= MOVY_CHAINS {
            return;
        }
        self.idle.wake(slot);
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

        // Struck BEFORE the render, so the window's first block is the note-on's
        // own block in both arms. Doing it from a socket write instead would put
        // the note wherever the network happened to deliver it.
        if self.digest.open_block() {
            self.digest_stimulus(true);
        }

        // Render every chain into its own buffer, in parallel or not. The mix is
        // deliberately NOT part of this: summing after the join keeps the output
        // in slot order, so parallel and serial produce the same samples rather
        // than the same samples in whatever order the lanes finished.
        // Decide first, for every chain, before anything renders — the parallel
        // path builds its whole task list up front, so a decision that depended
        // on this block's own output could not be honoured there.
        let digesting = self.digest.running();
        for i in 0..MOVY_CHAINS {
            self.work[i] = if self.slots[i].is_none() {
                Work::NONE
            } else if digesting {
                // The oracle compares renders. A skipped block is not a
                // difference in threading, which is the only thing it is
                // allowed to report.
                Work { synth: true, fx: self.idle.level().splits() }
            } else {
                self.idle.plan(i)
            };
        }
        // LFOs still have to advance for every chain whose synth did not render,
        // and on the audio thread rather than a lane — see `ChainInstance::mod_tick`.
        if self.idle.level().splits() {
            for i in 0..MOVY_CHAINS {
                if !self.work[i].synth {
                    if let Some(inst) = self.slots[i].as_mut() {
                        inst.mod_tick();
                    }
                }
            }
        }

        let t0 = self.cost.start();
        let active = if self.parallel_ready() {
            self.render_parallel(frames)
        } else {
            self.render_serial(frames)
        };
        if active > 0 {
            self.cost.add_wall(t0.elapsed().as_nanos() as u64);
        }
        // After the join, before anything else: every lane is idle, so schwung
        // sees exactly one producer again, and slot order makes the emission
        // deterministic. Costs nothing when no chain sent anything, which today
        // is every chain in the fleet.
        crate::midi_out::QUEUE.drain(crate::chain_host::send_direct);

        for i in 0..MOVY_CHAINS {
            if self.slots[i].is_none() {
                continue;
            }
            if self.work[i].none() {
                // Nothing ran, so the scratch holds a stale block. Not mixed,
                // and its peak is the truth about this block: silence.
                self.peaks[i] = 0;
                continue;
            }
            let scratch = &self.scratch[i][..frames];
            let peak = scratch.iter().fold(0i32, |m, &s| m.max((s as i32).abs()));
            self.peaks[i] = peak;
            // After the join and before the mix: this reads exactly what the
            // lane that rendered the chain wrote, which is the thing under test.
            if digesting {
                self.digest.fold(i, scratch, peak);
            }
            if !self.audible[i] && peak > 0 {
                self.audible[i] = true;
                host::log(&format!("chain {}: audio active (peak {})", i, peak));
            }
            mix_into(&mut out[..frames], scratch, &self.mixes[i]);
        }
        // Folded back after the mix, so the borrow of `scratch` is done with.
        for i in 0..MOVY_CHAINS {
            let w = self.work[i];
            if w.none() {
                continue;
            }
            let keep_alive =
                w.fx && self.slots[i].as_mut().is_some_and(|s| s.fx_requires_continuous());
            self.idle.observe(i, w, self.synth_peak[i], self.peaks[i], keep_alive);
        }
        if active > 0 {
            self.cost.end_block();
        }
        self.active_last_block = active;
        // The run releases what it struck: a device must never be left holding
        // 48 notes because a benchmark was interrupted between arms.
        if self.digest.close_block() {
            self.digest_stimulus(false);
            host::log(&format!("chain digest: {}", self.digest.report()));
        }
    }

    /// Strike or release the digest's fixed chord on every loaded chain.
    ///
    /// Straight into the instances rather than through `on_midi`: the pad
    /// routing and held-note ledger belong to what the player is doing, and a
    /// measurement must not leave entries in them.
    fn digest_stimulus(&mut self, on: bool) {
        for slot in self.slots.iter_mut().flatten() {
            for &p in STIMULUS.iter() {
                let m = if on { [0x90, p, 100] } else { [0x80, p, 0] };
                slot.on_midi(&m, MOVE_MIDI_SOURCE_INTERNAL);
            }
        }
    }

    /// Arm an equivalence run: strike a fixed chord, digest `blocks` blocks of
    /// every chain's output, release. See `chain_digest`.
    pub fn digest_arm(&mut self, blocks: u32) {
        // The oracle compares renders, and `digest_stimulus` strikes its chord
        // straight into the instances — bypassing `on_midi`, so the gate would
        // never see the notes that are about to arrive.
        self.idle.wake_all();
        self.digest.arm(blocks);
        host::log(&format!("chain digest: armed window={blocks}"));
    }

    pub fn digest_report(&self) -> String {
        self.digest.report()
    }

    fn parallel_ready(&self) -> bool {
        self.parallel && self.pool.as_ref().is_some_and(|p| !p.is_poisoned())
    }

    fn render_serial(&mut self, frames: usize) -> usize {
        let mut active = 0usize;
        let split = self.idle.level().splits();
        for i in 0..MOVY_CHAINS {
            let w = self.work[i];
            if w.none() {
                continue;
            }
            let Some(inst) = self.slots[i].as_mut() else { continue };
            active += 1;
            let t0 = self.cost.start();
            // Serial takes the same scope as a lane does, so a module's MIDI
            // leaves in slot order after the block in BOTH modes. Two orderings
            // would be a difference parallel introduced, which is the one thing
            // it is not allowed to do.
            let scope = crate::midi_out::Scope::enter(i);
            if w.synth {
                inst.render_block(&mut self.scratch[i][..frames]);
            } else {
                // The FX is owed silence to decay into, not the last block.
                self.scratch[i][..frames].fill(0);
            }
            if split {
                self.synth_peak[i] = self.scratch[i][..frames]
                    .iter()
                    .fold(0i32, |m, &s| m.max((s as i32).abs()));
            }
            if w.fx {
                inst.process_fx(&mut self.scratch[i][..frames]);
            }
            drop(scope);
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
                let w = self.work[c];
                if w.none() {
                    continue;
                }
                let Some((ptr, render, fx)) = self.slots[c].as_mut().map(|s| s.raw_parts()) else {
                    continue;
                };
                let render = if w.synth { render } else { None };
                let fx = if w.fx { fx } else { None };
                if render.is_none() && fx.is_none() {
                    // A module with no render_block and nothing to process: the
                    // same slot the old code skipped outright.
                    continue;
                }
                active += 1;
                self.lanes[lane].push(Task {
                    render,
                    process_fx: fx,
                    inst: ptr,
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
                    self.synth_peak[c] = pool.synth_peak(c);
                }
            }
        }
        active
    }

    /// Rebuild the lane assignment when the chain set changes, and periodically
    /// as measured costs settle. Allocation-free — see `render_plan::Planner`.
    fn maybe_replan(&mut self) {
        self.blocks_since_plan += 1;
        if self.plan_generation == self.generation
            && self.plan_idle_epoch == self.idle.epoch()
            && self.blocks_since_plan < REPLAN_BLOCKS
        {
            return;
        }
        self.plan_generation = self.generation;
        self.plan_idle_epoch = self.idle.epoch();
        self.blocks_since_plan = 0;
        for (i, s) in self.slots.iter().enumerate() {
            // A deep-asleep chain is not work, and a partition that counts it
            // can put every SOUNDING chain on one lane.
            self.loaded[i] = s.is_some() && !self.idle.deep_asleep(i);
        }
        self.planner.plan(self.pin.pin_keys(), self.cost.plan_ns(), &self.loaded);
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
        for i in 0..MOVY_CHAINS {
            self.slots[i] = None;
            self.idle.forget(i);
        }
        for a in self.audible.iter_mut() {
            *a = false;
        }
        self.pin.clear();
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

    /* The digest is compiled in permanently but must cost a set that never asks
     * for it exactly one bool check per block — so "off until armed" is a
     * property worth pinning, not an implementation detail. */
    #[test]
    fn the_digest_is_off_until_it_is_armed() {
        let mut slots = ChainSlots::new();
        assert!(slots.digest_report().starts_with("state=off "), "{}", slots.digest_report());
        slots.digest_arm(64);
        assert!(slots.digest_report().starts_with("state=armed window=64 "),
            "{}", slots.digest_report());
    }

    /// The whole point, stated as a property: nothing that skipped its render
    /// may reach the mix, because its scratch buffer holds a stale block.
    #[test]
    fn a_chain_that_did_not_render_is_not_mixed() {
        let mut slots = ChainSlots::new();
        let mut out = vec![1234i16; SCRATCH_SAMPLES];
        // No chain host on the host build, so nothing is loaded and nothing can
        // render — every chain's work is NONE and the buffer must be untouched.
        slots.render(&mut out);
        assert!(out.iter().all(|&s| s == 1234));
        assert_eq!(slots.active_count(), 0);
    }

    #[test]
    fn the_idle_level_survives_a_round_trip() {
        let mut slots = ChainSlots::new();
        assert_eq!(slots.idle_level(), IdleLevel::SynthFx, "on by default");
        slots.set_idle_level(IdleLevel::Off);
        assert_eq!(slots.idle_level(), IdleLevel::Off);
        slots.set_idle_level(IdleLevel::SynthFx);
        assert_eq!(slots.idle_level(), IdleLevel::SynthFx);
        assert_eq!(slots.asleep_count(), 0, "nothing is loaded, so nothing sleeps");
    }

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

    /* The lane count is a measurement control (T0: does 3 lanes beat 2 at all?),
     * so what has to hold is that everything sized by it moves together. Three
     * things are: the planner, the per-lane task lists, and the pool's helper
     * count. A plan with more lanes than the task-list vector indexes out of
     * range on the audio thread; a pool that kept its old helper count would
     * measure a lane count nobody asked for. */

    #[test]
    fn set_lanes_resizes_the_plan_and_the_task_lists_together() {
        let mut slots = ChainSlots::new();
        assert_eq!(slots.planner.lane_count(), DEFAULT_LANES);
        slots.set_lanes(2);
        assert_eq!(slots.planner.lane_count(), 2, "the plan follows the lane count");
        assert_eq!(slots.lanes.len(), 2, "and so do the task lists it is copied into");
        assert!(slots.render_report().contains("lanes=2"), "and the report says so");
    }

    #[test]
    fn a_lane_count_the_hardware_cannot_staff_is_clamped() {
        let mut slots = ChainSlots::new();
        slots.set_lanes(99);
        assert_eq!(slots.lanes.len(), MAX_LANES, "four cores is the ceiling");
        slots.set_lanes(0);
        assert_eq!(slots.lanes.len(), 1, "and one lane — the audio thread — the floor");
    }

    #[test]
    fn the_pool_is_rebuilt_to_match() {
        let mut slots = ChainSlots::new();
        slots.set_parallel(true);
        assert_eq!(slots.pool.as_ref().map(|p| p.helpers()), Some(DEFAULT_LANES - 1));
        slots.set_lanes(2);
        assert_eq!(slots.pool.as_ref().map(|p| p.helpers()), Some(1),
            "a two-lane measurement must actually run one helper");
        // One lane is the control arm, not an alias for serial: the parallel
        // path still runs, with nothing to fan out to.
        slots.set_lanes(1);
        assert_eq!(slots.pool.as_ref().map(|p| p.helpers()), Some(0));
        assert!(slots.parallel, "one lane is still the parallel path");
    }

    /* Pinning is containment, so the ways it can fail quietly matter more than
     * the ways it can fail loudly: a set that thinks it pinned a racing module
     * and did not sounds exactly like one that had nothing to pin. */

    #[test]
    fn pinning_forces_a_replan_rather_than_waiting_for_one() {
        let mut slots = ChainSlots::new();
        slots.plan_generation = slots.generation;
        slots.blocks_since_plan = 0;
        slots.set_pin_duplicates(true);
        assert_eq!(slots.plan_generation, u32::MAX,
            "the plan the flag changes must be rebuilt before the next block, not in 512");
    }

    /// The blacklist rewrites the same keys `chpin` does, so it needs the same
    /// replan — a module blacklisted mid-set must stop racing THIS block, not in
    /// `REPLAN_BLOCKS`.
    #[test]
    fn blacklisting_forces_a_replan_too() {
        let mut slots = ChainSlots::new();
        slots.plan_generation = slots.generation;
        slots.set_blacklist("helm");
        assert_eq!(slots.plan_generation, u32::MAX);
    }

    #[test]
    fn the_report_says_which_pinning_an_arm_ran_under() {
        let mut slots = ChainSlots::new();
        assert!(slots.render_report().contains("pin=0"), "free is the default now");
        assert!(slots.render_report().contains("blocked=0"));
        slots.set_pin_duplicates(true);
        slots.set_blacklist("helm,obxd");
        let r = slots.render_report();
        assert!(r.contains("pin=1"), "{r}");
        assert!(r.contains("blocked=2"), "the blacklist is reported too: {r}");
    }

    #[test]
    fn lanes_can_be_chosen_before_the_pool_exists() {
        let mut slots = ChainSlots::new();
        slots.set_lanes(2);
        assert!(slots.pool.is_none(), "asking for lanes does not spawn threads");
        slots.set_parallel(true);
        assert_eq!(slots.pool.as_ref().map(|p| p.helpers()), Some(1),
            "the deferred spawn uses the count that was asked for");
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
        assert_eq!(slots.pending_loads(), MOVY_CHAINS);
        slots.service_loads();
        assert_eq!(
            slots.pending_loads(),
            MOVY_CHAINS - 1,
            "one callback releases exactly one load"
        );
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
