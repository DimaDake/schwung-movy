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

/// Per-track mix controls. Movy owns these because Move's mixer cannot see the
/// individual tracks (design §1: "Movy owns its own mixer").
#[derive(Debug, Clone, Copy)]
pub struct TrackMix {
    /// Linear gain, 1.0 = unity.
    pub gain: f32,
    /// -1.0 = hard left, 0.0 = centre, +1.0 = hard right.
    pub pan: f32,
    pub muted: bool,
}

impl Default for TrackMix {
    fn default() -> Self {
        Self { gain: 1.0, pan: 0.0, muted: false }
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
}
