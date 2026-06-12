//! Integer-accumulator master clock (davebox seq8 model: no fractional
//! drift, exact long-run tick rate regardless of buffer size).
//!
//! Per audio block: `accum += frames * bpm_x100 * PPQN`. Each time `accum`
//! reaches `sample_rate * 60 * 100`, one master tick fires.

use crate::PPQN;

#[derive(Debug, Clone)]
pub struct Clock {
    #[allow(dead_code)] // kept for diagnostics; threshold derives from it
    sample_rate: u32,
    /// BPM stored as hundredths (12000 = 120.00 BPM) so fractional tempos
    /// stay exact in integer math.
    bpm_x100: u32,
    accum: u64,
    threshold: u64,
    /// Monotonic master tick counter since transport start.
    pub tick: u64,
}

pub const BPM_X100_MIN: u32 = 2000; // 20 BPM
pub const BPM_X100_MAX: u32 = 30000; // 300 BPM

impl Clock {
    pub fn new(sample_rate: u32, bpm_x100: u32) -> Self {
        Clock {
            sample_rate,
            bpm_x100: bpm_x100.clamp(BPM_X100_MIN, BPM_X100_MAX),
            accum: 0,
            threshold: sample_rate as u64 * 60 * 100,
            tick: 0,
        }
    }

    pub fn bpm_x100(&self) -> u32 {
        self.bpm_x100
    }

    /// Tempo changes take effect from the next block; the accumulator is
    /// preserved so the beat phase doesn't jump.
    pub fn set_bpm_x100(&mut self, bpm_x100: u32) {
        self.bpm_x100 = bpm_x100.clamp(BPM_X100_MIN, BPM_X100_MAX);
    }

    pub fn reset(&mut self) {
        self.accum = 0;
        self.tick = 0;
    }

    /// Advance by one audio block of `frames`; returns how many master ticks
    /// fire within this block (0..=n). The caller services each tick.
    pub fn advance(&mut self, frames: u32) -> u32 {
        self.accum += frames as u64 * self.bpm_x100 as u64 * PPQN as u64;
        let mut fired = 0;
        while self.accum >= self.threshold {
            self.accum -= self.threshold;
            self.tick += 1;
            fired += 1;
        }
        fired
    }

    /// Seconds per tick at the current tempo (for host-side diagnostics).
    pub fn tick_period_secs(&self) -> f64 {
        60.0 / (self.bpm_x100 as f64 / 100.0 * PPQN as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAMES: u32 = 128;
    const RATE: u32 = 44100;

    fn run_blocks(clock: &mut Clock, blocks: u64) -> u64 {
        let mut total = 0u64;
        for _ in 0..blocks {
            total += clock.advance(FRAMES) as u64;
        }
        total
    }

    #[test]
    fn tick_rate_exact_over_one_minute_120bpm() {
        let mut c = Clock::new(RATE, 12000);
        // One minute of audio = RATE*60 frames.
        let blocks = (RATE as u64 * 60) / FRAMES as u64;
        let ticks = run_blocks(&mut c, blocks);
        // 120 BPM * 96 PPQN = 11520 ticks/minute. Allow the partial last
        // block (rounded-down block count) to cost at most 1 tick.
        let expected = 120 * PPQN as u64;
        assert!(
            (ticks as i64 - expected as i64).abs() <= 1,
            "ticks={ticks} expected={expected}"
        );
    }

    #[test]
    fn no_drift_over_an_hour_fractional_bpm() {
        // 133.33 BPM for an hour; integer accumulator must stay exact.
        let mut c = Clock::new(RATE, 13333);
        let blocks = (RATE as u64 * 3600) / FRAMES as u64;
        let ticks = run_blocks(&mut c, blocks);
        let frames_done = blocks * FRAMES as u64;
        // Exact expectation: floor(frames * bpm_x100 * PPQN / (rate*60*100))
        let expected = frames_done * 13333 * PPQN as u64 / (RATE as u64 * 60 * 100);
        assert_eq!(ticks, expected);
    }

    #[test]
    fn ticks_per_block_at_most_needed() {
        // At 300 BPM a tick fires every ~2.08ms; a 2.9ms block can carry 2.
        let mut c = Clock::new(RATE, 30000);
        let mut max_fired = 0;
        for _ in 0..10_000 {
            max_fired = max_fired.max(c.advance(FRAMES));
        }
        assert!(max_fired <= 2, "max_fired={max_fired}");
    }

    #[test]
    fn tempo_change_preserves_phase() {
        let mut c = Clock::new(RATE, 12000);
        run_blocks(&mut c, 100);
        let tick_before = c.tick;
        c.set_bpm_x100(6000);
        // Slower tempo: ticks keep firing, counter keeps increasing.
        run_blocks(&mut c, 1000);
        assert!(c.tick > tick_before);
    }

    #[test]
    fn bpm_clamped() {
        let c = Clock::new(RATE, 1);
        assert_eq!(c.bpm_x100(), BPM_X100_MIN);
        let c = Clock::new(RATE, 999999);
        assert_eq!(c.bpm_x100(), BPM_X100_MAX);
    }
}
