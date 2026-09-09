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
use crate::chain_doc;
use crate::chain_digest::{ChainDigest, STIMULUS};
use crate::chain_host::{ChainHost, ChainInstance};
use crate::chain_idle::{IdleGate, Work};
use crate::chain_pin::PinPolicy;
use crate::ffi::MOVE_MIDI_SOURCE_INTERNAL;
use crate::host;
use crate::load_queue::{LoadQueue, LoadRequest};
use crate::mixer::{mix_into, MixField, TrackMix};
use crate::send_bus::{SendBuses, SEND_BUSES};
use crate::render_plan::{worth_fanning_out, Planner};
use crate::render_pool::{Pre, RenderPool, Tap, Task, MAX_TAPS, NO_TAPS};

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

/// Lanes including the audio thread's own, so `LANES - 1` helpers.
/// Three was the design point from `plans/2026-08-22-chain-balance-measurement.md`
/// — 2.98x against a 3.11x ceiling, with a fourth worker worth 0.13x.
///
/// That pricing assumed the chains cost the same however many render at once,
/// and D1 has since measured them costing **27% more** with three lanes running
/// (`plans/2026-08-23-parallel-render-prototype.md` §6) — a lane is a *cost* to
/// the other lanes as well as a gain. Three was therefore swept on the device
/// rather than assumed, and it won: a fourth lane puts the helpers in
/// competition for the cores Move's own FIFO 70 workers need immediately after
/// us, and lost to the rendezvous overhead it added.
const LANES: usize = 3;

/// Blocks between replans. The plan follows measured cost, which only exists
/// after chains have rendered, so it cannot be fixed at load time — but
/// repartitioning every block would move chains between lanes on noise. ~3 s.
const REPLAN_BLOCKS: u32 = 1024;

/// The chain host component a send bus loads its FX into. A send holds one
/// audio FX, so the bus number lives in the engine key and the component
/// underneath is always the same — the UI never has to know it exists.
const SEND_COMPONENT: &str = "fx1";

/// Every position the render pool can be given work for: the chains, then the
/// send buses. ONE index space, so a task's `chain` field names exactly one
/// cost slot, one MIDI queue and one pin key whichever phase built it.
pub const RENDER_SLOTS: usize = MOVY_CHAINS + SEND_BUSES;

/// Where send bus `n` sits in that space. Above every chain, so it can never
/// collide with a track: the load queue is slot-generic and would not notice,
/// but a reverb loaded into somebody's synth is not a subtle failure.
///
/// One formula, four users — the load queue, the pool's per-slot cost and MIDI
/// attribution, and `chain_pin`. A second copy of it is a mapping somebody gets
/// wrong in only one of them.
pub fn send_index(bus: usize) -> usize {
    MOVY_CHAINS + bus
}

pub struct ChainSlots {
    host: Option<ChainHost>,
    /// `None` until something is loaded — this is the "empty costs nothing" rule.
    slots: Vec<Option<ChainInstance>>,
    mixes: Vec<TrackMix>,
    queue: LoadQueue,
    /// The chain set as last REQUESTED, per slot, as (component, module) in the
    /// order it arrived. Not as last loaded: a load is queued and released one
    /// per audio callback, so "what has finished dlopen-ing" is a moving target
    /// that a save must never be allowed to see. Reporting the request instead
    /// is what makes a partial set unrepresentable — see
    /// plans/2026-08-29-chain-set-document.md.
    desired: Vec<Vec<(String, String)>>,
    /// One output buffer per chain, not one shared buffer: two chains rendering
    /// concurrently need somewhere disjoint to write, and the mix has to happen
    /// after the join anyway. 12 x 512 bytes.
    scratch: Vec<Vec<i16>>,
    /// Which chains must share a lane. Modules are assumed thread-safe, so this
    /// is empty unless a module is blacklisted — see
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
    /// The helper threads, spawned once by `configure` — off the audio thread,
    /// which is the only place a spawn may happen. `None` until movy actually
    /// hosts chains, and the render falls back to serial while it is (see
    /// `parallel_ready`).
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
    /// The two send buses. Deliberately NOT entries in `slots`: `ch<N>` IS
    /// track N, and sixty-odd sites in this crate read `slots` as exactly
    /// `MOVY_CHAINS` tracks. A separate field makes every one of them correct
    /// by construction rather than by audit (design §4).
    sends: SendBuses,
    /// Whether the last send phase actually fanned out. The `sndlog` read-back
    /// for it: from outside, a parallel send phase and a serial one produce
    /// identical audio and identical per-bus costs, so without this a device
    /// measurement cannot tell which one it just timed — and every number it
    /// reports would be unfalsifiable.
    send_fanned: bool,
    /// Which buses owe their FX a call this block. Decided once, before the
    /// phase runs, so the partition and the mix cannot disagree about it.
    send_work: Vec<bool>,
    /// The send phase's own partition. A second `Planner` rather than a reuse of
    /// the chain one: the two phases run one after the other and hold different
    /// assignments at the same time, and one instance cannot carry both.
    send_planner: Planner,
    send_lanes: Vec<Vec<Task>>,
    /// Buses the planner accepted onto a chain lane, and the chains feeding
    /// each. A replan-time snapshot: `plan_dirty` is what keeps it from going
    /// stale, because a feeder appearing on another lane is a data race on the
    /// bus buffer and not merely a worse partition. See `chain_colo` §4.
    colo_bus: [bool; SEND_BUSES],
    colo_feeders: [u16; SEND_BUSES],
    /// Which co-located buses actually run THIS block — the per-block half of
    /// the decision, since a tail can retire a bus between replans.
    colo_ran: [bool; SEND_BUSES],
    /// The combined index space the chain planner is handed: chains, then
    /// buses. Preallocated with room for any pin key so that assembling it
    /// cannot allocate — planning runs on the audio thread.
    colo_keys: Vec<String>,
    colo_loaded: Vec<bool>,
    colo_cost: Vec<u64>,
    /// A send gain crossed zero, so the feeder sets are wrong until the next
    /// plan. Forces one, whatever the timer says.
    plan_dirty: bool,
    /// Which of a chain's eight automation lanes drive the MIXER rather than a
    /// param inside the chain. Empty for every lane by default, so a chain that
    /// automates nothing of movy's own costs one array lookup per CC.
    mix_lanes: Vec<[Option<MixField>; 8]>,
    /// The FX instance behind each bus. One audio FX per send, so the chain
    /// host's component underneath is always `fx1`.
    send_slots: Vec<Option<ChainInstance>>,
    /// Whether a bus actually holds a module.
    ///
    /// NOT `send_slots[n].is_some()`: clearing a send sets `fx1:module` to the
    /// empty string and leaves the instance in place, so the slot stays `Some`
    /// for a bus with nothing in it. The alternative read-back, `send_module`,
    /// asks the chain host across FFI and needs `&mut self` — neither of which
    /// belongs in a status line built 24 times a second.
    send_loaded: Vec<bool>,
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
            desired: vec![Vec::new(); MOVY_CHAINS],
            scratch: vec![vec![0i16; SCRATCH_SAMPLES]; MOVY_CHAINS],
            pin: PinPolicy::new(RENDER_SLOTS),
            host_failed: false,
            module_dir: String::new(),
            audible: vec![false; MOVY_CHAINS],
            peaks: vec![0; MOVY_CHAINS],
            generation: 0,
            active_last_block: 0,
            cost: CostMeter::new(MOVY_CHAINS),
            pool: None,
            planner: Planner::new(MOVY_CHAINS, LANES),
            lanes: (0..LANES).map(|_| Vec::with_capacity(MOVY_CHAINS)).collect(),
            blocks_since_plan: 0,
            plan_generation: u32::MAX,
            loaded: vec![false; MOVY_CHAINS],
            digest: ChainDigest::new(MOVY_CHAINS),
            idle: IdleGate::new(MOVY_CHAINS),
            work: vec![Work::NONE; MOVY_CHAINS],
            synth_peak: vec![0; MOVY_CHAINS],
            plan_idle_epoch: u32::MAX,
            sends: SendBuses::new(),
            send_fanned: false,
            send_work: vec![false; SEND_BUSES],
            colo_bus: [false; SEND_BUSES],
            colo_feeders: [0; SEND_BUSES],
            colo_ran: [false; SEND_BUSES],
            /* 128 bytes each, never grown after this: a pin key is
             * `<namespace>/<module>` and the longest namespace is
             * `sound_generators`, so a module name would have to run past 110
             * characters to force a reallocation on the audio thread. */
            colo_keys: (0..RENDER_SLOTS).map(|_| String::with_capacity(128)).collect(),
            colo_loaded: vec![false; RENDER_SLOTS],
            colo_cost: vec![0; RENDER_SLOTS],
            plan_dirty: false,
            send_planner: Planner::new(SEND_BUSES, LANES),
            send_lanes: (0..LANES).map(|_| Vec::with_capacity(SEND_BUSES)).collect(),
            mix_lanes: vec![[None; 8]; MOVY_CHAINS],
            send_slots: (0..SEND_BUSES).map(|_| None).collect(),
            send_loaded: vec![false; SEND_BUSES],
        }
    }

    /// Modules proven to race, whose instances all go back on one lane. Forces
    /// a replan, because the keys it rewrites are only read when the plan is
    /// rebuilt — without it the list changes while the assignment it governs
    /// stays exactly as it was for up to `REPLAN_BLOCKS`.
    pub fn set_blacklist(&mut self, csv: &str) {
        self.pin.set_blacklist(csv);
        self.plan_generation = u32::MAX;
    }

    /// `lanes=<n> blocked=<n> pinned=<n> yielded=<blocks> plan=<lane0>|<lane1>|...`
    pub fn render_report(&self) -> String {
        let plan = self
            .planner
            .lanes
            .iter()
            .map(|l| l.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(","))
            .collect::<Vec<_>>()
            .join("|");
        // `blocked` and `pinned` are reported because the harness cannot infer
        // either: a set with no duplicated module plans identically whatever
        // the blacklist holds, so a blacklist that took looks exactly like one
        // that did not. `pinned` is the count that separates "the module was
        // listed" from "the listing had nothing to do".
        format!(
            "lanes={} blocked={} pinned={} yielded={} plan={}",
            self.lanes.len(),
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
            Ok(h) => {
                self.host = Some(h);
                /* The one place the helpers may be spawned: `configure` is a
                 * param set, called once and never from a render. Spawning is
                 * blocking, so the audio thread can never be where it happens —
                 * and until it has, `parallel_ready` keeps the render serial. */
                self.pool = Some(RenderPool::new(LANES - 1, RENDER_SLOTS));
            }
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
        /* The one place the set is updated, for the same reason `generation`
         * lives on this path: a module can arrive from a browser load, an undo,
         * or a remote param write the UI never saw, and all of them have to be
         * in the set the next save writes down. */
        let at = self.desired[slot].iter().position(|(c, _)| c == component);
        match (at, module.is_empty()) {
            // The empty string is schwung's teardown value: not a module.
            (Some(i), true) => { self.desired[slot].remove(i); }
            (Some(i), false) => self.desired[slot][i].1 = module.to_string(),
            (None, false) => self.desired[slot]
                .push((component.to_string(), module.to_string())),
            (None, true) => {}
        }
        self.queue.push(LoadRequest {
            slot,
            component: component.to_string(),
            module: module.to_string(),
            state: None,
        });
    }

    /// Queue a module load into send bus `n`.
    ///
    /// Rides the shared `LoadQueue` under a slot number above every chain, so
    /// the one-load-per-audio-callback bound covers a send exactly as it covers
    /// a track — a set that opens with two sends and twelve chains must not
    /// stack fourteen blocking `dlopen`s into one callback.
    pub fn request_send_load(&mut self, bus: usize, module: &str) {
        if bus >= SEND_BUSES {
            return;
        }
        self.queue.push(LoadRequest {
            slot: send_index(bus),
            component: SEND_COMPONENT.to_string(),
            module: module.to_string(),
            state: None,
        });
    }

    /// Apply a module-preset blob to a send. Rides a pending load when there is
    /// one, for the same reason `set_state` does: the blob cannot be written
    /// before its module exists.
    pub fn set_send_state(&mut self, bus: usize, state: &str) {
        if bus >= SEND_BUSES {
            return;
        }
        if self.queue.attach_state(send_index(bus), SEND_COMPONENT, state) {
            return;
        }
        if let Some(inst) = self.send_slots[bus].as_mut() {
            inst.set_param(&format!("{SEND_COMPONENT}:state"), state);
        }
    }

    /* A bus holds ONE audio FX, so every key it is given belongs to the chain
     * host's `fx1` component. Translating here rather than at the caller is what
     * lets the UI address a bus and nothing else: the send's param page is an
     * ordinary module page whose component key happens to be `snd0`. */
    pub fn send_param(&mut self, bus: usize, key: &str, val: &str) {
        if bus >= SEND_BUSES {
            return;
        }
        if let Some(inst) = self.send_slots[bus].as_mut() {
            inst.set_param(&format!("{SEND_COMPONENT}:{key}"), val);
        }
    }

    pub fn send_get_param(&mut self, bus: usize, key: &str) -> Option<String> {
        let k = format!("{SEND_COMPONENT}:{key}");
        self.send_slots.get_mut(bus)?.as_mut()?.get_param(&k)
    }

    /// The module a bus has loaded.
    ///
    /// Its own accessor because the chain host publishes a loaded module under
    /// an UNDERSCORE alias (`fx1_module`), not the colon key it was set with.
    /// Reading back the key we wrote answers "absent", and the UI then draws a
    /// loaded send as "click jog to add".
    pub fn send_module(&mut self, bus: usize) -> Option<String> {
        let k = format!("{SEND_COMPONENT}_module");
        self.send_slots.get_mut(bus)?.as_mut()?.get_param(&k)
    }

    /// Whether any bus is holding audio a track fed it. The zero-cost claim
    /// (design §5) is about this staying false when nothing sends.
    pub fn sends_dirty(&self) -> bool {
        self.sends.any_dirty()
    }

    /// What each send bus's FX pass costs per block, and a fresh window after.
    pub fn send_cost_report(&mut self) -> String {
        let r = self.sends.cost_report();
        self.sends.cost_reset();
        r
    }

    /// What each send bus was fed and what came out of it, plus the module in
    /// it. The only read-back a device test has — see `SendBuses::report`.
    pub fn send_report(&mut self) -> String {
        let mut out = String::new();
        for bus in 0..SEND_BUSES {
            let module = self.send_module(bus).unwrap_or_default();
            out.push_str(&format!(" {}:mod={}", bus, if module.is_empty() { "-" } else { &module }));
        }
        /* `par` is the arm, `plan` is the partition it ran. Both, because a
         * fanned-out phase whose buses all landed on lane 0 is a serial phase
         * wearing the flag, and a measurement that read only `par` would call
         * it parallel. */
        let plan: Vec<String> = self
            .send_planner
            .lanes
            .iter()
            .map(|l| l.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(","))
            .collect();
        /* `colo` is the third arm, and it has to be reported for the same
         * reason `par` does: a bus riding a chain lane sounds exactly like one
         * in the send phase and reports the same cost. Without this, a run whose
         * co-location was silently refused — an unmeasured bus, a pinned feeder,
         * a group that would not fit — prints as a measurement of a path it
         * never took. `ran` is the per-block half: `colo` is what the planner
         * accepted, `ran` is what actually rendered on a lane this block. */
        let mut ran = 0u16;
        for n in 0..SEND_BUSES {
            if self.colo_ran[n] {
                ran |= 1 << n;
            }
        }
        format!(
            "{}{} par={} plan={} colo={:x} ran={:x}",
            self.sends.report(),
            out,
            u8::from(self.send_fanned),
            plan.join("|"),
            self.colocated_mask(),
            ran
        )
    }

    /// The chain set, as the document `set_chain_set` accepts.
    pub fn chain_set(&self) -> String {
        let mut entries = Vec::new();
        for (slot, comps) in self.desired.iter().enumerate() {
            for (component, module) in comps {
                entries.push(chain_doc::Entry {
                    slot,
                    component: component.clone(),
                    module: module.clone(),
                });
            }
        }
        chain_doc::encode(&entries)
    }

    /// Apply a whole chain set at once: unload what it does not name, queue what
    /// it does. `false` when the document is malformed, in which case NOTHING
    /// changes — a torn write decoding as "no chains" would unload the set.
    ///
    /// A component both sets want at the same module is left alone rather than
    /// cleared and reloaded: a teardown dlcloses and dlopens to arrive back
    /// where we started, and schwung's own note on that (`shadow_slot_clear_all_modules`)
    /// is that it has caused audio dropouts.
    pub fn set_chain_set(&mut self, doc: &str) -> bool {
        let Some(wanted) = chain_doc::decode(doc) else {
            return false;
        };
        /* A set document is a whole-set replace, and the mix belongs to the set
         * that named the chain. Left alone, the level you set in one Set went on
         * applying to whatever the next Set loaded into that chain. The restore
         * writes the saved mixes immediately after this, so the only slots that
         * stay at default are the ones the new set says nothing about. */
        for m in self.mixes.iter_mut() {
            *m = TrackMix::default();
        }
        /* And the lanes that drove them. A mix lane left over from the previous
         * Set would go on eating a CC the new Set's module is expecting. */
        for l in self.mix_lanes.iter_mut() {
            *l = [None; 8];
        }
        let mut gone: Vec<(usize, String)> = Vec::new();
        for (slot, comps) in self.desired.iter().enumerate() {
            for (component, _) in comps {
                if !wanted.iter().any(|w| w.slot == slot && &w.component == component) {
                    gone.push((slot, component.clone()));
                }
            }
        }
        for (slot, component) in gone {
            self.request_load(slot, &component, "");
        }
        for w in &wanted {
            let loaded = self
                .desired
                .get(w.slot)
                .and_then(|c| c.iter().find(|(c, _)| c == &w.component))
                .map(|(_, m)| m.as_str());
            if loaded == Some(w.module.as_str()) {
                continue;
            }
            self.request_load(w.slot, &w.component, &w.module);
        }
        true
    }

    /// What each chain actually HOLDS — `<slot>:<component>=<module>` per
    /// entry, with a trailing `?` on one that is still only a request.
    ///
    /// This is the only read-back a device test has for a movy-hosted chain.
    /// The remote-UI socket can WRITE an engine param but has no get verb, and
    /// the per-load line in `service_load` is not a substitute: a set that
    /// already holds the right module is deliberately left alone
    /// (`set_chain_set`), so it logs nothing at all and a second run against
    /// the same fixture would read as a failed load.
    ///
    /// The value comes off the live instance rather than out of `desired`,
    /// which is what makes it evidence — `desired` is what was asked for, and
    /// echoing the request back would confirm nothing. Diagnostic only: it
    /// allocates and queries every instance, so it belongs on the param write a
    /// test pokes and never on the render path.
    pub fn loaded_report(&mut self) -> String {
        let wanted: Vec<(usize, String, String)> = self
            .desired
            .iter()
            .enumerate()
            .flat_map(|(s, cs)| cs.iter().map(move |(c, m)| (s, c.clone(), m.clone())))
            .collect();
        let mut out = String::new();
        for (slot, component, module) in wanted {
            if !out.is_empty() {
                out.push(' ');
            }
            /* The underscore alias, which is the readable form for a track
             * component — the colon key is write-only (see module-slot.mjs). */
            match self
                .get_param(slot, &format!("{component}_module"))
                .filter(|v| !v.is_empty())
            {
                Some(live) => out.push_str(&format!("{slot}:{component}={live}")),
                None => out.push_str(&format!("{slot}:{component}={module}?")),
            }
        }
        if out.is_empty() {
            out.push('-');
        }
        out
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
            "asleep={} deep={} loaded={} sleeping=[{}]",
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
        /* Ahead of everything: `slots` holds MOVY_CHAINS entries, so a send's
         * synthetic slot number would index past the end of it. */
        if req.slot >= MOVY_CHAINS {
            self.service_send_load(req);
            return;
        }
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
            inst.set_external_fx_mode(inst.supports_split());
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

    /// Load one send bus's FX. The chain-slot path's shape, minus everything a
    /// bus does not have: no pin policy (a send is one instance, never a
    /// duplicate group), no idle wake (the bus's own tail rule decides that),
    /// and no synth.
    fn service_send_load(&mut self, req: LoadRequest) {
        let bus = req.slot - MOVY_CHAINS;
        if bus >= SEND_BUSES {
            return;
        }
        let Some(hostref) = self.host.as_ref() else { return };
        if self.send_slots[bus].is_none() {
            match hostref.create_instance(&self.module_dir) {
                Some(inst) => self.send_slots[bus] = Some(inst),
                None => return,
            }
        }
        /* Registered for the same reason a chain's module is: two buses holding
         * ONE module through one file share its whole `.data`, and the send
         * phase now renders them on different lanes. Without this the
         * blacklist — the containment for a module that turns out to race —
         * reaches every chain in the set and neither of the two sends. */
        self.pin.on_load(req.slot, &req.component, &req.module);
        /* Whatever the outgoing FX was still ringing belongs to the outgoing
         * FX. Without this its tail plays on through its replacement — and its
         * cost goes on being drawn as the incoming module's, which is the same
         * mistake one page further out. */
        self.sends.discard(bus);
        self.sends.ui_clear(bus);
        self.send_loaded[bus] = !req.module.is_empty();
        let t_set = std::time::Instant::now();
        if let Some(inst) = self.send_slots[bus].as_mut() {
            inst.set_param(&format!("{SEND_COMPONENT}:module"), &req.module);
            if let Some(state) = req.state.as_deref() {
                inst.set_param(&format!("{SEND_COMPONENT}:state"), state);
            }
            /* A send has no synth: `render_block` could only ever hand back
             * silence, and the FX has to run over the bus's own buffer. */
            inst.set_external_fx_mode(true);
            let continuous = inst.fx_requires_continuous();
            self.sends.set_continuous(bus, continuous);
        }
        self.generation = self.generation.wrapping_add(1);
        let set_ms = t_set.elapsed().as_millis();
        if set_ms >= 20 {
            host::log(&format!("send {}: load blocked {} ms", bus, set_ms));
        }
        host::log(&format!(
            "send {}: {}",
            bus,
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

    /// Bind one of a chain's eight automation lanes to a mixer field. The UI
    /// owns lane assignment; the engine only needs to know which lanes stop
    /// being CCs.
    pub fn set_mix_lane(&mut self, slot: usize, lane: u8, field: MixField) {
        if let Some(l) = self.mix_lanes.get_mut(slot).and_then(|m| m.get_mut(lane as usize)) {
            *l = Some(field);
        }
    }

    pub fn clear_mix_lane(&mut self, slot: usize, lane: u8) {
        if let Some(l) = self.mix_lanes.get_mut(slot).and_then(|m| m.get_mut(lane as usize)) {
            *l = None;
        }
    }

    /// Apply an automation value to a mix lane. Returns false when the lane is
    /// not one — the caller then sends the CC into the chain as usual, so an
    /// unmapped lane behaves exactly as it did before mix lanes existed.
    pub fn apply_mix_lane(&mut self, slot: usize, lane: u8, val: u8) -> bool {
        let Some(field) = self.mix_lanes.get(slot).and_then(|m| m.get(lane as usize)).copied().flatten()
        else {
            return false;
        };
        // Applied to a copy so the crossing can be seen: `note_feeder_change`
        // compares against what is still stored, and a field mutated in place
        // would leave nothing to compare with.
        if let Some(mix) = self.mixes.get(slot).copied() {
            let mut next = mix;
            field.apply(&mut next, val);
            self.note_feeder_change(slot, &next);
            self.mixes[slot] = next;
        }
        true
    }

    pub fn set_mix(&mut self, slot: usize, mix: TrackMix) {
        if slot < MOVY_CHAINS {
            self.idle.wake(slot);
            self.note_feeder_change(slot, &mix);
            self.mixes[slot] = mix;
        }
    }

    /// A send gain crossing zero changes WHO FEEDS WHAT, so the co-location
    /// plan built on the old answer is not merely unbalanced — it is unsafe.
    ///
    /// A bus is summed by the one lane that owns it. Let a track on another lane
    /// start feeding it under a stale plan and two threads write one buffer.
    /// So a crossing forces a replan before the next block rather than waiting
    /// out `REPLAN_BLOCKS`.
    ///
    /// Only a CROSSING. A send ridden from 0.3 to 0.4 by an automation lane
    /// changes a gain, not a feeder set, and must not replan every block — which
    /// is the whole reason this compares against zero instead of for equality.
    fn note_feeder_change(&mut self, slot: usize, next: &TrackMix) {
        let prev = &self.mixes[slot];
        for n in 0..SEND_BUSES {
            let was = prev.send_gains(n) != (0.0, 0.0);
            let now = next.send_gains(n) != (0.0, 0.0);
            if was != now {
                self.plan_dirty = true;
                return;
            }
        }
    }

    /// One chain's mix in the same shape `set_mix` accepts.
    ///
    /// Movy owns this state — no chain-host param carries it — so without a
    /// reader it was write-only: the volume gesture could not resume from the
    /// level it last set, and the set file had no way to record it.
    ///
    /// **The SHORTEST shape that carries the truth**, because this string is
    /// what lands in the set file. Trailing sends at zero are dropped down to
    /// the two-send width, so a set that never touched send 3 still opens on a
    /// build that has only two — where a six-field value would be refused whole
    /// and the track would come back at unity, unmuted, at a level nobody
    /// chose. Widths below two are never emitted: three fields is a shape only
    /// older builds wrote, and re-emitting it would buy nothing.
    pub fn mix_csv(&self, slot: usize) -> Option<String> {
        let m = self.mixes.get(slot)?;
        let mut n = m.send.len();
        while n > 2 && m.send[n - 1] == 0.0 {
            n -= 1;
        }
        let mut out = format!("{:.4},{:.4},{}", m.gain, m.pan, m.muted as u8);
        for s in &m.send[..n] {
            out.push_str(&format!(",{s:.4}"));
        }
        Some(out)
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
                Work { synth: true, fx: true }
            } else {
                self.idle.plan(i)
            };
        }
        // LFOs still have to advance for every chain whose synth did not render,
        // and on the audio thread rather than a lane — see `ChainInstance::mod_tick`.
        for i in 0..MOVY_CHAINS {
            if !self.work[i].synth {
                if let Some(inst) = self.slots[i].as_mut() {
                    inst.mod_tick();
                }
            }
        }

        /* Decided BEFORE anything renders, like `work` above and for the same
         * reason: the parallel path builds its whole task list up front, and a
         * bus that joined it later could not be given the taps that feed it.
         * Serial render has no lanes to co-locate onto, so the send phase keeps
         * every bus there. */
        self.colo_ran = [false; SEND_BUSES];
        if self.parallel_ready() {
            self.maybe_replan();
            self.arm_colocated();
        }
        let t0 = self.cost.start();
        let active = if self.parallel_ready() {
            self.render_parallel(frames)
        } else {
            self.render_serial(frames)
        };
        /* Held rather than reported: the CPU meter tracks a per-CALL maximum,
         * so the send phase has to arrive in the same `add_wall` as the render
         * it follows. Two calls would report two smaller peaks and a capacity
         * bar that never sees the real block. */
        let render_ns = t0.elapsed().as_nanos() as u64;
        // A chain that did no work this block cost nothing, and its mean has to
        // say so. Serial `continue`s past it and parallel skips it above, so
        // without this the mean simply freezes — see the fold in
        // `render_parallel` for what that was doing to the plan.
        for i in 0..MOVY_CHAINS {
            if self.slots[i].is_some() && self.work[i].none() {
                self.cost.add_ns(i, 0);
                self.cost.add_synth_ns(i, 0);
            }
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
            /* The same block, at the same gains, tapped into whichever buses
             * this track feeds — post-fader and post-pan by construction, not
             * by a second gain calculation that could drift from the mix's.
             * Two float compares for a track that sends nothing. */
            /* Skipping exactly the buses a lane already summed this chain
             * into. The mask is `colo_ran`, not `colo_bus`: a co-located bus
             * that did not arm this block built no task and no tap, so it takes
             * the ordinary path here and in the send phase. */
            let mut skip = 0u16;
            for n in 0..SEND_BUSES {
                if self.colo_ran[n] && self.colo_feeders[n] & (1 << i) != 0 {
                    skip |= 1 << n;
                }
            }
            self.sends.accumulate(scratch, &self.mixes[i], skip);
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
        /* After every chain has rendered AND mixed: a bus is a sum of tracks,
         * so it cannot exist until they are all in. Serial on the audio thread
         * by construction — there is no join left to hide behind (design §5). */
        let t_send = self.cost.start();
        let plan = self.sends.take_plan();
        let mut send_ran = false;
        for n in 0..SEND_BUSES {
            self.send_work[n] = false;
            /* Already rendered, on a lane, before the join. It still owes the
             * output its block — `finish` below — but processing it a second
             * time here would run the FX twice on one buffer. */
            if self.colo_ran[n] {
                continue;
            }
            if !plan[n] {
                continue;
            }
            if self.send_slots[n].is_none() {
                // Fed, but with nowhere to go. Dropped rather than left to ring
                // into the block after its module was removed.
                self.sends.discard(n);
                continue;
            }
            self.send_work[n] = true;
            send_ran = true;
        }
        /* A bus that skipped this block cost nothing, and the meter has to say
         * so — see `SendBuses::ui_idle`. Unconditional, exactly like the chain
         * loop above: a set gone entirely quiet is the case where a frozen mean
         * is most visibly wrong. */
        for n in 0..SEND_BUSES {
            if !self.send_work[n] && !self.colo_ran[n] {
                self.sends.ui_idle(n);
            }
        }
        /* Assigned even when the phase does not run, so `sndlog` cannot report
         * last block's fan-out as though it were this one's. Short-circuits
         * before `plan_sends` when nothing is running. */
        self.send_fanned = send_ran && self.parallel_ready() && self.plan_sends();
        if send_ran {
            if self.send_fanned {
                self.render_sends_parallel(frames);
            } else {
                self.render_sends_serial(frames);
            }
            // Same rule as the chain phase, one phase later: every lane is idle
            // again, so schwung sees one producer, and bus order makes the
            // emission deterministic.
            crate::midi_out::QUEUE.drain(crate::chain_host::send_direct);
        }
        /* Summed into the output AFTER the whole phase, in bus order — never in
         * the order the lanes happened to finish. That is what makes the
         * parallel result the same samples as the serial one rather than merely
         * the same samples somewhere.
         *
         * ONE loop over both paths, outside the `send_ran` branch: a co-located
         * bus is summed in the same place and the same order as one from the
         * phase, so which path a bus took cannot change the output. */
        let colo_ran_any = self.colo_ran.iter().any(|&r| r);
        for n in 0..SEND_BUSES {
            if self.send_work[n] || self.colo_ran[n] {
                self.sends.finish(n, &mut out[..frames], frames);
            }
        }
        let send_ns =
            if send_ran || colo_ran_any { t_send.elapsed().as_nanos() as u64 } else { 0 };
        self.close_block(render_ns, send_ns, active, send_ran);
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

    /// Which buses are riding a chain lane, for `sndlog`.
    pub fn colocated_mask(&self) -> u16 {
        let mut m = 0u16;
        for n in 0..SEND_BUSES {
            if self.colo_bus[n] {
                m |= 1 << n;
            }
        }
        m
    }

    /// Serial render is no longer a setting — it is the fallback for a pool
    /// that has not been spawned yet (nothing hosts chains) or that poisoned
    /// itself when a helper panicked. Deleting it would turn either into
    /// silence.
    fn parallel_ready(&self) -> bool {
        self.pool.as_ref().is_some_and(|p| !p.is_poisoned())
    }

    fn render_serial(&mut self, frames: usize) -> usize {
        let mut active = 0usize;
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
            // Before the peak scan, exactly as the pool does it — the two paths
            // have to mean the same thing, or the meter changes when a poisoned
            // pool drops the render back here.
            let synth_ns = if w.synth { t0.elapsed().as_nanos() as u64 } else { 0 };
            self.synth_peak[i] = self.scratch[i][..frames]
                .iter()
                .fold(0i32, |m, &s| m.max((s as i32).abs()));
            if w.fx {
                inst.process_fx(&mut self.scratch[i][..frames]);
            }
            drop(scope);
            self.cost.stop(t0, i);
            self.cost.add_synth_ns(i, synth_ns);
        }
        active
    }

    fn render_parallel(&mut self, frames: usize) -> usize {
        // Buffer pointers taken up front: a tap needs `&mut self.sends` while
        // the loop below holds `&mut self.scratch`, and both live in `self`.
        let mut bus_buf = [core::ptr::null_mut::<i16>(); SEND_BUSES];
        for n in 0..SEND_BUSES {
            if self.colo_ran[n] {
                bus_buf[n] = self.sends.buf_ptr(n);
            }
        }
        for l in self.lanes.iter_mut() {
            l.clear();
        }
        let mut active = 0usize;
        for lane in 0..self.planner.lanes.len() {
            for idx in 0..self.planner.lanes[lane].len() {
                let c = self.planner.lanes[lane][idx];
                /* A co-located bus, at the tail of the shared index space. The
                 * planner put it after its feeders on this same lane, so by the
                 * time the lane reaches it their audio is already summed into
                 * the buffer — which is the entire mechanism, and why this
                 * needs no synchronisation of its own. */
                if c >= MOVY_CHAINS {
                    let n = c - MOVY_CHAINS;
                    if !self.colo_ran[n] {
                        continue;
                    }
                    let Some((inst, _, Some(fx))) =
                        self.send_slots[n].as_mut().map(|s| s.raw_parts())
                    else {
                        // No `chain_process_fx`: the bus keeps its summed block
                        // and `finish` passes it through at unity, exactly as
                        // the send phase does for the same module.
                        continue;
                    };
                    self.lanes[lane].push(Task {
                        pre: Pre::Keep,
                        taps: NO_TAPS,
                        process_fx: Some(fx),
                        inst,
                        buf: self.sends.buf_ptr(n),
                        frames: (frames / 2) as i32,
                        chain: c,
                    });
                    continue;
                }
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
                /* Post-fader and post-pan by construction: the lane runs the
                 * tap after `process_fx`, at the same gains `mix_into` uses. */
                let mut taps = NO_TAPS;
                let mut t = 0usize;
                for n in 0..SEND_BUSES {
                    if !self.colo_ran[n] || self.colo_feeders[n] & (1 << c) == 0 {
                        continue;
                    }
                    let (gl, gr) = self.mixes[c].send_gains(n);
                    if gl == 0.0 && gr == 0.0 {
                        continue;
                    }
                    if t < MAX_TAPS {
                        taps[t] = Some(Tap { buf: bus_buf[n], gl, gr });
                        t += 1;
                    }
                }
                self.lanes[lane].push(Task {
                    pre: render.map_or(Pre::Silence, Pre::Render),
                    taps,
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
            //
            // Only for chains that HAD work: `cost_ns` is never cleared between
            // rounds and a deep-asleep chain builds no task at all, so folding
            // unconditionally re-added the cost the chain had while awake, every
            // block, for as long as it slept. Its mean never decayed and the
            // planner went on reserving a lane for a chain rendering nothing.
            for c in 0..MOVY_CHAINS {
                if self.slots[c].is_some() && !self.work[c].none() {
                    self.cost.add_ns(c, pool.cost_ns(c));
                    self.cost.add_synth_ns(c, pool.synth_ns(c));
                    self.synth_peak[c] = pool.synth_peak(c);
                }
            }
            /* A co-located bus is costed exactly like one in the send phase, so
             * the CPU page and `sndcostlog` read the same number wherever it
             * ran — and, more importantly, so does the planner that decided to
             * put it here. A bus whose cost stopped being measured the moment
             * it was co-located could never be re-evaluated. */
            for n in 0..SEND_BUSES {
                if self.colo_ran[n] {
                    self.sends.add_cost(n, pool.cost_ns(send_index(n)));
                    self.sends.note_colocated(n, pool.synth_peak(send_index(n)));
                }
            }
        }
        active
    }

    /// Partition the buses about to run, and say whether fanning them out is
    /// worth its wake.
    ///
    /// Planned EVERY block rather than on the chain phase's `REPLAN_BLOCKS`
    /// timer: which buses run is a per-block fact (a reverb tail ending retires
    /// one), there are at most `SEND_BUSES` of them, and a stale plan here does
    /// not merely cost balance — it would fan out for a bus that is no longer
    /// running, which is the one outcome the threshold exists to prevent.
    ///
    /// `pin_keys` is sliced from `MOVY_CHAINS` on: send buses live at the tail
    /// of the shared index space (`send_index`), so bus `n` is entry `n` of the
    /// slice and two buses holding one blacklisted module stay on one lane —
    /// the same containment a pair of chains gets.
    fn plan_sends(&mut self) -> bool {
        let costs = self.sends.plan_cost();
        self.send_planner.plan(&self.pin.pin_keys()[MOVY_CHAINS..], costs, &self.send_work);
        let serial: u64 =
            (0..SEND_BUSES).filter(|&n| self.send_work[n]).map(|n| costs[n]).sum();
        worth_fanning_out(serial, self.send_planner.makespan())
    }

    /// The send phase on the audio thread — one bus after another, exactly as
    /// the phase has always run.
    fn render_sends_serial(&mut self, frames: usize) {
        for n in 0..SEND_BUSES {
            if !self.send_work[n] {
                continue;
            }
            let t_bus = self.cost.start();
            // The same scope a lane takes, for the same reason the serial chain
            // path takes one: a module's MIDI must leave in the same order
            // whichever path ran it, or the ordering is something parallel
            // introduced.
            let scope = crate::midi_out::Scope::enter(send_index(n));
            if let Some(inst) = self.send_slots[n].as_mut() {
                inst.process_fx(&mut self.sends.buf_mut(n)[..frames]);
            }
            drop(scope);
            self.sends.add_cost(n, t_bus.elapsed().as_nanos() as u64);
        }
    }

    /// The send phase across the render pool.
    ///
    /// `Pre::Keep` is the whole difference from a chain task: the bus buffer
    /// already holds the sum every track fed it, and a lane that zeroed it would
    /// hand the FX 128 frames of silence.
    fn render_sends_parallel(&mut self, frames: usize) {
        for l in self.send_lanes.iter_mut() {
            l.clear();
        }
        for lane in 0..self.send_planner.lanes.len().min(self.send_lanes.len()) {
            for idx in 0..self.send_planner.lanes[lane].len() {
                let n = self.send_planner.lanes[lane][idx];
                if !self.send_work[n] {
                    continue;
                }
                let Some((inst, _, Some(fx))) = self.send_slots[n].as_mut().map(|s| s.raw_parts())
                else {
                    // A module with no `chain_process_fx` cannot process the bus
                    // at all. It keeps its accumulated block, which `finish`
                    // then passes through at unity — the same audio the serial
                    // path produced when `process_fx` found no symbol.
                    continue;
                };
                self.send_lanes[lane].push(Task {
                    pre: Pre::Keep,
                    taps: NO_TAPS,
                    process_fx: Some(fx),
                    inst,
                    buf: self.sends.buf_ptr(n),
                    frames: (frames / 2) as i32,
                    chain: send_index(n),
                });
            }
        }
        if let Some(pool) = self.pool.as_ref() {
            pool.render_block(&self.send_lanes);
            // Timed on whichever lane ran the bus, for the same reason a chain's
            // cost is: the audio thread cannot bracket a call it did not make.
            for n in 0..SEND_BUSES {
                if self.send_work[n] {
                    self.sends.add_cost(n, pool.cost_ns(send_index(n)));
                }
            }
        }
    }

    /// Partition the chains, then offer each bus a place beside its feeders and
    /// keep the offers that shorten the block.
    ///
    /// Greedy, in descending bus cost, and each acceptance is measured against
    /// the plan the previous acceptances produced — so every step strictly
    /// improves the predicted block and the result can never be worse than the
    /// chains-only partition it started from. At most `SEND_BUSES + 2` calls to
    /// `plan`, every `REPLAN_BLOCKS` blocks.
    ///
    /// Overlapping groups are refused rather than merged: once a chain carries
    /// a group key it is no longer free, so a second bus fed by the same track
    /// fails `group_is_free` and keeps the send phase. Merging them would be a
    /// bigger group with a longer lane, which is the thing the rule exists to
    /// avoid.
    fn plan_with_colocation(&mut self) {
        self.colo_bus = [false; SEND_BUSES];
        self.colo_feeders = [0; SEND_BUSES];
        let keys = self.pin.pin_keys();
        for i in 0..RENDER_SLOTS {
            // `clear` + `push_str` rather than a clone: assignment would drop
            // the preallocated buffer and allocate a new one every replan.
            self.colo_keys[i].clear();
            self.colo_keys[i].push_str(&keys[i]);
            self.colo_loaded[i] = if i < MOVY_CHAINS { self.loaded[i] } else { false };
            self.colo_cost[i] = if i < MOVY_CHAINS { self.cost.plan_ns()[i] } else { 0 };
        }
        self.planner.plan(&self.colo_keys, &self.colo_cost, &self.colo_loaded);
        let mut best = self.planner.makespan();
        let feeders = crate::chain_colo::feeders(&self.mixes, &self.loaded);

        // Heaviest bus first: it has the fewest lanes it can fit on, and a
        // lighter one accepted before it could take the only place it had.
        let costs = self.sends.plan_cost();
        let mut order = [0usize; SEND_BUSES];
        for (i, o) in order.iter_mut().enumerate() {
            *o = i;
        }
        order.sort_unstable_by(|&a, &b| costs[b].cmp(&costs[a]).then(a.cmp(&b)));

        for &n in order.iter() {
            let slot = send_index(n);
            let cost = self.sends.plan_cost()[n];
            /* Cost alone gates a bus here — an unloaded one has never rendered,
             * so its cost is zero and the bootstrap rule already refuses it.
             * Whether an INSTANCE exists is `arm_colocated`'s question, asked
             * per block, because that is what has to build a task out of it. */
            if cost == 0 || feeders[n] == 0 {
                continue;
            }
            if !crate::chain_colo::group_is_free(&self.colo_keys[slot], feeders[n], &self.colo_keys)
            {
                continue;
            }
            // The group tag. Written into the bus and every feeder, which is
            // all `render_plan` needs to keep them on one lane — and because
            // buses sit at the TAIL of the index space, the planner's
            // index-ordered push puts the bus after its feeders for free.
            for c in 0..MOVY_CHAINS {
                if feeders[n] & (1 << c) != 0 {
                    Self::write_tag(&mut self.colo_keys[c], n);
                }
            }
            Self::write_tag(&mut self.colo_keys[slot], n);
            self.colo_loaded[slot] = true;
            self.colo_cost[slot] = cost;
            self.planner.plan(&self.colo_keys, &self.colo_cost, &self.colo_loaded);
            if crate::chain_colo::worth_colocating(self.planner.makespan(), best, cost) {
                best = self.planner.makespan();
                self.colo_bus[n] = true;
                self.colo_feeders[n] = feeders[n];
            } else {
                // Undo. Every key in the group was empty — `group_is_free` said
                // so — so clearing restores exactly what was there.
                for c in 0..MOVY_CHAINS {
                    if feeders[n] & (1 << c) != 0 {
                        self.colo_keys[c].clear();
                    }
                }
                self.colo_keys[slot].clear();
                self.colo_loaded[slot] = false;
            }
        }
        // The loop leaves the planner holding whatever the last ATTEMPT built,
        // accepted or not. This is the plan that runs.
        self.planner.plan(&self.colo_keys, &self.colo_cost, &self.colo_loaded);
    }

    /// `colo/<n>`, written in place so the audio thread never allocates.
    fn write_tag(dst: &mut String, bus: usize) {
        dst.clear();
        dst.push_str("colo/");
        dst.push((b'0' + bus as u8) as char);
    }

    /// Which co-located buses run this block.
    ///
    /// `should_process`, read one phase earlier than `take_plan` reads it. That
    /// is exact rather than conservative: `dirty` means "a feeder rendered with
    /// a non-zero send gain", and both halves are already known here.
    fn arm_colocated(&mut self) {
        for n in 0..SEND_BUSES {
            self.colo_ran[n] = false;
            if !self.colo_bus[n] || self.send_slots[n].is_none() {
                continue;
            }
            let fed = (0..MOVY_CHAINS)
                .any(|c| self.colo_feeders[n] & (1 << c) != 0 && !self.work[c].none());
            if self.sends.should_run(n, fed) {
                self.colo_ran[n] = true;
            }
        }
    }

    /// Rebuild the lane assignment when the chain set changes, and periodically
    /// as measured costs settle. Allocation-free — see `render_plan::Planner`.
    fn maybe_replan(&mut self) {
        self.blocks_since_plan += 1;
        if !self.plan_dirty
            && self.plan_generation == self.generation
            && self.plan_idle_epoch == self.idle.epoch()
            && self.blocks_since_plan < REPLAN_BLOCKS
        {
            return;
        }
        self.plan_generation = self.generation;
        self.plan_idle_epoch = self.idle.epoch();
        self.blocks_since_plan = 0;
        self.plan_dirty = false;
        for (i, s) in self.slots.iter().enumerate() {
            // A deep-asleep chain is not work, and a partition that counts it
            // can put every SOUNDING chain on one lane.
            self.loaded[i] = s.is_some() && !self.idle.deep_asleep(i);
        }
        self.plan_with_colocation();
    }

    /// The CPU page's numbers as `status` fields, each with its leading space.
    ///
    /// MICROSECONDS, not nanoseconds: this goes out 24 times a second, four
    /// extra digits per chain buys nothing, and the page draws a 1000 us column
    /// in 39 pixels.
    ///
    /// Emitted unconditionally rather than behind an "the page is open" flag —
    /// that flag is a second copy of a fact the UI already owns, and it desyncs
    /// the moment an engine is re-dlopened under an open page.
    pub fn cost_status(&self) -> String {
        let mut s = String::with_capacity(288);
        s.push_str(" chcost=");
        for i in 0..MOVY_CHAINS {
            if i > 0 {
                s.push(',');
            }
            let (total, synth, peak) = self.cost.ui_costs(i);
            s.push_str(&format!("{}/{}/{}", total / 1000, synth / 1000, peak as u64 / 1000));
        }
        let (wall, wall_peak) = self.cost.ui_wall();
        let block_us =
            crate::ffi::MOVE_FRAMES_PER_BLOCK as u64 * 1_000_000 / host::sample_rate().max(1) as u64;
        s.push_str(&format!(
            " chwall={}/{}/{}",
            wall / 1000,
            wall_peak as u64 / 1000,
            block_us
        ));
        let mut loaded = 0u32;
        let mut asleep = 0u32;
        for i in 0..MOVY_CHAINS {
            if self.slots[i].is_some() {
                loaded |= 1 << i;
            }
            if self.idle.deep_asleep(i) {
                asleep |= 1 << i;
            }
        }
        s.push_str(&format!(" chmask={loaded:04x}/{asleep:04x}"));
        s.push_str(" sndcost=");
        for n in 0..SEND_BUSES {
            if n > 0 {
                s.push(',');
            }
            /* `-`, not `0/0`. "There is no module here" and "the module here is
             * costing nothing right now" are the two different answers a zero
             * column has, and the page draws them differently. Carried in this
             * field rather than a second mask, so a bus's occupancy and its cost
             * cannot arrive out of step. */
            if !self.send_loaded[n] {
                s.push('-');
                continue;
            }
            let (mean, peak) = self.sends.ui_costs(n);
            s.push_str(&format!("{}/{}", mean / 1000, peak / 1000));
        }
        s
    }

    /// Fold one block's timings into the CPU meter.
    ///
    /// ONE `add_wall` for the chain render AND the send phase, deliberately:
    /// the meter holds a per-CALL maximum, so two calls would report two smaller
    /// peaks and a capacity bar that never sees a whole block.
    ///
    /// And the gate is an `or`, not `active > 0`. A set whose only cost this
    /// block was a ringing reverb on a send still spent that time, and a meter
    /// that skipped it would read zero while the block was half full.
    ///
    /// Its own method so both rules are reachable from a test: `render` returns
    /// at the door on a host build, for want of a chain host.
    fn close_block(&mut self, render_ns: u64, send_ns: u64, active: usize, send_ran: bool) {
        if active == 0 && !send_ran {
            return;
        }
        self.cost.add_wall(render_ns + send_ns);
        self.cost.end_block();
    }

    /// Clear the meter's held peaks — the page's own reset, never `report()`.
    /// The send buses' peaks go with them: `cpurst` means one fresh observation
    /// of the whole page, not of the columns left of the gap.
    pub fn cost_ui_reset(&mut self) {
        self.cost.ui_reset();
        self.sends.ui_reset();
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
        for d in self.desired.iter_mut() {
            d.clear();
        }
        for i in 0..MOVY_CHAINS {
            self.slots[i] = None;
            self.idle.forget(i);
        }
        for a in self.audible.iter_mut() {
            *a = false;
        }
        self.pin.clear();
        for n in 0..SEND_BUSES {
            self.send_slots[n] = None;
            self.send_loaded[n] = false;
            self.sends.ui_clear(n);
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

    /* A mix param is not a chain-host param: `knob_find_param` resolves only
     * components inside the chain, so the CC the engine would emit for the lane
     * has nowhere to land. The lane has to write the mixer directly. */
    #[test]
    fn a_mix_lane_writes_the_mixer_not_the_chain() {
        let mut slots = ChainSlots::new();
        slots.set_mix_lane(4, 2, MixField::Pan);
        assert!(slots.apply_mix_lane(4, 2, 127), "lane 2 is a mix lane: consumed");
        assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,1.0000,0,0.0000,0.0000"));
        assert!(slots.apply_mix_lane(4, 2, 0));
        assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,-1.0000,0,0.0000,0.0000"),
                   "pan spans -1..+1, so 0 is hard left");
    }

    #[test]
    fn an_unmapped_lane_is_left_to_the_chain() {
        let mut slots = ChainSlots::new();
        assert!(!slots.apply_mix_lane(4, 0, 64), "no mapping: the CC must still be sent");
        assert!(!slots.apply_mix_lane(MOVY_CHAINS, 0, 64), "and an impossible chain never claims one");
    }

    #[test]
    fn a_gain_lane_spans_the_full_fader() {
        let mut slots = ChainSlots::new();
        slots.set_mix_lane(4, 0, MixField::Gain);
        slots.apply_mix_lane(4, 0, 127);
        let m = slots.mix_csv(4).unwrap();
        assert!(m.starts_with("4.0000,"), "127 is the top of the 0-4 fader, got {m}");
    }

    #[test]
    fn a_send_lane_spans_zero_to_unity() {
        let mut slots = ChainSlots::new();
        slots.set_mix_lane(4, 1, MixField::Send(1));
        slots.apply_mix_lane(4, 1, 127);
        assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,0.0000,0,0.0000,1.0000"));
    }

    #[test]
    fn clearing_a_mix_lane_returns_it_to_the_chain() {
        let mut slots = ChainSlots::new();
        slots.set_mix_lane(4, 3, MixField::Gain);
        slots.clear_mix_lane(4, 3);
        assert!(!slots.apply_mix_lane(4, 3, 64));
    }

    /* A lane that survives a module swap must not survive into a different
     * SET: the set document is a whole-set replace, and a stale mix lane would
     * eat a CC the new set's module is expecting. */
    #[test]
    fn a_new_set_document_clears_the_mix_lanes() {
        let mut slots = ChainSlots::new();
        slots.set_mix_lane(4, 0, MixField::Gain);
        assert!(slots.set_chain_set("0\n"));
        assert!(!slots.apply_mix_lane(4, 0, 64));
    }

    /* A send bus is not a chain. It rides the same load queue — so the
     * one-load-per-audio-callback bound covers it — under a slot number above
     * every track, because `ch<N>` IS track N and a collision there would load
     * a reverb into somebody's synth. */
    #[test]
    fn a_send_load_is_queued_above_every_chain() {
        let mut slots = ChainSlots::new();
        slots.request_send_load(0, "reverb");
        assert_eq!(slots.pending_loads(), 1, "a send load rides the shared queue");
        slots.request_send_load(1, "delay");
        assert_eq!(slots.pending_loads(), 2, "the two buses are separate requests");
    }

    #[test]
    fn a_send_bus_that_cannot_exist_is_refused() {
        let mut slots = ChainSlots::new();
        slots.request_send_load(SEND_BUSES, "reverb");
        assert_eq!(slots.pending_loads(), 0, "there are only two buses");
    }

    /* Every send accessor is reachable before a module has ever been loaded —
     * the UI reads a slot to decide whether to draw "click jog to add". */
    #[test]
    fn an_empty_send_answers_without_panicking() {
        let mut slots = ChainSlots::new();
        assert_eq!(slots.send_get_param(0, "fx1_module"), None);
        slots.send_param(0, "fx1:mix", "0.5");
        slots.set_send_state(0, "blob");
        assert!(!slots.sends_dirty());
    }

    /* The mix is movy's own state — no chain-host param carries it — so it was
     * write-only: `get_param` forwarded `mix` to the instance, which does not
     * know the key, and every reader fell back to unity. That is why the volume
     * gesture always restarted at 0 dB and why nothing could save the level. */
    #[test]
    fn the_mix_reads_back_what_was_set() {
        let mut slots = ChainSlots::new();
        assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,0.0000,0,0.0000,0.0000"),
                   "unity, centred, no sends by default");
        slots.set_mix(4, TrackMix { gain: 0.3162, pan: -0.5, muted: true,
                                    send: [0.25, 0.0, 0.0] });
        assert_eq!(slots.mix_csv(4).as_deref(), Some("0.3162,-0.5000,1,0.2500,0.0000"));
        assert_eq!(slots.mix_csv(5).as_deref(), Some("1.0000,0.0000,0,0.0000,0.0000"),
                   "one slot only");
        assert_eq!(slots.mix_csv(MOVY_CHAINS), None, "out of range");
    }

    /* A set document is a whole-set replace. Without this the level set in one
     * Set went on attenuating whatever the next Set loaded into that chain. */
    #[test]
    fn a_new_set_document_clears_the_mixes() {
        let mut slots = ChainSlots::new();
        slots.set_mix(4, TrackMix { gain: 0.1, ..TrackMix::default() });
        assert!(slots.set_chain_set("0\n"));
        assert_eq!(slots.mix_csv(4).as_deref(), Some("1.0000,0.0000,0,0.0000,0.0000"));
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

    /* The lane count is fixed at `LANES` now, so what has to hold is that
     * everything sized by it agrees. A plan with more lanes than the task-list
     * vector indexes out of range on the audio thread, and the send phase has a
     * second planner that would go unnoticed if it disagreed. */

    #[test]
    fn everything_sized_by_the_lane_count_agrees_on_it() {
        let slots = ChainSlots::new();
        assert_eq!(slots.planner.lane_count(), LANES);
        assert_eq!(slots.lanes.len(), LANES, "and so do the task lists it is copied into");
        assert_eq!(slots.send_planner.lane_count(), LANES, "the send phase plans the same lanes");
        assert_eq!(slots.send_lanes.len(), LANES);
        assert!(slots.render_report().contains(&format!("lanes={LANES}")));
    }

    /// Spawning blocks, so it may never happen on the audio thread — which is
    /// what `configure` being the only spawn site buys. Constructing the engine
    /// must therefore start no threads, and a chain host that fails to load
    /// must start none either: movy still sequences its host tracks without one.
    #[test]
    fn no_chain_host_means_no_helper_threads() {
        let mut slots = ChainSlots::new();
        assert!(slots.pool.is_none(), "constructing the engine spawned threads");
        slots.configure("/nonexistent", "/nonexistent/dsp.so");
        assert!(slots.host_failed);
        assert!(slots.pool.is_none(), "a failed chain host still spawned threads");
    }

    /* Pinning is containment, so the ways it can fail quietly matter more than
     * the ways it can fail loudly: a set that thinks it pinned a racing module
     * and did not sounds exactly like one that had nothing to pin. */

    /// The blacklist rewrites the planner's keys, so it needs the same
    /// replan — a module blacklisted mid-set must stop racing THIS block, not in
    /// `REPLAN_BLOCKS`.
    #[test]
    fn blacklisting_forces_a_replan_too() {
        let mut slots = ChainSlots::new();
        slots.plan_generation = slots.generation;
        slots.set_blacklist("helm");
        assert_eq!(slots.plan_generation, u32::MAX);
    }

    /// The blacklist is the only containment left, and a harness cannot infer
    /// it: a set with no duplicated module plans identically whatever the list
    /// holds, so a list that never arrived looks exactly like one with nothing
    /// to do.
    #[test]
    fn the_report_says_what_the_blacklist_holds() {
        let mut slots = ChainSlots::new();
        assert!(slots.render_report().contains("blocked=0"), "free is the default");
        slots.set_blacklist("helm,obxd");
        let r = slots.render_report();
        assert!(r.contains("blocked=2"), "the blacklist is reported: {r}");
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

    /* ── the chain set as a document ──────────────────────────────────────────
     * The set used to cross the wire as one unacknowledged write per component,
     * and a save read back whatever had survived — so a dropped write deleted a
     * module from the set file. `desired` is what was ASKED for, which is what
     * a save has to report. See plans/2026-08-29-chain-set-document.md. */

    #[test]
    fn the_set_reports_what_was_requested_not_what_has_loaded() {
        let mut slots = ChainSlots::new();
        slots.request_load(4, "synth", "noisemaker");
        assert_eq!(slots.pending_loads(), 1, "nothing has loaded yet");
        assert_eq!(
            chain_doc::decode(&slots.chain_set()),
            Some(vec![chain_doc::Entry { slot: 4, component: "synth".into(),
                                         module: "noisemaker".into() }]),
            "a queued load is already part of the set"
        );
    }

    /* `loaded_report` is a device test's only read-back for a movy chain, so
     * the one thing it must never do is echo the request as though it were
     * evidence: a fixture that "verified" against `desired` would pass while
     * every module failed to instantiate. There is no chain host on the host
     * build, so a queued load here is exactly that unloaded case. */
    #[test]
    fn the_loaded_report_marks_a_component_that_has_not_instantiated() {
        let mut slots = ChainSlots::new();
        assert_eq!(slots.loaded_report(), "-", "no chains, nothing to report");
        slots.request_load(4, "synth", "noisemaker");
        assert_eq!(
            slots.loaded_report(),
            "4:synth=noisemaker?",
            "a queued load is a request, not a loaded module"
        );
    }

    #[test]
    fn clearing_a_component_removes_it_from_the_set() {
        let mut slots = ChainSlots::new();
        slots.request_load(4, "synth", "noisemaker");
        slots.request_load(4, "synth", "");
        assert_eq!(chain_doc::decode(&slots.chain_set()), Some(vec![]));
    }

    #[test]
    fn a_document_queues_every_component_it_names() {
        let mut slots = ChainSlots::new();
        let doc = chain_doc::encode(&(0..MOVY_CHAINS)
            .map(|i| chain_doc::Entry { slot: i, component: "synth".into(),
                                        module: "noisemaker".into() })
            .collect::<Vec<_>>());
        assert!(slots.set_chain_set(&doc));
        assert_eq!(slots.pending_loads(), MOVY_CHAINS,
            "one message delivers the whole set");
        assert_eq!(slots.chain_set(), doc, "and the set reads back identically");
    }

    #[test]
    fn a_document_clears_what_it_does_not_name() {
        let mut slots = ChainSlots::new();
        slots.request_load(4, "synth", "noisemaker");
        slots.request_load(5, "synth", "plaits");
        assert!(slots.set_chain_set(&chain_doc::encode(&[chain_doc::Entry {
            slot: 5, component: "synth".into(), module: "plaits".into() }])));
        assert_eq!(
            chain_doc::decode(&slots.chain_set()),
            Some(vec![chain_doc::Entry { slot: 5, component: "synth".into(),
                                         module: "plaits".into() }]),
            "chain 4 is gone from the set"
        );
    }

    #[test]
    fn a_component_both_sets_want_is_left_alone() {
        /* A full teardown dlcloses and dlopens to arrive back where we started,
         * and schwung's own note on this is that it has caused audio dropouts. */
        let mut slots = ChainSlots::new();
        let doc = chain_doc::encode(&[chain_doc::Entry {
            slot: 4, component: "synth".into(), module: "noisemaker".into() }]);
        assert!(slots.set_chain_set(&doc));
        while slots.pending_loads() > 0 { slots.service_loads(); }
        assert!(slots.set_chain_set(&doc));
        assert_eq!(slots.pending_loads(), 0, "the same set queues no work");
    }

    #[test]
    fn a_replaced_module_is_queued_once_not_cleared_and_reloaded() {
        let mut slots = ChainSlots::new();
        slots.request_load(4, "synth", "noisemaker");
        while slots.pending_loads() > 0 { slots.service_loads(); }
        assert!(slots.set_chain_set(&chain_doc::encode(&[chain_doc::Entry {
            slot: 4, component: "synth".into(), module: "plaits".into() }])));
        assert_eq!(slots.pending_loads(), 1, "one load, not a clear plus a load");
    }

    #[test]
    fn a_malformed_document_changes_nothing() {
        /* The dangerous reading: a truncated write decoding as "no chains" and
         * unloading the user's set. */
        let mut slots = ChainSlots::new();
        slots.request_load(4, "synth", "noisemaker");
        let before = slots.chain_set();
        assert!(!slots.set_chain_set("3\n1\n4"), "a torn document is refused");
        assert_eq!(slots.chain_set(), before);
    }

    #[test]
    fn an_out_of_range_slot_never_enters_the_set() {
        let mut slots = ChainSlots::new();
        assert!(slots.set_chain_set(&chain_doc::encode(&[chain_doc::Entry {
            slot: MOVY_CHAINS, component: "synth".into(), module: "plaits".into() }])));
        assert_eq!(chain_doc::decode(&slots.chain_set()), Some(vec![]));
    }


    /* ── send-bus co-location ─────────────────────────────────────────────────
     * The planner half. `arm_colocated` and the tap building need a chain host
     * and are covered on device; the ORDERING and the accept/refuse rule are
     * the parts that can be wrong silently, and both are decided here.
     * See plans/2026-09-07-send-bus-colocation.md. */

    /// Load `n` chains at `ns` each, as a block of real rendering would.
    fn chains(slots: &mut ChainSlots, costs: &[u64]) {
        for (i, &ns) in costs.iter().enumerate() {
            slots.cost.add_ns(i, ns);
            slots.loaded[i] = true;
        }
    }

    /// The shape the measurement was taken in: a busy set with two light chains
    /// in it. Ten chains at 150 us and two at 40 us — the light ones are the
    /// feeders, as `plaits` at 41 us was on device.
    ///
    /// The shape MATTERS and a uniform set is the wrong fixture: with equal
    /// chains a static partition has no slack, so an indivisible group raises
    /// the makespan by exactly the bus's cost and co-location correctly refuses.
    /// Twelve equal chains would test the refusal, not the mechanism.
    fn busy_set(slots: &mut ChainSlots) {
        chains(slots, &[150_000; 10]);
        slots.cost.add_ns(10, 40_000);
        slots.cost.add_ns(11, 40_000);
        slots.loaded[10] = true;
        slots.loaded[11] = true;
    }

    /// Track `c` sends to bus `n`.
    fn sends_to(slots: &mut ChainSlots, c: usize, n: usize) {
        slots.mixes[c].send[n] = 1.0;
    }

    /// The lane holding a bus, and what is on it.
    fn lane_of(slots: &ChainSlots, bus: usize) -> Option<Vec<usize>> {
        slots
            .planner
            .lanes
            .iter()
            .find(|l| l.contains(&send_index(bus)))
            .map(|l| l.clone())
    }

    /// The safety property, and the whole mechanism in one assertion: a bus must
    /// share a lane with every track feeding it, and must come AFTER them.
    ///
    /// Before it, the FX processes a partial sum — silent, and audible only as a
    /// send that is quietly missing a track. On another lane it is a data race
    /// on the bus buffer.
    #[test]
    fn a_bus_lands_behind_every_chain_that_feeds_it() {
        let mut slots = ChainSlots::new();
        busy_set(&mut slots);
        sends_to(&mut slots, 10, 0);
        sends_to(&mut slots, 11, 0);
        cost(&mut slots, 0, 200_000);
        slots.plan_with_colocation();

        let lane = lane_of(&slots, 0).expect("the bus was not co-located at all");
        let bus_at = lane.iter().position(|&x| x == send_index(0)).unwrap();
        for feeder in [10usize, 11] {
            let at = lane
                .iter()
                .position(|&x| x == feeder)
                .unwrap_or_else(|| panic!("feeder {feeder} is on another lane: {lane:?}"));
            assert!(at < bus_at, "feeder {feeder} renders after its bus: {lane:?}");
        }
    }

    /// The refusal case is a SPARSE set, not a heavy bus.
    ///
    /// One chain feeding one bus: the other lanes have nothing to run
    /// underneath it, so the group IS the block either way and the plan buys
    /// nothing. This is the fixture `measure-send-cost.sh` uses — one synth at
    /// ~36 us — and it is why that fixture could not have measured this change.
    #[test]
    fn a_bus_with_nothing_to_overlap_keeps_the_send_phase() {
        let mut slots = ChainSlots::new();
        chains(&mut slots, &[40_000]);
        sends_to(&mut slots, 0, 0);
        cost(&mut slots, 0, 2_000_000);
        slots.plan_with_colocation();
        assert_eq!(slots.colocated_mask(), 0, "a lone chain has nothing to hide a bus behind");
    }

    /// A bus far heavier than the whole partition is still taken, as long as the
    /// other lanes have work to run underneath it — a 2 ms bus beside 600 us of
    /// chains costs 2040 us co-located against 2600 us serial.
    ///
    /// Worth pinning because it is the counter-intuitive half: the rule is not
    /// "is the bus small enough to hide", it is "does the BLOCK get shorter".
    /// A guard written on the first reading would refuse the biggest saving
    /// available and look conservative doing it.
    #[test]
    fn a_bus_heavier_than_the_partition_is_still_taken() {
        let mut slots = ChainSlots::new();
        busy_set(&mut slots);
        sends_to(&mut slots, 10, 0);
        cost(&mut slots, 0, 2_000_000);
        slots.plan_with_colocation();
        assert_eq!(slots.colocated_mask(), 1, "600 us of chains can run under a 2 ms bus");
    }

    /// Before a bus has rendered its cost is zero, and a partition built on a
    /// guess is one nobody priced. It bootstraps instead: the send phase runs
    /// it, the cost settles, and the next replan can see it.
    #[test]
    fn an_unmeasured_bus_is_not_colocated() {
        let mut slots = ChainSlots::new();
        busy_set(&mut slots);
        sends_to(&mut slots, 10, 0);
        slots.plan_with_colocation();
        assert_eq!(slots.colocated_mask(), 0, "a bus that has never rendered was planned for");
    }

    /// A pinned feeder disqualifies its bus. Honouring both constraints would
    /// mean merging groups transitively; declining leaves the bus exactly where
    /// a pinned set has it today. See `chain_colo::group_is_free`.
    #[test]
    fn a_pinned_feeder_keeps_its_bus_in_the_send_phase() {
        let mut slots = ChainSlots::new();
        busy_set(&mut slots);
        sends_to(&mut slots, 10, 0);
        cost(&mut slots, 0, 200_000);
        slots.pin.set_key_for_test(10, "sound_generators/helm");
        slots.plan_with_colocation();
        assert_eq!(slots.colocated_mask(), 0);
    }

    /// Two buses fed by one track cannot both claim it. The second is refused
    /// rather than merged into the first's group — merging makes one longer lane,
    /// which is the outcome the rule exists to avoid.
    #[test]
    fn two_buses_cannot_both_claim_one_feeder() {
        let mut slots = ChainSlots::new();
        busy_set(&mut slots);
        sends_to(&mut slots, 10, 0);
        sends_to(&mut slots, 10, 1);
        cost(&mut slots, 0, 200_000);
        cost(&mut slots, 1, 150_000);
        slots.plan_with_colocation();
        assert_eq!(
            slots.colocated_mask().count_ones(),
            1,
            "both buses took the same feeder: {:x}",
            slots.colocated_mask()
        );
        assert_eq!(slots.colocated_mask(), 1, "the heavier bus is offered the lane first");
    }

    /// Two buses fed by DIFFERENT tracks are independent groups and both get a
    /// lane. Only a SHARED feeder forces a choice — see the test above.
    ///
    /// Worth its own test because the refusal above is easy to over-apply: a
    /// rule that declined "a second bus" rather than "a second claim on one
    /// track" would silently halve the feature for anyone using two sends,
    /// which is the ordinary way to use them.
    #[test]
    fn two_buses_on_separate_feeders_both_get_a_lane() {
        let mut slots = ChainSlots::new();
        busy_set(&mut slots);
        sends_to(&mut slots, 10, 0);
        sends_to(&mut slots, 11, 1);
        cost(&mut slots, 0, 200_000);
        cost(&mut slots, 1, 150_000);
        slots.plan_with_colocation();
        assert_eq!(slots.colocated_mask(), 0b11, "both buses must be co-located");
        for bus in 0..2 {
            let lane = lane_of(&slots, bus).unwrap();
            let at = lane.iter().position(|&x| x == send_index(bus)).unwrap();
            let feeder = 10 + bus;
            let f = lane
                .iter()
                .position(|&x| x == feeder)
                .unwrap_or_else(|| panic!("bus {bus} left its feeder behind: {lane:?}"));
            assert!(f < at, "bus {bus} renders before its feeder: {lane:?}");
        }
    }

    /* The replan trigger. A feeder appearing on another lane under a stale plan
     * is two threads writing one bus buffer, so this is a correctness rule and
     * not a balance one. */

    #[test]
    fn a_send_gain_crossing_zero_forces_a_replan() {
        let mut slots = ChainSlots::new();
        let mut m = TrackMix::default();
        m.send[0] = 0.4;
        slots.set_mix(2, m);
        assert!(slots.plan_dirty, "a track began feeding a bus and the plan did not know");
    }

    /// The other half, and the reason this compares against zero rather than for
    /// equality: an automation lane rides a send every block, and a replan on
    /// every one of them would churn the partition for nothing.
    #[test]
    fn riding_a_send_does_not_force_a_replan() {
        let mut slots = ChainSlots::new();
        let mut m = TrackMix::default();
        m.send[0] = 0.3;
        slots.set_mix(2, m);
        slots.plan_dirty = false;
        m.send[0] = 0.4;
        slots.set_mix(2, m);
        assert!(!slots.plan_dirty, "a gain change is not a feeder change");
        m.send[0] = 0.0;
        slots.set_mix(2, m);
        assert!(slots.plan_dirty, "but turning it off is");
    }

    /* The send phase's fan-out decision. `render` itself is unreachable on a
     * host build — it returns before the phase when there is no chain host, the
     * same reason `send_bus.rs` asserts the zero-cost rule in its own file — but
     * `plan_sends` is the whole decision and needs nothing loaded. */

    /// Seed a bus's measured cost, as a block of real rendering would.
    fn cost(slots: &mut ChainSlots, bus: usize, ns: u64) {
        slots.sends.add_cost(bus, ns);
    }

    /// Exactly these buses are running this block; every other one is retired.
    /// Sized from `SEND_BUSES` rather than written out, so adding a bus does not
    /// silently shorten the slice these tests hand the planner.
    fn running(slots: &mut ChainSlots, buses: &[usize]) {
        slots.send_work = vec![false; SEND_BUSES];
        for &b in buses {
            slots.send_work[b] = true;
        }
    }

    /* What the CPU page's capacity bar is over. `render` cannot be driven on a
     * host build, so the rule lives in `close_block` and is asserted there. */

    #[test]
    fn the_capacity_bar_counts_the_send_phase() {
        let mut slots = ChainSlots::new();
        slots.close_block(400_000, 150_000, 2, true);
        assert_eq!(slots.cost.ui_wall().0, 550_000, "the send phase is missing from the wall");
    }

    /// One call, not two: the meter holds a per-CALL maximum, so splitting the
    /// block in half reports two smaller peaks and a bar that never sees a whole
    /// one.
    #[test]
    fn a_block_reaches_the_peak_whole() {
        let mut slots = ChainSlots::new();
        slots.close_block(400_000, 150_000, 2, true);
        assert_eq!(slots.cost.ui_wall().1, 550_000);
    }

    /// A set with no movy instrument but a ringing reverb on a send still spent
    /// the time. Gated on `active > 0` alone, the meter reads zero on a block
    /// that was half full.
    #[test]
    fn a_send_only_block_still_reaches_the_meter() {
        let mut slots = ChainSlots::new();
        slots.close_block(0, 150_000, 0, true);
        assert_eq!(slots.cost.ui_wall(), (150_000, 150_000));
    }

    /// And a block where nothing at all ran is not a block. Counted, it would
    /// drag the mean towards zero for every silent block between notes.
    #[test]
    fn an_empty_block_is_not_counted() {
        let mut slots = ChainSlots::new();
        slots.close_block(0, 0, 0, false);
        assert_eq!(slots.cost.ui_wall(), (0, 0));
    }

    /// THE no-regression claim. One bus overlaps with nothing, so a fan-out can
    /// only add a wake and a wait — and "is the send phase busy?" is not the
    /// question, because a single tape-echo is as busy as a phase gets.
    #[test]
    fn one_running_bus_is_never_fanned_out() {
        let mut slots = ChainSlots::new();
        cost(&mut slots, 0, 353_600);
        running(&mut slots, &[0]);
        assert!(!slots.plan_sends(), "a lone bus was fanned out");
    }

    /// And neither is none of them — the phase does not even reach here, but a
    /// planner asked to partition nothing must not answer "worth it".
    #[test]
    fn no_running_bus_is_never_fanned_out() {
        let mut slots = ChainSlots::new();
        running(&mut slots, &[]);
        assert!(!slots.plan_sends());
    }

    /// The case the phase exists for: two heavy reverbs, 584 us serial, split
    /// onto separate lanes for a 354 us makespan.
    #[test]
    fn two_heavy_buses_are_split_across_lanes() {
        let mut slots = ChainSlots::new();
        cost(&mut slots, 0, 230_800); // dragonfly-hall
        cost(&mut slots, 1, 353_600); // tape-echo2
        running(&mut slots, &[0, 1]);
        assert!(slots.plan_sends(), "584 us serial was not worth a 21 us wake");
        let lane_of = |b: usize| {
            slots.send_planner.lanes.iter().position(|l| l.contains(&b)).expect("unplanned bus")
        };
        assert_ne!(lane_of(0), lane_of(1), "{:?}", slots.send_planner.lanes);
    }

    /// Three heavy buses are the loadout the third send was added FOR: 938 us
    /// serial, and one lane each brings the makespan down to the slowest of
    /// them.
    ///
    /// The makespan and not just the lane assignment, because that is what the
    /// saving is made of: with `DEFAULT_LANES` at 2 the planner still returns a
    /// valid partition — two buses on one lane — and every "each bus got a
    /// lane" assertion would pass while the phase ran 584 us instead of 354.
    #[test]
    fn three_heavy_buses_each_get_a_lane() {
        let mut slots = ChainSlots::new();
        cost(&mut slots, 0, 230_800); // dragonfly-hall
        cost(&mut slots, 1, 353_600); // tape-echo2
        cost(&mut slots, 2, 353_600); // tape-echo2
        running(&mut slots, &[0, 1, 2]);
        assert!(slots.plan_sends(), "938 us serial was not worth a wake");
        assert_eq!(slots.send_planner.makespan(), 353_600,
                   "two buses shared a lane: {:?}", slots.send_planner.lanes);
        let lane_of = |b: usize| {
            slots.send_planner.lanes.iter().position(|l| l.contains(&b)).expect("unplanned bus")
        };
        let (a, b, c) = (lane_of(0), lane_of(1), lane_of(2));
        assert!(a != b && b != c && a != c, "{:?}", slots.send_planner.lanes);
    }

    /// Every per-bus array a fresh `ChainSlots` holds is `SEND_BUSES` wide.
    ///
    /// The planning tests set `send_work` themselves, so none of them would
    /// notice a field left at the old width — and the failure it hides is not
    /// the loud kind everywhere: `plan_sends` panics on a short `send_work`,
    /// but a short cost slice would simply price the new bus at zero forever
    /// and the planner would keep stacking it onto whichever lane looked idle.
    #[test]
    fn every_per_bus_array_is_as_wide_as_the_bus_count() {
        let mut slots = ChainSlots::new();
        assert_eq!(slots.send_work.len(), SEND_BUSES, "send_work");
        assert_eq!(slots.sends.plan_cost().len(), SEND_BUSES, "plan_cost");
        assert_eq!(slots.send_slots.len(), SEND_BUSES, "send_slots");
        /* And the shared index space reaches the last bus: `pin_keys` is sliced
         * from `MOVY_CHAINS` on, so a policy still sized to the chains alone
         * would panic here rather than quietly skip the containment. */
        assert_eq!(slots.pin.pin_keys().len(), MOVY_CHAINS + SEND_BUSES, "pin keys");
        running(&mut slots, &[SEND_BUSES - 1]);
        slots.plan_sends();
    }

    /// A bus that is not running this block must get no task. It is the tail
    /// rule that retires one — a reverb whose input stopped and whose tail has
    /// decayed — so this happens in the middle of ordinary playing, not only at
    /// the edges.
    #[test]
    fn a_bus_that_is_not_running_is_given_no_lane() {
        let mut slots = ChainSlots::new();
        cost(&mut slots, 0, 353_600);
        cost(&mut slots, 1, 353_600);
        running(&mut slots, &[0]);
        slots.plan_sends();
        assert!(
            slots.send_planner.lanes.iter().all(|l| !l.contains(&1)),
            "a retired bus was planned: {:?}",
            slots.send_planner.lanes
        );
    }

    /* The safety claim. Two buses holding ONE module share its whole `.data`,
     * and the send phase renders them on different lanes — the same hazard
     * `chain_pin` contains for chains, which had no reach into the sends at all
     * until they entered its index space.
     *
     * The keys are sliced from `MOVY_CHAINS` on, so this also pins the offset:
     * read from 0 instead, the planner would be handed CHAIN 0 and 1's keys and
     * silently split a pinned pair. */
    #[test]
    fn two_sends_holding_one_module_can_be_pinned_onto_one_lane() {
        let mut slots = ChainSlots::new();
        slots.set_blacklist("mverb");
        slots.pin.on_load(send_index(0), SEND_COMPONENT, "mverb");
        slots.pin.on_load(send_index(1), SEND_COMPONENT, "mverb");
        cost(&mut slots, 0, 353_600);
        cost(&mut slots, 1, 353_600);
        running(&mut slots, &[0, 1]);

        assert!(!slots.plan_sends(), "a pinned pair has nothing to overlap");
        let with = |b: usize| slots.send_planner.lanes.iter().filter(|l| l.contains(&b)).count();
        assert_eq!(with(0), 1);
        let together = slots
            .send_planner
            .lanes
            .iter()
            .any(|l| l.contains(&0) && l.contains(&1));
        assert!(together, "pinned sends were split: {:?}", slots.send_planner.lanes);
    }

    /// Chains must not be pinned to sends. They are one index space now, but
    /// two phases: the send phase runs after the chain join, so no chain and no
    /// bus is ever in flight at the same time and a shared module between them
    /// costs a lane for nothing.
    #[test]
    fn a_chain_and_a_send_sharing_a_module_still_use_every_lane() {
        let mut slots = ChainSlots::new();
        slots.set_blacklist("mverb");
        slots.pin.on_load(0, "fx1", "mverb");
        slots.pin.on_load(send_index(0), SEND_COMPONENT, "mverb");
        cost(&mut slots, 0, 230_800);
        cost(&mut slots, 1, 353_600);
        running(&mut slots, &[0, 1]);
        assert!(slots.plan_sends());
        let lane_of = |b: usize| {
            slots.send_planner.lanes.iter().position(|l| l.contains(&b)).expect("unplanned bus")
        };
        assert_ne!(lane_of(0), lane_of(1), "a chain pinned the sends together");
    }

    #[test]
    fn teardown_forgets_the_set() {
        let mut slots = ChainSlots::new();
        slots.request_load(4, "synth", "noisemaker");
        slots.teardown();
        assert_eq!(chain_doc::decode(&slots.chain_set()), Some(vec![]));
    }

}
