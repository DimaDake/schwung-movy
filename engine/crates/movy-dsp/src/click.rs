//! Metronome click synthesis: a short decaying sine burst rendered straight
//! into the overtake-DSP output block (which the shim mixes into Move's
//! output). Accent beats get a higher pitch, native-metronome style.

pub struct Click {
    phase: f32,
    phase_inc: f32,
    env: f32,
    decay: f32,
    sample_rate: f32,
}

const AMP: f32 = 9000.0;

impl Click {
    pub fn new(sample_rate: u32) -> Self {
        Click {
            phase: 0.0,
            phase_inc: 0.0,
            env: 0.0,
            decay: 0.0,
            sample_rate: sample_rate as f32,
        }
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
            let s = (self.phase.sin() * self.env * AMP) as i32;
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
