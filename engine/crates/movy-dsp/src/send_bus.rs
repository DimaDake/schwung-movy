//! The two send buses movy sums its tracks into.
//!
//! A send bus is `chain_process_fx` (`chain_host.c:2176`) run over a buffer
//! every track has already contributed to — so it cannot be planned onto a
//! render lane: it depends on every chain having rendered, and runs after the
//! join, serially on the audio thread (design §5).
//!
//! **Costing nothing when no send is in use is a commitment, not a property
//! that falls out.** Three early-outs, one test each: a bus with no instance is
//! never processed, a track at zero send never touches a buffer, and a bus
//! nothing wrote is never cleared. Get them wrong and a feature nobody switched
//! on costs two memsets and sixteen chains of multiply-adds every block.
//!
//! Free of chain, host and FFI types, exactly as `chain_idle` is: every rule
//! here is decided by counting peaks and flags, so the audio-thread code that
//! obeys it stays a straight read of this file.

use crate::chain_idle::SILENCE_LEVEL;
use crate::mixer::{mix_into_gains, TrackMix};

pub const SEND_BUSES: usize = 2;

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
}

pub struct SendBuses {
    buses: Vec<Bus>,
}

impl SendBuses {
    pub fn new() -> Self {
        Self {
            buses: (0..SEND_BUSES)
                .map(|_| Bus {
                    buf: vec![0i16; BUS_SAMPLES],
                    dirty: false,
                    last_peak: 0,
                    continuous: false,
                    in_peak: 0,
                    processed: 0,
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

    fn sending(level: f32) -> TrackMix {
        TrackMix { send: [level, 0.0], ..TrackMix::default() }
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
        assert_eq!(b.take_plan(), [false, false]);
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
        assert_eq!(b.take_plan(), [true, false]);
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
        assert_eq!(b.report(), "0:in=0,out=0,blocks=0 1:in=0,out=0,blocks=0");

        b.accumulate(&[8000, 8000], &sending(1.0));
        b.take_plan();
        let mut out = vec![0i16; 2];
        b.finish(0, &mut out, 2);
        assert_eq!(b.report(), "0:in=8000,out=8000,blocks=1 1:in=0,out=0,blocks=0",
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
            assert_eq!(b.take_plan(), [false, false]);
            assert!(!b.any_dirty());
        }
        assert_eq!(&b.buf_mut(0)[..2], &[0, 0]);
        assert_eq!(&b.buf_mut(1)[..2], &[0, 0]);
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
        assert_eq!(b.take_plan(), [false, false], "and its tail is gone too");
    }
}
