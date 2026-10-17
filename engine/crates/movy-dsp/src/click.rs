//! Metronome click synthesis: a short decaying sine burst rendered straight
//! into the overtake-DSP output block (which the shim mixes into Move's
//! output). Accent beats get a higher pitch, native-metronome style.

pub struct Click {
    phase: f32,
    phase_inc: f32,
    env: f32,
    decay: f32,
    sample_rate: f32,
    amp: f32,
}

/// Default peak, and the level the click has always had.
const AMP: f32 = 9000.0;
/// Loudest peak the click may reach. The burst starts at envelope 1.0 on a
/// sine, so its first peak IS this number: anything above 32767 would clip
/// before it ever met the mix, and the margin keeps the i16 cast clear of the
/// rail.
const MAX_AMP: f32 = 32000.0;
/// Boost over the default at which `MAX_AMP` is reached (20·log10(32000/9000)).
pub const MAX_BOOST_DB: i32 = 11;

impl Click {
    pub fn new(sample_rate: u32) -> Self {
        Click {
            phase: 0.0,
            phase_inc: 0.0,
            env: 0.0,
            decay: 0.0,
            sample_rate: sample_rate as f32,
            amp: AMP,
        }
    }

    /// Boost over the default level, in whole dB. Clamped on both sides so a
    /// stray value from the UI can neither mute the click nor clip it.
    pub fn set_boost_db(&mut self, db: i32) {
        let db = db.clamp(0, MAX_BOOST_DB);
        self.amp = (AMP * 10f32.powf(db as f32 / 20.0)).min(MAX_AMP);
    }

    pub fn trigger(&mut self, accent: bool) {
        let freq = if accent { 1600.0 } else { 1100.0 };
        self.phase = 0.0;
        self.phase_inc = core::f32::consts::TAU * freq / self.sample_rate;
        self.env = 1.0;
        // ~40 ms to silence.
        self.decay = (-1.0 / (0.040 * self.sample_rate) * 6.9).exp();
    }

    /// Additively mix into an interleaved stereo i16 block.
    pub fn render(&mut self, out: &mut [i16]) {
        if self.env < 0.001 {
            return;
        }
        let frames = out.len() / 2;
        for i in 0..frames {
            let s = (self.phase.sin() * self.env * self.amp) as i32;
            self.phase += self.phase_inc;
            if self.phase > core::f32::consts::TAU {
                self.phase -= core::f32::consts::TAU;
            }
            self.env *= self.decay;
            for ch in 0..2 {
                let idx = i * 2 + ch;
                let mixed = out[idx] as i32 + s;
                out[idx] = mixed.clamp(-32768, 32767) as i16;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peak(db: i32) -> i32 {
        let mut c = Click::new(44100);
        c.set_boost_db(db);
        c.trigger(true);
        let mut out = vec![0i16; 2 * 4096];
        c.render(&mut out);
        out.iter().map(|&v| (v as i32).abs()).max().unwrap()
    }

    #[test]
    fn default_level_is_unchanged() {
        // The sine peaks a quarter period in, by which time the envelope has
        // already decayed a few percent.
        assert!((peak(0) - 9000).abs() < 500, "{}", peak(0));
    }

    #[test]
    fn louder_each_step_and_never_clips() {
        let mut last = 0;
        for db in 0..=MAX_BOOST_DB {
            let p = peak(db);
            assert!(p > last, "{db} dB must be louder than the step below");
            assert!(p < 32767, "{db} dB clipped at {p}");
            last = p;
        }
        assert!(last > 30000, "the top step should be near full scale, got {last}");
    }

    #[test]
    fn out_of_range_is_clamped() {
        assert_eq!(peak(99), peak(MAX_BOOST_DB));
        assert_eq!(peak(-5), peak(0));
    }
}
