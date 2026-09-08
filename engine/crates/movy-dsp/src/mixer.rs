//! Summing movy's chains into its single stereo output.
//!
//! Movy is loaded as schwung's overtake DSP generator, and the shim sums ONE
//! stereo buffer from it into the ME bus. So every movy-hosted track mixes here
//! rather than arriving in Move's mixer as its own channel — Move sees one
//! channel for all twelve (design §5.4).
//!
//! **Saturate, never wrap.** i16 addition that overflows wraps to the opposite
//! polarity: two loud chains summing past 32767 would come out as a full-scale
//! negative spike, which is not "a bit distorted", it is a click on every peak.
//! Clipping is merely loud; wrapping is broken.

use crate::send_bus::SEND_BUSES;

/// Per-track mix controls. Movy owns these because Move's mixer cannot see the
/// individual tracks (design §1: "Movy owns its own mixer").
#[derive(Debug, Clone, Copy)]
pub struct TrackMix {
    /// Linear gain, 1.0 = unity.
    pub gain: f32,
    /// -1.0 = hard left, 0.0 = centre, +1.0 = hard right.
    pub pan: f32,
    pub muted: bool,
    /// Post-fader, post-pan tap into each send bus. 0.0 = off.
    ///
    /// Sized by `SEND_BUSES` rather than spelled out, so widening the bus count
    /// is a compile error everywhere a tap is written by hand instead of a
    /// silently-ignored field.
    pub send: [f32; SEND_BUSES],
}

impl Default for TrackMix {
    fn default() -> Self {
        Self { gain: 1.0, pan: 0.0, muted: false, send: [0.0; SEND_BUSES] }
    }
}

impl TrackMix {
    /// Constant-gain (linear) pan law. Not constant-power: these tracks are
    /// summed against Move's own, and a -3dB centre would make a movy track
    /// quieter than a host track at the same fader.
    fn channel_gains(&self) -> (f32, f32) {
        if self.muted {
            return (0.0, 0.0);
        }
        let p = self.pan.clamp(-1.0, 1.0);
        let g = if self.gain.is_finite() { self.gain.max(0.0) } else { 0.0 };
        (g * (1.0 - p.max(0.0)), g * (1.0 + p.min(0.0)))
    }

    /// This track's contribution to send bus `n`.
    ///
    /// Post-fader and post-pan: the send follows the fader and the pan
    /// position, so pulling a track down takes its reverb with it and a
    /// hard-panned track arrives in the return where you left it. Live's
    /// default, and the one that matches "left of MFX" being true of the
    /// signal path and not just the page order.
    pub fn send_gains(&self, n: usize) -> (f32, f32) {
        let Some(&s) = self.send.get(n) else { return (0.0, 0.0) };
        let s = if s.is_finite() { s.max(0.0) } else { 0.0 };
        if s == 0.0 {
            return (0.0, 0.0);
        }
        let (gl, gr) = self.channel_gains();
        (gl * s, gr * s)
    }
}

/// A mixer field an automation lane can drive.
///
/// Movy's own, because none of these is a chain-host param: `knob_find_param`
/// resolves only components inside the chain, so the ordinary CC 102+lane path
/// has nothing to land on. The engine writes the field instead of emitting the
/// CC (design §7).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MixField {
    Gain,
    Pan,
    Send(usize),
}

impl MixField {
    /// `"send1"` is bus 0: the wire name is what the knob is LABELLED, and the
    /// labels are one-based. Out-of-range buses are refused rather than
    /// clamped, so a lane restored from a set saved by a build with more sends
    /// stays unassigned instead of driving the wrong one.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "gain" => Some(Self::Gain),
            "pan" => Some(Self::Pan),
            _ => {
                let n: usize = s.strip_prefix("send")?.parse().ok()?;
                (1..=SEND_BUSES).contains(&n).then_some(Self::Send(n - 1))
            }
        }
    }

    /// Denormalize a 0-127 lane value onto this field's control.
    ///
    /// A lane value is the control's POSITION on its own travel, not a linear
    /// fraction of its value range — the same mapping the UI writes with
    /// (`fieldFrac` in `src/mixer/mix-io.ts`). A lane that scaled differently
    /// from the knob makes the automated value jump the moment the knob is
    /// released, and linear-over-amplitude was exactly that: unity is 1.0 of
    /// 0..4, so the whole usable fader sat in the bottom quarter of the lane
    /// and an automated level read as stuck against its end.
    ///
    /// Pan is unaffected — its position and its value are the same line.
    pub fn denorm(self, v: u8) -> f32 {
        let n = (v.min(127) as f32) / 127.0;
        match self {
            Self::Gain => amp_at(n, GAIN_TOP_DB),
            Self::Pan => n * 2.0 - 1.0,
            Self::Send(_) => amp_at(n, SEND_TOP_DB),
        }
    }

    pub fn apply(self, mix: &mut TrackMix, v: u8) {
        let f = self.denorm(v);
        match self {
            Self::Gain => mix.gain = f,
            Self::Pan => mix.pan = f,
            /* `parse` is the only way to build one and it bounds the index, so
             * this cannot be out of range — but it is written as a guarded
             * write anyway, because a panic here is on the audio thread. */
            Self::Send(n) => {
                if let Some(s) = mix.send.get_mut(n) {
                    *s = f;
                }
            }
        }
    }
}

/// The fader curve, shared with the UI's `db-ladder.ts`: position 0 is silence,
/// position 1 is `top_db`, and everything between is one straight line in dB.
/// The floor is the same -48 dB the UI uses; a level below it is silence, which
/// is what position 0 means.
const DB_FLOOR: f32 = -48.0;
/// The fader's ceiling: 12 dB of headroom above unity (amplitude 4.0).
const GAIN_TOP_DB: f32 = 12.041_2;
/// A send stops at unity.
const SEND_TOP_DB: f32 = 0.0;

fn amp_at(frac: f32, top_db: f32) -> f32 {
    if frac <= 0.0 {
        return 0.0;
    }
    let db = DB_FLOOR + frac.min(1.0) * (top_db - DB_FLOOR);
    10f32.powf(db / 20.0)
}

#[inline]
fn saturate(v: i32) -> i16 {
    v.clamp(i16::MIN as i32, i16::MAX as i32) as i16
}

/// Mix one chain's interleaved stereo block into `out`, applying its gain, pan
/// and mute. `src` and `out` must be the same length; a mismatch mixes the
/// common prefix rather than panicking, because this runs on the audio thread
/// where a panic would be caught but the block would be lost.
pub fn mix_into(out: &mut [i16], src: &[i16], mix: &TrackMix) {
    let (gl, gr) = mix.channel_gains();
    mix_into_gains(out, src, gl, gr);
}

/// Mix `src` into `out` at explicit per-channel gains.
///
/// The shared core of the main mix and every send tap, so there is one
/// saturation rule and one rounding rule rather than two that drift.
pub fn mix_into_gains(out: &mut [i16], src: &[i16], gl: f32, gr: f32) {
    if gl == 0.0 && gr == 0.0 {
        return; // muted or silent: nothing to add, and no rounding noise either
    }
    let n = out.len().min(src.len()) / 2 * 2;
    for i in (0..n).step_by(2) {
        let l = out[i] as i32 + (src[i] as f32 * gl) as i32;
        let r = out[i + 1] as i32 + (src[i + 1] as f32 * gr) as i32;
        out[i] = saturate(l);
        out[i + 1] = saturate(r);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unity() -> TrackMix {
        TrackMix::default()
    }

    /// A lane's 0-127 is a POSITION on the control's travel. Linear-over-
    /// amplitude put unity a quarter of the way up and left the automated
    /// fader stuck against one end; these pin the curve to the UI's.
    #[test]
    fn a_gain_lane_walks_the_fader_curve() {
        let g = MixField::Gain;
        assert_eq!(g.denorm(0), 0.0, "the bottom of a lane is silence");
        let top = g.denorm(127);
        assert!((top - 4.0).abs() < 0.01, "the top is the fader maximum, got {top}");
        // Unity is 48 dB up a 60.04 dB travel: 0.7995 of the way, lane value
        // 102 — within half a lane step (0.47 dB), which is as close as a
        // 7-bit lane gets to any particular value.
        let unity = 20.0 * g.denorm(102).log10();
        assert!(unity.abs() < 0.5, "unity sits where the knob puts it, got {unity} dB");
        // Half the lane is half the DECIBELS, not half the amplitude.
        let mid = 20.0 * g.denorm(64).log10();
        assert!((mid - -17.8).abs() < 0.5, "midway is midway in dB, got {mid} dB");
    }

    #[test]
    fn a_send_lane_tops_out_at_unity() {
        let s = MixField::Send(0);
        assert_eq!(s.denorm(0), 0.0, "off");
        let top = s.denorm(127);
        assert!((top - 1.0).abs() < 0.001, "a send's travel ends at 0 dB, got {top}");
        let mid = 20.0 * s.denorm(64).log10();
        assert!((mid - -23.8).abs() < 0.5, "and is linear in dB between, got {mid} dB");
    }

    #[test]
    fn a_pan_lane_is_unchanged() {
        let p = MixField::Pan;
        assert!((p.denorm(0) + 1.0).abs() < 0.001, "hard left");
        assert!(p.denorm(64).abs() < 0.01, "centre");
        assert!((p.denorm(127) - 1.0).abs() < 0.001, "hard right");
    }

    #[test]
    fn sums_into_the_destination() {
        let mut out = vec![100i16, 200, 300, 400];
        mix_into(&mut out, &[10, 20, 30, 40], &unity());
        assert_eq!(out, vec![110, 220, 330, 440], "mixing ADDS, it does not replace");
    }

    #[test]
    fn saturates_instead_of_wrapping() {
        // The whole reason this file exists. Wrapping would give -32236 here:
        // a full-scale flip, audible as a click on every peak.
        let mut out = vec![30000i16, -30000];
        mix_into(&mut out, &[30000, -30000], &unity());
        assert_eq!(out, vec![i16::MAX, i16::MIN], "clipped, not wrapped");
    }

    #[test]
    fn saturates_at_both_rails_across_many_chains() {
        let mut out = vec![0i16; 2];
        for _ in 0..12 {
            mix_into(&mut out, &[20000, -20000], &unity());
        }
        assert_eq!(out, vec![i16::MAX, i16::MIN], "twelve loud chains still clip cleanly");
    }

    #[test]
    fn mute_contributes_nothing() {
        let mut out = vec![100i16, 100];
        let mix = TrackMix { muted: true, ..TrackMix::default() };
        mix_into(&mut out, &[5000, 5000], &mix);
        assert_eq!(out, vec![100, 100]);
    }

    #[test]
    fn gain_scales_the_source() {
        let mut out = vec![0i16; 2];
        mix_into(&mut out, &[1000, 1000], &TrackMix { gain: 0.5, ..TrackMix::default() });
        assert_eq!(out, vec![500, 500]);
    }

    #[test]
    fn hard_pan_silences_the_other_side() {
        let mut out = vec![0i16; 2];
        mix_into(&mut out, &[1000, 1000], &TrackMix { pan: 1.0, ..TrackMix::default() });
        assert_eq!(out, vec![0, 1000], "hard right: nothing in the left channel");

        let mut out = vec![0i16; 2];
        mix_into(&mut out, &[1000, 1000], &TrackMix { pan: -1.0, ..TrackMix::default() });
        assert_eq!(out, vec![1000, 0], "hard left: nothing in the right channel");
    }

    #[test]
    fn centre_pan_is_unity_on_both_sides() {
        // Constant-GAIN, not constant-power: a -3dB centre would make a movy
        // track quieter than a host track at the same fader setting.
        let mut out = vec![0i16; 2];
        mix_into(&mut out, &[1000, 1000], &unity());
        assert_eq!(out, vec![1000, 1000]);
    }

    #[test]
    fn negative_or_non_finite_gain_is_treated_as_silence() {
        // A bad param must not invert phase or produce NaN samples.
        for bad in [-1.0f32, f32::NAN, f32::INFINITY] {
            let mut out = vec![50i16, 50];
            mix_into(&mut out, &[1000, 1000], &TrackMix { gain: bad, ..TrackMix::default() });
            assert_eq!(out, vec![50, 50], "gain {:?} must not corrupt the mix", bad);
        }
    }

    #[test]
    fn length_mismatch_mixes_the_common_prefix() {
        let mut out = vec![0i16; 4];
        mix_into(&mut out, &[100, 100], &unity());
        assert_eq!(out, vec![100, 100, 0, 0], "short source does not panic or overrun");

        let mut out = vec![0i16; 2];
        mix_into(&mut out, &[100, 100, 100, 100], &unity());
        assert_eq!(out, vec![100, 100], "long source is truncated, not overrun");
    }

    #[test]
    fn send_is_post_fader_and_post_pan() {
        // The whole point of the tap point: a track faded to half and panned
        // hard right sends a half-level, hard-right signal — not the raw synth
        // output. Pulling a fader down takes its reverb with it.
        let mix = TrackMix { gain: 0.5, pan: 1.0, send: [1.0, 0.0, 0.0], ..TrackMix::default() };
        assert_eq!(mix.send_gains(0), (0.0, 0.5));
        assert_eq!(mix.send_gains(1), (0.0, 0.0));
    }

    #[test]
    fn a_muted_track_sends_nothing() {
        // Muting a track must take its reverb with it, as it does in Live.
        let mix = TrackMix { muted: true, send: [1.0; SEND_BUSES], ..TrackMix::default() };
        for n in 0..SEND_BUSES {
            assert_eq!(mix.send_gains(n), (0.0, 0.0), "bus {n}");
        }
    }

    #[test]
    fn send_level_scales_the_tap() {
        let mix = TrackMix { send: [0.25, 1.0, 0.5], ..TrackMix::default() };
        assert_eq!(mix.send_gains(0), (0.25, 0.25));
        assert_eq!(mix.send_gains(1), (1.0, 1.0));
        assert_eq!(mix.send_gains(2), (0.5, 0.5));
    }

    #[test]
    fn a_bad_send_level_is_silence_not_noise() {
        // The same rule gain already has: a NaN must never reach the bus.
        for bad in [-1.0f32, f32::NAN, f32::INFINITY] {
            let mix = TrackMix { send: [bad, 0.0, 0.0], ..TrackMix::default() };
            assert_eq!(mix.send_gains(0), (0.0, 0.0), "send {:?} must not corrupt the bus", bad);
        }
    }

    #[test]
    fn an_out_of_range_bus_index_sends_nothing() {
        let mix = TrackMix { send: [1.0; SEND_BUSES], ..TrackMix::default() };
        assert_eq!(mix.send_gains(SEND_BUSES), (0.0, 0.0));
    }

    #[test]
    fn defaults_send_nothing() {
        assert_eq!(TrackMix::default().send, [0.0; SEND_BUSES]);
    }
}
