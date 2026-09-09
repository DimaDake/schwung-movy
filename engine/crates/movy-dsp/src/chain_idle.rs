//! When a chain may skip work because it is making no sound.
//!
//! Ported from schwung's shim, which has run this on the four host slots for
//! years (`schwung_shim.c:643-645` for the constants, `1852-2045` for the two
//! gates). Same constants, same shape — the stagger is the one number that
//! could not come across unchanged, and `PROBE_STAGGER` says why.
//!
//! Deliberately free of chain, host and FFI types: every rule here is decided
//! by counting blocks and comparing peaks, so it is testable on the host and
//! the audio-thread code that obeys it stays a straight read of this file.

/// Consecutive silent blocks before a gate sleeps — ~1.0 s at 344 blocks/s.
/// `DSP_IDLE_THRESHOLD` in the shim.
pub const SLEEP_AFTER: u32 = 344;

/// `abs(sample)` at or below this is silence. `DSP_SILENCE_LEVEL` in the shim.
pub const SILENCE_LEVEL: i32 = 4;

/// Blocks between probe renders of a sleeping synth — ~0.5 s.
pub const PROBE_PERIOD: u32 = 172;

/// Probe offset per chain, so twelve sleeping chains do not all probe on the
/// same block and stack twelve renders into one.
///
/// The shim uses 43, which is `PROBE_PERIOD / 4` for its four slots. Twelve
/// chains cannot reuse it: `43 * 4 == 172`, so chains 0, 4 and 8 would land on
/// the same block — exactly the ~1 ms spike the stagger exists to prevent.
/// `172 / 12` keeps all twelve distinct.
pub const PROBE_STAGGER: u32 = 14;

/// What one chain owes this block.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Work {
    pub synth: bool,
    pub fx: bool,
}

impl Work {
    pub const NONE: Work = Work { synth: false, fx: false };

    /// Nothing ran, so nothing may be mixed.
    pub fn none(self) -> bool {
        !self.synth && !self.fx
    }
}

pub struct IdleGate {
    /// Consecutive silent blocks while the synth is awake.
    silence: Vec<u32>,
    /// Blocks since the synth fell asleep — the probe schedule's clock.
    slept: Vec<u32>,
    asleep: Vec<bool>,
    fx_silence: Vec<u32>,
    fx_asleep: Vec<bool>,
    /// Bumped on every sleep/wake transition. The lane planner partitions by
    /// what is actually rendering, so it has to know when that set changed —
    /// and a transition is far rarer than a block, which is what makes reading
    /// a counter the right shape here.
    epoch: u32,
}

impl IdleGate {
    pub fn new(chains: usize) -> Self {
        Self {
            silence: vec![0; chains],
            slept: vec![0; chains],
            asleep: vec![false; chains],
            fx_silence: vec![0; chains],
            fx_asleep: vec![false; chains],
            epoch: 0,
        }
    }

    pub fn wake(&mut self, chain: usize) {
        if chain >= self.asleep.len() {
            return;
        }
        if self.asleep[chain] || self.fx_asleep[chain] {
            self.epoch = self.epoch.wrapping_add(1);
        }
        self.silence[chain] = 0;
        self.slept[chain] = 0;
        self.asleep[chain] = false;
        self.fx_silence[chain] = 0;
        self.fx_asleep[chain] = false;
    }

    pub fn wake_all(&mut self) {
        for c in 0..self.asleep.len() {
            self.wake(c);
        }
    }

    /// A chain that no longer exists. Same reset as `wake`, named for the call
    /// site so a teardown does not read as a wake-up.
    pub fn forget(&mut self, chain: usize) {
        self.wake(chain);
    }

    /// Both gates asleep — the chain is doing nothing at all this block, which
    /// is what excludes it from the lane plan.
    pub fn deep_asleep(&self, chain: usize) -> bool {
        chain < self.asleep.len() && self.asleep[chain] && self.fx_asleep[chain]
    }

    pub fn asleep_count(&self) -> usize {
        self.asleep.iter().filter(|&&a| a).count()
    }

    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    /// Decide this block's work. Called once per loaded chain per block, before
    /// anything renders — the parallel path builds its whole task list up front,
    /// so nothing here may depend on this block's own output.
    pub fn plan(&mut self, chain: usize) -> Work {
        if chain >= self.asleep.len() {
            return Work::NONE;
        }
        if !self.asleep[chain] {
            return Work { synth: true, fx: true };
        }
        self.slept[chain] = self.slept[chain].wrapping_add(1);
        let probe =
            (self.slept[chain].wrapping_add(chain as u32 * PROBE_STAGGER)) % PROBE_PERIOD == 0;
        // A probe runs the FX too: if the synth turns out to be speaking again,
        // its output has to reach the mix through the FX in the SAME block, and
        // the task list was already built by then.
        Work { synth: probe, fx: !self.fx_asleep[chain] || probe }
    }

    /// Fold this block's peaks back in. `synth_peak` is measured before
    /// `process_fx` ran, `fx_peak` after — a chain whose FX never settles must
    /// not be able to hold its synth awake.
    pub fn observe(
        &mut self,
        chain: usize,
        work: Work,
        synth_peak: i32,
        fx_peak: i32,
        fx_keep_alive: bool,
    ) {
        if chain >= self.asleep.len() {
            return;
        }
        if work.synth {
            if synth_peak <= SILENCE_LEVEL {
                self.silence[chain] = self.silence[chain].saturating_add(1);
                if self.silence[chain] >= SLEEP_AFTER && !self.asleep[chain] {
                    self.asleep[chain] = true;
                    self.slept[chain] = 0;
                    self.epoch = self.epoch.wrapping_add(1);
                }
            } else if self.asleep[chain] || self.silence[chain] > 0 {
                self.wake(chain);
            }
        }

        if fx_keep_alive {
            // Loopers and modulated delays declare this. Skipping them stops a
            // 6 s loop's write position advancing, so the loop "only returns
            // when there is signal" — the bug the shim's comment records.
            self.fx_silence[chain] = 0;
            if self.fx_asleep[chain] {
                self.fx_asleep[chain] = false;
                self.epoch = self.epoch.wrapping_add(1);
            }
            return;
        }
        if !work.fx {
            return;
        }
        if fx_peak <= SILENCE_LEVEL {
            self.fx_silence[chain] = self.fx_silence[chain].saturating_add(1);
            if self.fx_silence[chain] >= SLEEP_AFTER && !self.fx_asleep[chain] {
                self.fx_asleep[chain] = true;
                self.epoch = self.epoch.wrapping_add(1);
            }
        } else {
            self.fx_silence[chain] = 0;
            if self.fx_asleep[chain] {
                self.fx_asleep[chain] = false;
                self.epoch = self.epoch.wrapping_add(1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHAINS: usize = 12;

    fn gate() -> IdleGate {
        IdleGate::new(CHAINS)
    }

    /// Feed `n` silent blocks to chain 0, planning each one as the render path
    /// would. Returns the work planned for the block AFTER them.
    fn silent_blocks(g: &mut IdleGate, n: u32) -> Work {
        for _ in 0..n {
            let w = g.plan(0);
            g.observe(0, w, 0, 0, false);
        }
        g.plan(0)
    }

    #[test]
    fn sleeps_on_the_344th_silent_block_and_not_the_343rd() {
        let mut g = gate();
        assert!(silent_blocks(&mut g, 343).synth, "343 silent blocks is not yet a second");
        let mut g = gate();
        assert!(!silent_blocks(&mut g, 344).synth, "the 344th silent block puts it to sleep");
    }

    #[test]
    fn one_loud_block_resets_the_count() {
        let mut g = gate();
        for _ in 0..343 {
            let w = g.plan(0);
            g.observe(0, w, 0, 0, false);
        }
        let w = g.plan(0);
        g.observe(0, w, 5000, 5000, false);
        assert!(silent_blocks(&mut g, 343).synth, "the counter restarts from the loud block");
    }

    #[test]
    fn a_peak_of_four_is_silence_and_five_is_not() {
        let mut g = gate();
        for _ in 0..344 {
            let w = g.plan(0);
            g.observe(0, w, SILENCE_LEVEL, SILENCE_LEVEL, false);
        }
        assert!(!g.plan(0).synth, "a peak at the threshold counts as silence");

        let mut g = gate();
        for _ in 0..344 {
            let w = g.plan(0);
            g.observe(0, w, SILENCE_LEVEL + 1, 0, false);
        }
        assert!(g.plan(0).synth, "one count above the threshold is sound");
    }

    #[test]
    fn midi_wakes_it_on_that_block() {
        let mut g = gate();
        assert!(!silent_blocks(&mut g, 344).synth);
        g.wake(0);
        assert!(g.plan(0).synth, "a woken chain renders on the very next block");
    }

    #[test]
    fn a_sleeping_synth_probes_once_in_172_blocks() {
        let mut g = gate();
        assert!(!silent_blocks(&mut g, 344).synth);
        let mut probes = 0;
        for _ in 0..PROBE_PERIOD * 3 {
            let w = g.plan(0);
            if w.synth {
                probes += 1;
            }
            g.observe(0, w, 0, 0, false);
        }
        assert_eq!(probes, 3, "exactly one probe per 172-block period");
    }

    /// The one number that could not be copied from the shim. Its `s * 43` is
    /// 172/4 and spreads four slots; with twelve chains 43*4 == 172, so chains
    /// 0, 4 and 8 would probe on the SAME block and stack three renders into
    /// one — the spike the stagger exists to prevent.
    #[test]
    fn twelve_sleeping_chains_never_probe_on_the_same_block() {
        let mut g = gate();
        for c in 0..CHAINS {
            for _ in 0..344 {
                let w = g.plan(c);
                g.observe(c, w, 0, 0, false);
            }
            assert!(!g.plan(c).synth, "chain {c} should be asleep");
        }
        let mut per_block = vec![0usize; PROBE_PERIOD as usize];
        for b in 0..PROBE_PERIOD as usize {
            for c in 0..CHAINS {
                let w = g.plan(c);
                if w.synth {
                    per_block[b] += 1;
                }
                g.observe(c, w, 0, 0, false);
            }
        }
        assert_eq!(per_block.iter().sum::<usize>(), CHAINS, "each chain probes once");
        assert!(per_block.iter().all(|&n| n <= 1), "probes collided: {per_block:?}");
    }

    #[test]
    fn the_fx_never_sleeps_while_the_synth_is_awake() {
        let mut g = gate();
        for _ in 0..1000 {
            // Loud synth, silent FX output — impossible in practice, and the
            // gate must not act on it.
            let w = g.plan(0);
            assert!(w.fx, "FX may not sleep under a sounding synth");
            g.observe(0, w, 5000, 0, false);
        }
    }

    #[test]
    fn both_gates_sleep_once_the_synth_and_its_tail_are_silent() {
        let mut g = gate();
        for _ in 0..344 * 2 {
            let w = g.plan(0);
            g.observe(0, w, 0, 0, false);
        }
        let w = g.plan(0);
        assert!(w.none(), "both gates asleep means no work at all");
        assert!(g.deep_asleep(0));
    }

    #[test]
    fn an_fx_that_requires_continuous_processing_never_sleeps() {
        let mut g = gate();
        for _ in 0..344 * 3 {
            let w = g.plan(0);
            g.observe(0, w, 0, 0, true);
        }
        let w = g.plan(0);
        assert!(w.fx, "a looper's FX must keep running through silence");
        assert!(!g.deep_asleep(0));
    }

    /// The split is unconditional: a chain that has
    /// never been silent owes both halves every block. It used to be reachable
    /// as a render setting, and nothing else pins it — every other test here starts
    /// by going quiet.
    #[test]
    fn a_sounding_chain_owes_both_halves_every_block() {
        let mut g = gate();
        for _ in 0..1000 {
            let w = g.plan(0);
            assert!(w.synth && w.fx, "a sounding chain renders synth and FX separately");
            g.observe(0, w, 5000, 5000, false);
        }
    }

    #[test]
    fn the_epoch_moves_only_on_a_sleep_or_wake_transition() {
        let mut g = gate();
        let start = g.epoch();
        for _ in 0..100 {
            let w = g.plan(0);
            g.observe(0, w, 5000, 5000, false);
        }
        assert_eq!(g.epoch(), start, "a chain that keeps sounding is not a transition");
        for _ in 0..344 {
            let w = g.plan(0);
            g.observe(0, w, 0, 0, false);
        }
        assert_ne!(g.epoch(), start, "falling asleep is a transition the planner must see");
    }
}
