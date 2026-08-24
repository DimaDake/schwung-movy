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

/// What `chidle` selects. An ordinal because the FX gate genuinely depends on
/// the synth gate, and saying so in the type beats saying it in a rule.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum IdleLevel {
    /// Today's path: one `render_block` call that does synth and FX together.
    Off,
    /// Split into `render_block` + `process_fx`, but nothing ever sleeps. The
    /// equivalence arm — what `chdigest` compares against `Off`.
    Split,
    /// Split, and a silent synth stops rendering.
    Synth,
    /// Split, and a silent FX tail stops processing once the synth is asleep.
    SynthFx,
}

impl IdleLevel {
    /// A typo must not silently disable the optimization, so anything
    /// unrecognised reads as the default rather than as `Off`.
    pub fn from_flag(v: &str) -> Self {
        match v {
            "0" => Self::Off,
            "1" => Self::Split,
            "2" => Self::Synth,
            _ => Self::SynthFx,
        }
    }

    /// Whether the chain renders as `render_block` + `process_fx`.
    pub fn splits(self) -> bool {
        self != Self::Off
    }

    fn synth_gate(self) -> bool {
        matches!(self, Self::Synth | Self::SynthFx)
    }

    fn fx_gate(self) -> bool {
        self == Self::SynthFx
    }
}

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
    level: IdleLevel,
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
            level: IdleLevel::from_flag(""),
            epoch: 0,
        }
    }

    pub fn level(&self) -> IdleLevel {
        self.level
    }

    /// Changing the rules wakes everything: a chain asleep under one level has
    /// no standing under another, and the render path has to re-apply external
    /// FX mode anyway.
    pub fn set_level(&mut self, level: IdleLevel) {
        if self.level == level {
            return;
        }
        self.level = level;
        self.wake_all();
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
        if !self.level.splits() {
            // One render_block call, which does the FX itself.
            return Work { synth: true, fx: false };
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
        if self.level.synth_gate() && work.synth {
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

        if !self.level.fx_gate() {
            return;
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

    fn gate(level: IdleLevel) -> IdleGate {
        let mut g = IdleGate::new(CHAINS);
        g.set_level(level);
        g
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
        let mut g = gate(IdleLevel::Synth);
        assert!(silent_blocks(&mut g, 343).synth, "343 silent blocks is not yet a second");
        let mut g = gate(IdleLevel::Synth);
        assert!(!silent_blocks(&mut g, 344).synth, "the 344th silent block puts it to sleep");
    }

    #[test]
    fn one_loud_block_resets_the_count() {
        let mut g = gate(IdleLevel::Synth);
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
        let mut g = gate(IdleLevel::Synth);
        for _ in 0..344 {
            let w = g.plan(0);
            g.observe(0, w, SILENCE_LEVEL, SILENCE_LEVEL, false);
        }
        assert!(!g.plan(0).synth, "a peak at the threshold counts as silence");

        let mut g = gate(IdleLevel::Synth);
        for _ in 0..344 {
            let w = g.plan(0);
            g.observe(0, w, SILENCE_LEVEL + 1, 0, false);
        }
        assert!(g.plan(0).synth, "one count above the threshold is sound");
    }

    #[test]
    fn midi_wakes_it_on_that_block() {
        let mut g = gate(IdleLevel::Synth);
        assert!(!silent_blocks(&mut g, 344).synth);
        g.wake(0);
        assert!(g.plan(0).synth, "a woken chain renders on the very next block");
    }

    #[test]
    fn a_sleeping_synth_probes_once_in_172_blocks() {
        let mut g = gate(IdleLevel::Synth);
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
        let mut g = gate(IdleLevel::Synth);
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
        let mut g = gate(IdleLevel::SynthFx);
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
        let mut g = gate(IdleLevel::SynthFx);
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
        let mut g = gate(IdleLevel::SynthFx);
        for _ in 0..344 * 3 {
            let w = g.plan(0);
            g.observe(0, w, 0, 0, true);
        }
        let w = g.plan(0);
        assert!(w.fx, "a looper's FX must keep running through silence");
        assert!(!g.deep_asleep(0));
    }

    #[test]
    fn level_off_renders_everything_every_block_and_does_not_split() {
        let mut g = gate(IdleLevel::Off);
        for _ in 0..1000 {
            let w = g.plan(0);
            assert!(w.synth, "chidle 0 always renders");
            assert!(!w.fx, "chidle 0 does not run FX separately — render_block does it");
            g.observe(0, w, 0, 0, false);
        }
        assert!(!IdleLevel::Off.splits());
    }

    #[test]
    fn level_split_renders_everything_every_block_but_does_split() {
        let mut g = gate(IdleLevel::Split);
        for _ in 0..1000 {
            let w = g.plan(0);
            assert!(w.synth && w.fx, "the equivalence arm never sleeps");
            g.observe(0, w, 0, 0, false);
        }
        assert!(IdleLevel::Split.splits());
    }

    #[test]
    fn changing_the_level_wakes_everything() {
        let mut g = gate(IdleLevel::SynthFx);
        for _ in 0..344 * 2 {
            let w = g.plan(0);
            g.observe(0, w, 0, 0, false);
        }
        assert!(g.deep_asleep(0));
        g.set_level(IdleLevel::Synth);
        assert!(!g.deep_asleep(0), "a level change may not leave a chain asleep under new rules");
        assert!(g.plan(0).synth);
    }

    #[test]
    fn the_epoch_moves_only_on_a_sleep_or_wake_transition() {
        let mut g = gate(IdleLevel::Synth);
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

    #[test]
    fn flag_values_map_to_levels() {
        assert_eq!(IdleLevel::from_flag("0"), IdleLevel::Off);
        assert_eq!(IdleLevel::from_flag("1"), IdleLevel::Split);
        assert_eq!(IdleLevel::from_flag("2"), IdleLevel::Synth);
        assert_eq!(IdleLevel::from_flag("3"), IdleLevel::SynthFx);
        assert_eq!(IdleLevel::from_flag(""), IdleLevel::SynthFx, "an empty write keeps the default");
        assert_eq!(IdleLevel::from_flag("banana"), IdleLevel::SynthFx, "a typo must not silently disable it");
    }
}
