//! The send buses movy sums its tracks into.
//!
//! A send bus is `chain_process_fx` (`chain_host.c:2176`) run over a buffer
//! every track has already contributed to — so it cannot share a render lane
//! with the chains: it depends on every one of them having rendered, and runs
//! after the join (design §5). The buses can be fanned out across each other,
//! and are, when the arithmetic says a wake pays for itself — see
//! `ChainSlots::plan_sends`.
//!
//! **Costing nothing when no send is in use is a commitment, not a property
//! that falls out.** Three early-outs, one test each: a bus with no instance is
//! never processed, a track at zero send never touches a buffer, and a bus
//! nothing wrote is never cleared. Get them wrong and a feature nobody switched
//! on costs a memset per bus and sixteen chains of multiply-adds every block.
//!
//! Free of chain, host and FFI types, exactly as `chain_idle` is: every rule
//! here is decided by counting peaks and flags, so the audio-thread code that
//! obeys it stays a straight read of this file.

use crate::chain_idle::SILENCE_LEVEL;
use crate::mixer::{mix_into_gains, TrackMix};

pub const SEND_BUSES: usize = 3;

/// 128 frames stereo — schwung's block size, the same as a chain's scratch.
/// Preallocated: nothing may allocate on the audio thread.
const BUS_SAMPLES: usize = 128 * 2;

/// Whether a bus owes its FX a call this block.
///
/// `dirty` — a track fed it. `last_peak` — what it output last block, which is
/// how a reverb tail keeps ringing after its input stops. `continuous` — the FX
/// declared `requires_continuous_processing`, so skipping a block corrupts its
/// state rather than merely silencing it.
pub fn should_process(dirty: bool, last_peak: i32, continuous: bool) -> bool {
    dirty || continuous || last_peak > SILENCE_LEVEL
}

struct Bus {
    buf: Vec<i16>,
    /// Something was accumulated into `buf` this block.
    dirty: bool,
    /// Output peak of the last block this bus processed.
    last_peak: i32,
    continuous: bool,
    /// What the tracks fed it, measured before the FX ran. Diagnostic only —
    /// without it a silent return is indistinguishable from a bus nothing sent
    /// to, which are opposite bugs with the same symptom.
    in_peak: i32,
    /// Blocks this bus has processed. Never reset: a device test needs to see
    /// that the FX pass ran at all.
    processed: u32,
    /// 1/16 exponential mean of what this bus's FX pass costs, in ns. The same
    /// estimator `CostMeter` uses for a chain, and for the same reason: a
    /// note-on's one expensive block must not dominate the answer.
    cost_ns: u64,
    /// Worst single block, so a mean that hides a spike can be seen to.
    max_ns: u64,
    /// The CPU page's own pair, in nanoseconds.
    ///
    /// Deliberately NOT `cost_ns` / `max_ns`: reading `sndcostlog` closes that
    /// window, and a device script closes it whenever it likes. A peak the user
    /// is looking at must not disappear because someone read a log, so these
    /// live on the page's reset schedule (`ui_reset`, driven by `cpurst`) —
    /// the same split `CostMeter` keeps, for the same reason.
    ui_ns: u64,
    ui_max_ns: u64,
}

pub struct SendBuses {
    buses: Vec<Bus>,
    /// The same 1/16 mean as `cost_ns`, kept apart because `cost_reset` must not
    /// touch it: the lane planner reads this every block, and a `sndcostlog`
    /// taken mid-set would otherwise tell the planner every bus is free.
    ///
    /// A `Vec` beside the buses rather than a field inside one, because the
    /// planner wants it as a contiguous slice.
    plan_ns: Vec<u64>,
}

impl SendBuses {
    pub fn new() -> Self {
        Self {
            plan_ns: vec![0; SEND_BUSES],
            buses: (0..SEND_BUSES)
                .map(|_| Bus {
                    buf: vec![0i16; BUS_SAMPLES],
                    dirty: false,
                    last_peak: 0,
                    continuous: false,
                    in_peak: 0,
                    processed: 0,
                    cost_ns: 0,
                    max_ns: 0,
                    ui_ns: 0,
                    ui_max_ns: 0,
                })
                .collect(),
        }
    }

    /// Tap one chain's rendered block into every bus it feeds.
    pub fn accumulate(&mut self, src: &[i16], mix: &TrackMix) {
        for (n, bus) in self.buses.iter_mut().enumerate() {
            let (gl, gr) = mix.send_gains(n);
            if gl == 0.0 && gr == 0.0 {
                continue; // zero send: the buffer is not even touched
            }
            let len = bus.buf.len().min(src.len());
            mix_into_gains(&mut bus.buf[..len], &src[..len], gl, gr);
            bus.dirty = true;
            let peak = bus.buf[..len].iter().fold(0i32, |m, &s| m.max((s as i32).abs()));
            bus.in_peak = peak;
        }
    }

    /// Decide, once, which buses run this block — so the accumulate phase and
    /// the process phase cannot answer the question differently.
    pub fn take_plan(&mut self) -> [bool; SEND_BUSES] {
        let mut plan = [false; SEND_BUSES];
        for (n, bus) in self.buses.iter_mut().enumerate() {
            plan[n] = should_process(bus.dirty, bus.last_peak, bus.continuous);
            /* The input peak is about THIS block. Left sticky it reads as a
             * track still feeding a bus whose send was turned down minutes ago
             * — which is the one thing the diagnostic exists to rule out. */
            if !bus.dirty {
                bus.in_peak = 0;
            }
        }
        plan
    }

    /// The buffer the FX pass writes over.
    pub fn buf_mut(&mut self, n: usize) -> &mut [i16] {
        &mut self.buses[n].buf
    }

    /// Sum a processed bus into the output at unity, remember its peak for the
    /// tail rule, and zero it. Never called for a bus `take_plan` said no to,
    /// which is what keeps an unused bus free of a memset.
    pub fn finish(&mut self, n: usize, out: &mut [i16], frames: usize) {
        let bus = &mut self.buses[n];
        let len = bus.buf.len().min(frames);
        bus.last_peak = bus.buf[..len].iter().fold(0i32, |m, &s| m.max((s as i32).abs()));
        bus.processed = bus.processed.wrapping_add(1);
        let out_len = len.min(out.len());
        mix_into_gains(&mut out[..out_len], &bus.buf[..out_len], 1.0, 1.0);
        bus.buf[..len].fill(0);
        bus.dirty = false;
    }

    /// What this bus's FX pass just cost. Recorded by the caller because the
    /// FFI call it times lives there — this file stays free of chain types.
    pub fn add_cost(&mut self, n: usize, dt: u64) {
        let Some(b) = self.buses.get_mut(n) else { return };
        b.cost_ns = if b.cost_ns == 0 { dt } else { b.cost_ns - b.cost_ns / 16 + dt / 16 };
        if dt > b.max_ns {
            b.max_ns = dt;
        }
        b.ui_ns = if b.ui_ns == 0 { dt } else { b.ui_ns - b.ui_ns / 16 + dt / 16 };
        if dt > b.ui_max_ns {
            b.ui_max_ns = dt;
        }
        let p = &mut self.plan_ns[n];
        *p = if *p == 0 { dt } else { *p - *p / 16 + dt / 16 };
    }

    /// What the lane planner partitions by — see `plan_ns`.
    pub fn plan_cost(&self) -> &[u64] {
        &self.plan_ns
    }

    /// A block this bus did not process, for the CPU page's mean only.
    ///
    /// Without it the mean simply FREEZES when a bus goes quiet — fed only on
    /// the blocks that ran, it goes on reporting the cost of a pass that is no
    /// longer happening, and the page draws a column for work nobody is doing.
    /// The chain phase applies the same rule (`ChainSlots::render`).
    ///
    /// `plan_ns` is deliberately left out of it. The planner partitions by what
    /// a RUNNING bus costs and only ever looks at buses that are running, so a
    /// decayed-to-zero estimate would buy nothing and mis-plan the block a bus
    /// wakes on.
    pub fn ui_idle(&mut self, n: usize) {
        let Some(b) = self.buses.get_mut(n) else { return };
        b.ui_ns -= b.ui_ns / 16;
    }

    /// `(mean, held peak)` in nanoseconds — the two numbers a column draws.
    pub fn ui_costs(&self, n: usize) -> (u64, u64) {
        self.buses.get(n).map_or((0, 0), |b| (b.ui_ns, b.ui_max_ns))
    }

    /// Clear the held peaks. The means are left alone — they settle in a couple
    /// of hundred blocks, and blanking them would open the page on zeros.
    pub fn ui_reset(&mut self) {
        for b in self.buses.iter_mut() {
            b.ui_max_ns = 0;
        }
    }

    /// Forget one bus's page numbers outright — its FX has been replaced, and
    /// both of them describe the module that left.
    pub fn ui_clear(&mut self, n: usize) {
        let Some(b) = self.buses.get_mut(n) else { return };
        b.ui_ns = 0;
        b.ui_max_ns = 0;
    }

    /// The bus's buffer as a raw pointer, for a `Task` the pool may run on
    /// another lane. Two buses are two independent allocations, so handing out
    /// one pointer each is the same disjointness argument the chain scratches
    /// rest on — `&mut` cannot express it because the phase needs both at once.
    pub fn buf_ptr(&mut self, n: usize) -> *mut i16 {
        self.buses[n].buf.as_mut_ptr()
    }

    /// Per-bus mean and worst-block cost in microseconds: `0:us=312.0,max=980.0`.
    /// Answers the two questions a serial send phase raises — whether a second
    /// bus is worth a rendezvous (~21us of scheduler wake), and what a third
    /// and fourth would add to the critical path.
    pub fn cost_report(&self) -> String {
        let mut out = String::new();
        for (n, b) in self.buses.iter().enumerate() {
            if n > 0 {
                out.push(' ');
            }
            out.push_str(&format!("{}:us={:.1},max={:.1}", n, b.cost_ns as f64 / 1000.0,
                                  b.max_ns as f64 / 1000.0));
        }
        out
    }

    /// Start a fresh cost window, so a measurement can discard the load phase.
    pub fn cost_reset(&mut self) {
        for b in self.buses.iter_mut() {
            b.cost_ns = 0;
            b.max_ns = 0;
        }
    }

    /// Cached from the FX chain, so the audio thread never asks across FFI on
    /// the skip path.
    pub fn set_continuous(&mut self, n: usize, on: bool) {
        if let Some(b) = self.buses.get_mut(n) {
            b.continuous = on;
        }
    }

    /// `0:in=1234,out=987,blocks=3421 1:in=0,out=0,blocks=0`
    ///
    /// The remote-UI socket a device test drives can write engine params but
    /// cannot read them, so a log line is the only way to see from outside that
    /// a bus was fed AND that its FX pass produced something. Those are
    /// different failures with the same symptom — silence.
    pub fn report(&self) -> String {
        let mut out = String::new();
        for (n, b) in self.buses.iter().enumerate() {
            if n > 0 {
                out.push(' ');
            }
            out.push_str(&format!("{}:in={},out={},blocks={}", n, b.in_peak, b.last_peak, b.processed));
        }
        out
    }

    pub fn any_dirty(&self) -> bool {
        self.buses.iter().any(|b| b.dirty)
    }

    /// Drop what a bus holds without processing it — the block a send module is
    /// removed, where the buffer and the tail would otherwise ring on into
    /// whatever is loaded next.
    pub fn discard(&mut self, n: usize) {
        let Some(bus) = self.buses.get_mut(n) else { return };
        if bus.dirty {
            bus.buf.fill(0);
            bus.dirty = false;
        }
        bus.last_peak = 0;
    }
}

impl Default for SendBuses {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mixer::TrackMix;

    /// A track feeding bus 0 only.
    fn sending(level: f32) -> TrackMix {
        let mut send = [0.0; SEND_BUSES];
        send[0] = level;
        TrackMix { send, ..TrackMix::default() }
    }

    /// The plan every bus says no to, whatever `SEND_BUSES` is today.
    fn none() -> [bool; SEND_BUSES] {
        [false; SEND_BUSES]
    }

    /// Every bus's report line at rest, joined as `report` joins them. Built
    /// from `SEND_BUSES` so adding a bus does not turn these into assertions
    /// about a prefix of the string.
    fn quiet(fed: &[(usize, &str)]) -> String {
        (0..SEND_BUSES)
            .map(|n| match fed.iter().find(|(b, _)| *b == n) {
                Some((_, line)) => format!("{n}:{line}"),
                None => format!("{n}:in=0,out=0,blocks=0"),
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The plan where bus 0 alone says yes.
    fn only_first() -> [bool; SEND_BUSES] {
        let mut p = [false; SEND_BUSES];
        p[0] = true;
        p
    }

    /* The CPU page's numbers. Their whole reason for existing apart from
     * `cost_ns` / `max_ns` is that a device script may close that window at any
     * moment — so the split is the assertion, not an implementation note. */

    #[test]
    fn reading_the_benchmark_log_does_not_disturb_the_page() {
        let mut b = SendBuses::new();
        b.add_cost(0, 400_000);
        b.cost_reset();                       // what `sndcostlog` does
        assert_eq!(b.ui_costs(0), (400_000, 400_000), "the page kept its mean and its peak");
    }

    #[test]
    fn the_pages_reset_does_not_disturb_the_benchmark() {
        let mut b = SendBuses::new();
        b.add_cost(0, 400_000);
        b.ui_reset();                         // what `cpurst` does
        assert!(b.cost_report().starts_with("0:us=400.0,max=400.0"), "got {}", b.cost_report());
    }

    #[test]
    fn the_pages_reset_clears_the_peak_and_keeps_the_mean() {
        // Blanking the mean would open the page on zeros for a couple of
        // hundred blocks, which is the whole reading someone came for.
        let mut b = SendBuses::new();
        b.add_cost(0, 400_000);
        b.ui_reset();
        assert_eq!(b.ui_costs(0), (400_000, 0));
    }

    /* A mean fed only on the blocks that ran does not fall — it freezes at the
     * last cost the bus had, and the page draws a column for a pass that
     * stopped happening minutes ago. */
    #[test]
    fn a_bus_that_stops_running_decays_towards_zero() {
        let mut b = SendBuses::new();
        b.add_cost(0, 400_000);
        for _ in 0..200 {
            b.ui_idle(0);
        }
        let (mean, peak) = b.ui_costs(0);
        assert!(mean < 1_000, "the mean froze at {mean} ns");
        assert_eq!(peak, 400_000, "but what it once cost is still held");
    }

    /// The planner must NOT see the idle blocks: it partitions by what a running
    /// bus costs, and only ever asks about buses that are running.
    #[test]
    fn idling_leaves_the_planners_estimate_alone() {
        let mut b = SendBuses::new();
        b.add_cost(0, 400_000);
        for _ in 0..200 {
            b.ui_idle(0);
        }
        assert_eq!(b.plan_cost()[0], 400_000);
    }

    /// A replaced FX takes its numbers with it, or the incoming module's first
    /// second on the page is the outgoing one's cost.
    #[test]
    fn loading_over_a_bus_forgets_what_the_old_fx_cost() {
        let mut b = SendBuses::new();
        b.add_cost(0, 400_000);
        b.ui_clear(0);
        assert_eq!(b.ui_costs(0), (0, 0));
    }

    #[test]
    fn accumulating_sums_every_track_into_one_bus() {
        let mut b = SendBuses::new();
        b.accumulate(&[1000, 1000], &sending(1.0));
        b.accumulate(&[500, 500], &sending(1.0));
        assert_eq!(&b.buf_mut(0)[..2], &[1500, 1500], "a bus is a sum, not a replace");
    }

    #[test]
    fn a_zero_send_never_touches_the_bus() {
        // Zero cost when unused, rule 2 of three.
        let mut b = SendBuses::new();
        b.accumulate(&[30000, 30000], &sending(0.0));
        assert!(!b.any_dirty(), "a track at zero send must not dirty the bus");
        assert_eq!(&b.buf_mut(0)[..2], &[0, 0]);
    }

    #[test]
    fn the_bus_saturates_like_the_main_mix() {
        let mut b = SendBuses::new();
        for _ in 0..4 {
            b.accumulate(&[30000, -30000], &sending(1.0));
        }
        assert_eq!(&b.buf_mut(0)[..2], &[i16::MAX, i16::MIN], "clipped, not wrapped");
    }

    #[test]
    fn an_untouched_bus_is_not_processed_and_not_cleared() {
        // Zero cost when unused, rules 1 and 3.
        let mut b = SendBuses::new();
        assert_eq!(b.take_plan(), none());
    }

    #[test]
    fn a_ringing_bus_keeps_processing_after_its_input_stops() {
        // The tail rule. Without it a reverb is cut off the block its last note
        // ends, which is the most audible way to get this wrong.
        assert!(should_process(false, 5000, false));
    }

    #[test]
    fn a_silent_bus_with_a_silent_tail_stops() {
        assert!(!should_process(false, 0, false));
        assert!(!should_process(false, crate::chain_idle::SILENCE_LEVEL, false));
    }

    #[test]
    fn a_continuous_fx_never_stops() {
        // Loopers and modulated delays declare requires_continuous_processing:
        // their state stops advancing if a block is skipped.
        assert!(should_process(false, 0, true));
    }

    #[test]
    fn fresh_input_always_processes() {
        assert!(should_process(true, 0, false));
    }

    #[test]
    fn finishing_mixes_at_unity_and_zeroes_the_bus() {
        let mut b = SendBuses::new();
        b.accumulate(&[1000, 1000], &sending(1.0));
        b.take_plan();
        let mut out = vec![100i16, 100];
        b.finish(0, &mut out, 2);
        assert_eq!(out, vec![1100, 1100], "the return sums into the output at unity");
        assert_eq!(&b.buf_mut(0)[..2], &[0, 0], "the bus does not carry into the next block");
        assert!(!b.any_dirty());
    }

    #[test]
    fn finishing_remembers_the_output_peak_for_the_tail_rule() {
        let mut b = SendBuses::new();
        b.accumulate(&[9000, -9000], &sending(1.0));
        b.take_plan();
        let mut out = vec![0i16; 2];
        b.finish(0, &mut out, 2);
        // Input has stopped, but the last output was loud: still processing.
        assert_eq!(b.take_plan(), only_first());
    }

    #[test]
    fn the_input_peak_is_about_this_block_only() {
        // Left sticky it reads as a track still feeding a bus whose send was
        // turned down minutes ago — the one thing the diagnostic is for.
        let mut b = SendBuses::new();
        b.accumulate(&[8000, 8000], &sending(1.0));
        b.take_plan();
        let mut out = vec![0i16; 2];
        b.finish(0, &mut out, 2);
        b.take_plan();
        assert!(b.report().starts_with("0:in=0,"), "got {}", b.report());
    }

    #[test]
    fn the_report_separates_a_fed_bus_from_a_working_one() {
        // "No track is sending" and "the FX produced silence" are opposite
        // bugs with the same symptom. The report has to tell them apart, or a
        // device test cannot say which one it is looking at.
        let mut b = SendBuses::new();
        assert_eq!(b.report(), quiet(&[]));

        b.accumulate(&[8000, 8000], &sending(1.0));
        b.take_plan();
        let mut out = vec![0i16; 2];
        b.finish(0, &mut out, 2);
        assert_eq!(b.report(), quiet(&[(0, "in=8000,out=8000,blocks=1")]),
                   "a bus that was fed and passed its audio through");
    }

    /* The zero-cost claim, as an assertion rather than a promise. A set with no
     * send module and no track sending must not touch a buffer at all — not
     * accumulate into one, not process one, not memset one clear.
     *
     * Asserted HERE and not in `ChainSlots::render`, which is where the phase
     * actually runs: a host build has no chain host, so `render` returns before
     * reaching it and a test there would pass while testing nothing. */
    #[test]
    fn a_set_that_sends_nothing_never_touches_a_bus() {
        let mut b = SendBuses::new();
        for _ in 0..64 {
            for _ in 0..16 {
                b.accumulate(&[30000, -30000], &TrackMix::default());
            }
            assert_eq!(b.take_plan(), none());
            assert!(!b.any_dirty());
        }
        assert_eq!(&b.buf_mut(0)[..2], &[0, 0]);
        assert_eq!(&b.buf_mut(1)[..2], &[0, 0]);
    }

    /* `sndcostlog` resets the measurement window on every read, and a device
     * measurement reads it repeatedly. If that reset also cleared what the lane
     * planner partitions by, taking a measurement would flatten every bus to
     * zero cost — and the planner would answer "not worth fanning out" for
     * precisely as long as somebody was watching. */
    #[test]
    fn a_measurement_reset_does_not_erase_what_the_planner_reads() {
        let mut b = SendBuses::new();
        b.add_cost(0, 300_000);
        b.add_cost(1, 40_000);
        let before = b.plan_cost().to_vec();
        assert!(before[0] > before[1] && before[1] > 0, "got {before:?}");
        b.cost_reset();
        let zeroed = (0..SEND_BUSES)
            .map(|n| format!("{n}:us=0.0,max=0.0"))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(b.cost_report(), zeroed);
        assert_eq!(b.plan_cost(), &before[..], "the planner lost its costs to a log read");
    }

    #[test]
    fn discarding_drops_a_fed_bus_without_processing_it() {
        // The block a send module is removed: the buffer must not ring on into
        // whatever is loaded next.
        let mut b = SendBuses::new();
        b.accumulate(&[9000, 9000], &sending(1.0));
        b.discard(0);
        assert!(!b.any_dirty());
        assert_eq!(&b.buf_mut(0)[..2], &[0, 0]);
        assert_eq!(b.take_plan(), none(), "and its tail is gone too");
    }
}
