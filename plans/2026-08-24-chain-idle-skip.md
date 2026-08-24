# Chain idle-skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rendering movy chains that are making no sound, splitting the synth from the FX so a ringing reverb cannot pin an expensive synth awake.

**Architecture:** A pure state machine (`chain_idle.rs`) decides, per chain per block, whether the synth renders and whether the FX runs. `chain_slots.rs` obeys it in both the serial and parallel paths. The split itself comes from three symbols the chain module already exports; movy dlsyms them from the handle it already has.

**Spec:** `docs/superpowers/specs/2026-08-24-chain-idle-skip-design.md`

**Tech Stack:** Rust (`engine/crates/movy-dsp`), TypeScript (`src/seq/`), cargo tests, `browser-test/*.mjs`, device scripts under `scripts/`.

## Global Constraints

- **Nothing allocates on the audio thread.** `ChainInstance::set_param` builds two `CString`s per call; the per-block tick path must not use it.
- **Serial and parallel must produce the same samples.** Any decision that differs between the two paths is a bug, not a tuning choice.
- **A chain that did not render this block is not mixed this block.**
- **`chidle 0` must be byte-for-byte today's behaviour** — a single `render_block` call, external FX mode off.
- Constants are the shim's, cited to `schwung_shim.c:643-645`: `SLEEP_AFTER = 344`, `SILENCE_LEVEL = 4`, `PROBE_PERIOD = 172`. The stagger is **14**, not the shim's 43 — see Task 1 Step 1.
- Rust edition 2021. Use `b"...\0"` byte literals rather than `c"..."` so the cross toolchain's version cannot matter.
- Engine changes require bumping `ENGINE_VERSION` in `engine/crates/movy-dsp/src/lib.rs` **and** `src/seq/constants.ts` together — `build-dsp.sh` fails the build otherwise.

## File Structure

| File | Responsibility |
| --- | --- |
| `engine/crates/movy-dsp/src/chain_idle.rs` | **new** — the state machine. No chain, host or FFI types. |
| `engine/crates/movy-dsp/src/chain_host.rs` | retain the dlopen handle, resolve the FX trio, `mod_tick`, `raw_parts` |
| `engine/crates/movy-dsp/src/render_pool.rs` | `Task` carries optional render + optional FX; zero-fill when the synth sleeps |
| `engine/crates/movy-dsp/src/chain_slots.rs` | the render path: decide, render, observe, mix |
| `engine/crates/movy-dsp/src/lib.rs` | `chidle` engine param, `asleep=` in `diag`/`status` |
| `src/seq/flags-def.ts` | the `chidle` row on the Global Params page |

---

### Task 1: The idle state machine

**Files:**
- Create: `engine/crates/movy-dsp/src/chain_idle.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` (add `mod chain_idle;` beside the other `mod` lines)

**Interfaces:**
- Consumes: nothing.
- Produces: `IdleLevel::{Off,Split,Synth,SynthFx}`, `IdleLevel::from_flag(&str) -> IdleLevel`, `IdleLevel::splits(self) -> bool`; `Work { synth: bool, fx: bool }` with `Work::none(self) -> bool`; `IdleGate::new(chains: usize)`, `set_level(&mut self, IdleLevel)`, `level(&self) -> IdleLevel`, `plan(&mut self, chain: usize) -> Work`, `observe(&mut self, chain: usize, work: Work, synth_peak: i32, fx_peak: i32, fx_keep_alive: bool)`, `wake(&mut self, chain: usize)`, `wake_all(&mut self)`, `forget(&mut self, chain: usize)`, `deep_asleep(&self, chain: usize) -> bool`, `asleep_count(&self) -> usize`, `epoch(&self) -> u32`.

- [ ] **Step 1: Write the failing tests**

Create `engine/crates/movy-dsp/src/chain_idle.rs` containing only the test module below plus `use super::*;`. It will not compile yet — that is the point.

```rust
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_idle`
Expected: FAIL — `cannot find type IdleGate in this scope` and similar.

- [ ] **Step 3: Write the implementation**

Put this ABOVE the `#[cfg(test)]` module in `chain_idle.rs`:

```rust
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
```

Then add `mod chain_idle;` to `engine/crates/movy-dsp/src/lib.rs` alongside the existing `mod chain_host;` / `mod chain_pin;` lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_idle`
Expected: PASS, 13 tests.

- [ ] **Step 5: Prove the stagger test has teeth**

Change `PROBE_STAGGER` to `43` and re-run.
Expected: `twelve_sleeping_chains_never_probe_on_the_same_block` FAILS with a `per_block` vector containing a 3. Change it back to `14` and confirm green again.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/chain_idle.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "chain idle: the state machine, with the shim's constants and its own stagger"
```

---

### Task 2: The FX trio and a tick that does not allocate

**Files:**
- Modify: `engine/crates/movy-dsp/src/chain_host.rs:131-133` (`ChainHost`), `:152-205` (`load`), `:209-218` (`create_instance`), `:231-238` (`ChainInstance`), `:240-292` (impl)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `pub type FxFn = unsafe extern "C" fn(*mut c_void, *mut i16, c_int);`; `ChainInstance::supports_split(&self) -> bool`, `set_external_fx_mode(&mut self, on: bool)`, `process_fx(&mut self, buf: &mut [i16])`, `fx_requires_continuous(&mut self) -> bool`, `mod_tick(&mut self)`, `raw_parts(&mut self) -> (*mut c_void, Option<RenderFn>, Option<FxFn>)`.

- [ ] **Step 1: Write the failing test**

Add to the existing `#[cfg(test)] mod tests` in `chain_host.rs` (create the module if there is none):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// The host build has no chain module to dlopen, so this is the degraded
    /// path — the one that must never crash, because movy still has to sequence
    /// its four schwung tracks when chain hosting is unavailable.
    #[test]
    fn a_missing_chain_module_reports_no_split_support() {
        let err = ChainHost::load("/nonexistent/chain.so").unwrap_err();
        assert!(err.contains("dlopen"), "{err}");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_host`
Expected: FAIL to compile if no test module existed, or PASS trivially. If it passes, that is fine — it is a guard, and the real verification for this task is Step 4's compile plus the device run in Task 7. Do not invent a mock dlopen for it.

- [ ] **Step 3: Write the implementation**

Add the FFI types next to `RenderFn` at the bottom of the file:

```rust
/// `chain_process_fx`, and `chain_set_external_fx_mode` / `chain_fx_requires_continuous`
/// beside it. These are plain exported symbols on the chain module, NOT part of
/// `plugin_api_v2_t` — the shim resolves the same three by name.
pub type FxFn = unsafe extern "C" fn(*mut c_void, *mut i16, c_int);
type FxModeFn = unsafe extern "C" fn(*mut c_void, c_int);
type FxContinuousFn = unsafe extern "C" fn(*mut c_void) -> c_int;

/// The split-render entry points, all three or none. A chain module without
/// them is not an error: movy falls back to one `render_block` call and the FX
/// gate is simply unavailable.
#[derive(Clone, Copy, Default)]
pub struct ChainFxApi {
    set_external_fx_mode: Option<FxModeFn>,
    process_fx: Option<FxFn>,
    requires_continuous: Option<FxContinuousFn>,
}

impl ChainFxApi {
    fn complete(&self) -> bool {
        self.set_external_fx_mode.is_some()
            && self.process_fx.is_some()
            && self.requires_continuous.is_some()
    }
}
```

Change `ChainHost` to keep the handle and the trio:

```rust
pub struct ChainHost {
    api: &'static plugin_api_v2_t,
    fx: ChainFxApi,
}
```

In `ChainHost::load`, after the `for (name, present)` loop and before the final `host::log`, resolve them from the handle that is already open:

```rust
        // Resolved by name from the same handle, because they are exported
        // symbols rather than vtable entries. Missing symbols mean an older
        // chain module: movy degrades to one render_block call rather than
        // refusing to host chains at all.
        let mut fx = ChainFxApi::default();
        unsafe {
            let mode = CString::new("chain_set_external_fx_mode").unwrap();
            let proc_ = CString::new("chain_process_fx").unwrap();
            let cont = CString::new("chain_fx_requires_continuous").unwrap();
            let m = dlsym(handle, mode.as_ptr());
            let p = dlsym(handle, proc_.as_ptr());
            let c = dlsym(handle, cont.as_ptr());
            if !m.is_null() { fx.set_external_fx_mode = Some(core::mem::transmute(m)); }
            if !p.is_null() { fx.process_fx = Some(core::mem::transmute(p)); }
            if !c.is_null() { fx.requires_continuous = Some(core::mem::transmute(c)); }
        }
        if !fx.complete() {
            host::log("chain host exports no split render — idle skip limited to whole chains");
        }
```

Change the final line to `Ok(Self { api, fx })`, and `create_instance`'s constructor to
`Some(ChainInstance { inst, api: self.api, fx: self.fx, scratch: vec![0u8; PARAM_BUF] })`.

Add `fx: ChainFxApi,` to `ChainInstance`'s fields, then these methods to its impl:

```rust
    /// Whether this chain can render its synth and FX as two calls.
    pub fn supports_split(&self) -> bool {
        self.fx.complete()
    }

    /// In external FX mode `render_block` returns straight after the synth
    /// (`chain_host.c:1960`), and the caller owes `process_fx` a buffer.
    pub fn set_external_fx_mode(&mut self, on: bool) {
        if let Some(f) = self.fx.set_external_fx_mode {
            unsafe { f(self.inst, on as c_int) };
        }
    }

    pub fn process_fx(&mut self, buf: &mut [i16]) {
        if let Some(f) = self.fx.process_fx {
            unsafe { f(self.inst, buf.as_mut_ptr(), (buf.len() / 2) as c_int) };
        }
    }

    /// 1 when any FX slot declared `capabilities.requires_continuous_processing`
    /// — loopers and modulated delays, whose state stops advancing if skipped.
    pub fn fx_requires_continuous(&mut self) -> bool {
        match self.fx.requires_continuous {
            Some(f) => unsafe { f(self.inst) } != 0,
            None => false,
        }
    }

    /// Advance the chain's LFOs without rendering audio.
    ///
    /// `lfo_tick` normally runs inside `render_block`, so a skipped block ran a
    /// sleeping chain's LFOs 172x too slow and resumed them from a stale phase
    /// at note-on. `chain_host.c:709` exists for exactly this.
    ///
    /// NOT `set_param`: that builds two `CString`s, and this runs on the audio
    /// thread once per block for every sleeping chain. Byte literals with their
    /// own NUL are `'static` and allocate nothing.
    pub fn mod_tick(&mut self) {
        const KEY: &[u8] = b"mod:tick\0";
        const VAL: &[u8] = b"128\0";
        if let Some(f) = self.api.set_param {
            unsafe { f(self.inst, KEY.as_ptr() as *const c_char, VAL.as_ptr() as *const c_char) };
        }
    }

    /// Instance pointer and both entry points, for the pool to call from a
    /// helper thread. The instance comes back even when the synth is asleep:
    /// the lane still owes it a zeroed buffer and possibly an FX pass.
    pub fn raw_parts(&mut self) -> (*mut c_void, Option<RenderFn>, Option<FxFn>) {
        (self.inst, self.api.render_block, self.fx.process_fx)
    }
```

- [ ] **Step 4: Build and run the suite**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp`
Expected: PASS, no new failures. If `c_char` is unresolved, add it to the existing `use core::ffi::{...}` line.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/movy-dsp/src/chain_host.rs
git commit -m "chain host: resolve the split-render trio, tick LFOs without allocating"
```

---

### Task 3: The pool renders a chain in two stages

**Files:**
- Modify: `engine/crates/movy-dsp/src/render_pool.rs:31-38` (`Task`), `:226-240` (`run`), `:395-404` (test helper `tasks`)

**Interfaces:**
- Consumes: `FxFn` from Task 2.
- Produces: `Task { render: Option<RenderFn>, process_fx: Option<FxFn>, inst, buf, frames, chain }`; `RenderPool::synth_peak(&self, chain: usize) -> i32`.

- [ ] **Step 1: Write the failing tests**

Add to `render_pool.rs`'s test module:

```rust
    /// A sleeping synth still owes its FX a block of SILENCE. Handing the FX
    /// whatever the previous block left in the buffer is a stuck buzz, not a
    /// decaying tail — and it is the failure mode this whole split invites.
    #[test]
    fn a_task_with_no_render_hands_the_fx_a_zeroed_buffer() {
        unsafe extern "C" fn assert_zero_then_mark(_i: *mut c_void, buf: *mut i16, frames: i32) {
            let n = (frames as usize) * 2;
            for k in 0..n {
                assert_eq!(unsafe { *buf.add(k) }, 0, "FX must see silence, not the last block");
            }
            unsafe { *buf = 99 };
        }
        let pool = RenderPool::new(1, CHAINS);
        let mut b = bufs();
        b[0] = [7, 7, 7, 7];
        let lanes = vec![vec![Task {
            render: None,
            process_fx: Some(assert_zero_then_mark),
            inst: 1 as *mut c_void,
            buf: b[0].as_mut_ptr(),
            frames: (BLOCK / 2) as i32,
            chain: 0,
        }]];
        pool.render_block(&lanes);
        assert_eq!(b[0][0], 99, "the FX ran");
    }

    #[test]
    fn the_synth_peak_is_measured_before_the_fx_runs() {
        unsafe extern "C" fn quiet_synth(_i: *mut c_void, buf: *mut i16, _f: i32) {
            unsafe { *buf = 3 };
        }
        unsafe extern "C" fn loud_fx(_i: *mut c_void, buf: *mut i16, _f: i32) {
            unsafe { *buf = 30000 };
        }
        let pool = RenderPool::new(1, CHAINS);
        let mut b = bufs();
        let lanes = vec![vec![Task {
            render: Some(quiet_synth),
            process_fx: Some(loud_fx),
            inst: 1 as *mut c_void,
            buf: b[0].as_mut_ptr(),
            frames: (BLOCK / 2) as i32,
            chain: 0,
        }]];
        pool.render_block(&lanes);
        assert_eq!(pool.synth_peak(0), 3, "a loud FX may not hide a silent synth");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp render_pool`
Expected: FAIL — `Task` has no field `process_fx`, `render` is not an `Option`.

- [ ] **Step 3: Write the implementation**

Replace `Task` with:

```rust
pub struct Task {
    /// `None` when the chain's synth is asleep. The lane zeroes `buf` instead —
    /// `process_fx` must decay a tail into silence, not into whatever the last
    /// block left behind.
    pub render: Option<unsafe extern "C" fn(*mut c_void, *mut i16, i32)>,
    /// `None` when the FX is asleep, or when the chain is not being split at
    /// all and `render` already did the FX itself.
    pub process_fx: Option<unsafe extern "C" fn(*mut c_void, *mut i16, i32)>,
    pub inst: *mut c_void,
    pub buf: *mut i16,
    pub frames: i32,
    pub chain: usize,
}
```

Add a peak array to `Shared` beside `cost_ns` — mirror however `cost_ns` is declared and constructed, as `synth_peak: Vec<AtomicI32>` initialised to `0`, and add `use std::sync::atomic::AtomicI32;`.

Replace `run`:

```rust
fn run(tasks: &[Task], shared: &Shared) {
    for t in tasks {
        let t0 = Instant::now();
        // Anything the module sends from inside this call is parked against
        // `t.chain` and replayed on the audio thread after the join — schwung's
        // MIDI-out senders are single-producer. See `midi_out`.
        let _scope = crate::midi_out::Scope::enter(t.chain);
        let samples = (t.frames as usize) * 2;
        // Safe by the partition argument on `Shared`: this lane owns `inst` and
        // `buf` for the duration of the round.
        unsafe {
            match t.render {
                Some(f) => f(t.inst, t.buf, t.frames),
                None => core::ptr::write_bytes(t.buf, 0, samples),
            }
        }
        // Measured HERE, between the two stages: the synth gate must not be
        // fooled by an FX that never settles.
        if let Some(p) = shared.synth_peak.get(t.chain) {
            let mut peak = 0i32;
            for k in 0..samples {
                let s = unsafe { *t.buf.add(k) } as i32;
                peak = peak.max(s.abs());
            }
            p.store(peak, Ordering::Relaxed);
        }
        if let Some(f) = t.process_fx {
            unsafe { f(t.inst, t.buf, t.frames) };
        }
        if let Some(c) = shared.cost_ns.get(t.chain) {
            c.store(t0.elapsed().as_nanos() as u64, Ordering::Relaxed);
        }
    }
}
```

Add the accessor beside `cost_ns`:

```rust
    /// The chain's output peak after the synth stage and before the FX.
    pub fn synth_peak(&self, chain: usize) -> i32 {
        self.shared.synth_peak.get(chain).map_or(0, |p| p.load(Ordering::Relaxed))
    }
```

Update the existing test helper so the old tests still compile:

```rust
    fn tasks(bufs: &mut [[i16; BLOCK]], range: std::ops::Range<usize>) -> Vec<Task> {
        range
            .map(|c| Task {
                render: Some(fill),
                process_fx: None,
                inst: (c + 1) as *mut c_void,
                buf: bufs[c].as_mut_ptr(),
                frames: (BLOCK / 2) as i32,
                chain: c,
            })
            .collect()
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp render_pool`
Expected: PASS, including the pre-existing pool tests unchanged.

> `render_pool.rs` has a known flaky test (`midi_out::QUEUE` race, pre-existing — see `plans/2026-08-23-flags-page-and-iso-revert.md`). If a failure names `QUEUE`, re-run before treating it as yours.

- [ ] **Step 5: Prove the zero-fill test has teeth**

Replace the `None => core::ptr::write_bytes(...)` arm with `None => {}` and re-run.
Expected: `a_task_with_no_render_hands_the_fx_a_zeroed_buffer` FAILS on the `assert_eq!(*buf.add(k), 0)`. Restore the memset.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/render_pool.rs
git commit -m "render pool: two-stage tasks, and a synth peak taken between them"
```

---

### Task 4: The render path obeys the gate

**Files:**
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs` — fields (`:52-126`), `new` (`:128-155`), `service_loads` (`:334-376`), `set_param` (`:394-401`), `on_midi` (`:414-421`), `set_state` (`:380-390`), `set_mix` (`:407-411`), `render` (`:428-489`), `render_serial` (`:520-536`), `render_parallel` (`:538-574`), `maybe_replan` (`:578-589`), `teardown` (`:606-619`)

**Interfaces:**
- Consumes: `IdleGate`, `IdleLevel`, `Work` (Task 1); `ChainInstance::{supports_split, set_external_fx_mode, process_fx, fx_requires_continuous, mod_tick, raw_parts}` (Task 2); `Task { render, process_fx, .. }`, `RenderPool::synth_peak` (Task 3).
- Produces: `ChainSlots::set_idle_level(&mut self, IdleLevel)`, `ChainSlots::asleep_count(&self) -> usize`.

- [ ] **Step 1: Write the failing tests**

Add to `chain_slots.rs`'s test module. These run on the host with no chain host, so they pin the decisions rather than the audio — which is all that is decidable without a device.

```rust
    /// The whole point, stated as a property: nothing that skipped its render
    /// may reach the mix, because its scratch buffer holds a stale block.
    #[test]
    fn a_chain_that_did_not_render_is_not_mixed() {
        let mut slots = ChainSlots::new();
        let mut out = vec![1234i16; SCRATCH_SAMPLES];
        // No host, so nothing is loaded and nothing can render.
        slots.render(&mut out);
        assert!(out.iter().all(|&s| s == 1234));
    }

    #[test]
    fn the_idle_level_survives_a_round_trip() {
        let mut slots = ChainSlots::new();
        slots.set_idle_level(IdleLevel::Off);
        assert_eq!(slots.idle_level(), IdleLevel::Off);
        slots.set_idle_level(IdleLevel::SynthFx);
        assert_eq!(slots.idle_level(), IdleLevel::SynthFx);
        assert_eq!(slots.asleep_count(), 0, "nothing is loaded, so nothing sleeps");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_slots`
Expected: FAIL — `no method named set_idle_level`.

- [ ] **Step 3: Write the implementation**

Add to the `use` block: `use crate::chain_idle::{IdleGate, IdleLevel, Work};`

Add fields to `ChainSlots`:

```rust
    /// Which chains may skip work this block. See `chain_idle`.
    idle: IdleGate,
    /// This block's decision per chain, taken once before anything renders —
    /// the parallel path builds its whole task list up front, so serial and
    /// parallel must be reading the same answer.
    work: Vec<Work>,
    /// Each chain's peak after its synth stage and before its FX. Written by
    /// whichever lane rendered it; the parallel path copies it back after the
    /// join, exactly as it already does for cost.
    synth_peak: Vec<i32>,
    /// The `idle` epoch the current lane plan was built for.
    plan_idle_epoch: u32,
```

And to `new()`:

```rust
            idle: IdleGate::new(MOVY_CHAINS),
            work: vec![Work::NONE; MOVY_CHAINS],
            synth_peak: vec![0; MOVY_CHAINS],
            plan_idle_epoch: u32::MAX,
```

Add the level accessors:

```rust
    pub fn idle_level(&self) -> IdleLevel {
        self.idle.level()
    }

    /// Changing the level re-applies external FX mode to every live chain: the
    /// mode is a property of the instance, and a chain loaded under one level
    /// would otherwise keep rendering under the old contract.
    pub fn set_idle_level(&mut self, level: IdleLevel) {
        if self.idle.level() == level {
            return;
        }
        self.idle.set_level(level);
        let split = level.splits();
        for s in self.slots.iter_mut().flatten() {
            let want = split && s.supports_split();
            s.set_external_fx_mode(want);
        }
        self.plan_generation = u32::MAX;
        host::log(&format!("chain idle: level {level:?}"));
    }

    pub fn asleep_count(&self) -> usize {
        self.idle.asleep_count()
    }
```

Wake at every site that can restart sound. In `on_midi`, immediately after the
`slot >= MOVY_CHAINS` guard: `self.idle.wake(slot);`. Same first line in
`set_param`, `set_state` and `set_mix`. In `service_loads`, after
`self.generation = self.generation.wrapping_add(1);` add:

```rust
        self.idle.wake(req.slot);
        /* A freshly created instance is in whatever FX mode the module defaults
         * to. Claim it here, once, rather than per block. */
        if let Some(inst) = self.slots[req.slot].as_mut() {
            let split = self.idle.level().splits() && inst.supports_split();
            inst.set_external_fx_mode(split);
        }
```

In `teardown`, inside the loop that clears slots, call `self.idle.forget(i)` for
every index (change it to `for i in 0..MOVY_CHAINS { self.slots[i] = None; self.idle.forget(i); }`).

Now the render path. Replace `render`'s body between the `digest.open_block()`
block and `self.cost.end_block()` with:

```rust
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
                Work { synth: true, fx: self.idle.level().splits() }
            } else {
                self.idle.plan(i)
            };
        }
        // LFOs still have to advance on the audio thread for every chain whose
        // synth did not render — see `ChainInstance::mod_tick`.
        if self.idle.level().splits() {
            for i in 0..MOVY_CHAINS {
                if !self.work[i].synth {
                    if let Some(inst) = self.slots[i].as_mut() {
                        inst.mod_tick();
                    }
                }
            }
        }

        let t0 = self.cost.start();
        let active = if self.parallel_ready() {
            self.render_parallel(frames)
        } else {
            self.render_serial(frames)
        };
        if active > 0 {
            self.cost.add_wall(t0.elapsed().as_nanos() as u64);
        }
        crate::midi_out::QUEUE.drain(crate::chain_host::send_direct);

        for i in 0..MOVY_CHAINS {
            if self.slots[i].is_none() {
                continue;
            }
            let w = self.work[i];
            if w.none() {
                // Nothing ran, so the scratch holds a stale block. Not mixed,
                // and its peak is the truth about this block: silence.
                self.peaks[i] = 0;
                continue;
            }
            let scratch = &self.scratch[i][..frames];
            let peak = scratch.iter().fold(0i32, |m, &s| m.max((s as i32).abs()));
            self.peaks[i] = peak;
            if digesting {
                self.digest.fold(i, scratch, peak);
            }
            if !self.audible[i] && peak > 0 {
                self.audible[i] = true;
                host::log(&format!("chain {}: audio active (peak {})", i, peak));
            }
            mix_into(&mut out[..frames], scratch, &self.mixes[i]);
        }
        // Folded back after the mix so the borrow of `scratch` is done with.
        for i in 0..MOVY_CHAINS {
            let w = self.work[i];
            if w.none() {
                continue;
            }
            let keep_alive = w.fx
                && self.slots[i].as_mut().is_some_and(|s| s.fx_requires_continuous());
            self.idle.observe(i, w, self.synth_peak[i], self.peaks[i], keep_alive);
        }
        if active > 0 {
            self.cost.end_block();
        }
```

**Keep the two statements that follow** — `self.active_last_block = active;` and
the `self.digest.close_block()` block. They are outside the replaced range.

> **What this step does not cover.** `render_serial`'s `fill(0)` has no host
> test: building a `ChainInstance` needs a real chain module, and there is none
> on the host. Its parallel twin IS pinned, by Task 3 Step 5. The serial path is
> covered by the reverb-tail check in Task 6 Step 4, and by keeping the two
> branches readable side by side. Do not invent a mock chain host for it.

Replace `render_serial`:

```rust
    fn render_serial(&mut self, frames: usize) -> usize {
        let mut active = 0usize;
        let split = self.idle.level().splits();
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
            if split {
                self.synth_peak[i] = self.scratch[i][..frames]
                    .iter()
                    .fold(0i32, |m, &s| m.max((s as i32).abs()));
            }
            if w.fx {
                inst.process_fx(&mut self.scratch[i][..frames]);
            }
            drop(scope);
            self.cost.stop(t0, i);
        }
        active
    }
```

In `render_parallel`, replace the task-building inner body with:

```rust
                let c = self.planner.lanes[lane][idx];
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
                    // A module with no render_block and nothing to process:
                    // the same slot the old code skipped outright.
                    continue;
                }
                active += 1;
                self.lanes[lane].push(Task {
                    render,
                    process_fx: fx,
                    inst: ptr,
                    buf: self.scratch[c].as_mut_ptr(),
                    frames: (frames / 2) as i32,
                    chain: c,
                });
```

and extend the post-join copy-back to bring the peaks home too:

```rust
            for c in 0..MOVY_CHAINS {
                if self.slots[c].is_some() {
                    self.cost.add_ns(c, pool.cost_ns(c));
                    self.synth_peak[c] = pool.synth_peak(c);
                }
            }
```

Finally, in `maybe_replan`, partition by what is actually rendering:

```rust
    fn maybe_replan(&mut self) {
        self.blocks_since_plan += 1;
        if self.plan_generation == self.generation
            && self.plan_idle_epoch == self.idle.epoch()
            && self.blocks_since_plan < REPLAN_BLOCKS
        {
            return;
        }
        self.plan_generation = self.generation;
        self.plan_idle_epoch = self.idle.epoch();
        self.blocks_since_plan = 0;
        for (i, s) in self.slots.iter().enumerate() {
            // A deep-asleep chain is not work, and a partition that counts it
            // can put every SOUNDING chain on one lane.
            self.loaded[i] = s.is_some() && !self.idle.deep_asleep(i);
        }
        self.planner.plan(self.pin.pin_keys(), self.cost.plan_ns(), &self.loaded);
    }
```

- [ ] **Step 4: Run the whole engine suite**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test`
Expected: PASS, including `renders_nothing_when_empty` and the digest tests.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/movy-dsp/src/chain_slots.rs
git commit -m "chain slots: split the render, and skip what is silent"
```

---

### Task 5: The flag, end to end

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs` (the `set_param` match beside `"chpin"`, the `"status"` and `"diag"` arms, `ENGINE_VERSION`)
- Modify: `src/seq/flags-def.ts:23-40` (the `FLAGS` table)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)

**Interfaces:**
- Consumes: `ChainSlots::set_idle_level`, `ChainSlots::asleep_count` (Task 4); `IdleLevel::from_flag` (Task 1).
- Produces: engine param `chidle`, `chasleep=` in `status`, `asleep=` in `diag`.

- [ ] **Step 1: Add the engine param**

In `lib.rs`'s param match, directly after the `"chpin"` arm:

```rust
            /* `chidle <0|1|2|3>` — skip work for chains that are making no
             * sound. An ordinal because the FX gate depends on the synth gate:
             * 0 is today's single render_block call, 1 splits synth from FX but
             * never sleeps (the arm chdigest compares against 0), 2 sleeps a
             * silent synth, 3 also sleeps a silent FX tail. Default 3 — unlike
             * chparallel this is meant to be on. */
            "chidle" => {
                self.chains.set_idle_level(chain_idle::IdleLevel::from_flag(val));
            }
```

Add `use crate::chain_idle;` if the file addresses its modules that way, or
reference it as `crate::chain_idle::IdleLevel::from_flag(val)` to match the
surrounding style.

- [ ] **Step 2: Report it**

In the `"status"` arm, extend the existing push:

```rust
                s.push_str(&format!(" chgen={} chact={} chslp={}",
                    self.chains.generation(), self.chains.active_count(),
                    self.chains.asleep_count()));
```

In the `"diag"` arm:

```rust
            "diag" => Some(format!(
                "blocks={} out_cap={} chains={} pending={} active={} asleep={}",
                self.blocks,
                self.out.capacity(),
                self.chains.is_available() as u8,
                self.chains.pending_loads(),
                self.chains.active_count(),
                self.chains.asleep_count()
            )),
```

- [ ] **Step 3: Bump the engine version**

Increment `ENGINE_VERSION` in `engine/crates/movy-dsp/src/lib.rs` and set the
identical value in `src/seq/constants.ts`. They must match or `build-dsp.sh`
fails the build.

- [ ] **Step 4: Add the flag row**

In `src/seq/flags-def.ts`, append to `FLAGS`:

```typescript
    {
        key: 'chidle', name: 'Idle Skip',
        // An ordinal, not a bool: the FX gate depends on the synth gate.
        // 0 one render_block call (today) · 1 split, never sleeps (the arm
        // chdigest compares against 0) · 2 sleep a silent synth · 3 also sleep
        // a silent FX tail.
        min: 0, max: 3, def: 3,
    },
```

- [ ] **Step 5: Run the local suites**

Run: `npm test`
Expected: PASS. The Global Params page now has a fourth row, so
`browser-test/screenshot.mjs` will diff. Inspect the diff, confirm it is only
the new row, then run `node browser-test/screenshot.mjs --update` and re-run
`npm test`.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/lib.rs src/seq/flags-def.ts src/seq/constants.ts browser-test/screenshots/baseline
git commit -m "chidle: the flag, the report, and the page row"
```

---

### Task 6: Device verification

**Files:**
- Modify: `docs/chain-idle-cpu-optimization.md` (it says "documented, not implemented")
- Modify: `MANUAL.md` if it documents the Global Params page rows

**Interfaces:** none — this task ships no code.

- [ ] **Step 1: Deploy**

Run: `./scripts/deploy.sh`
Expected: builds `ui.js` and `dsp.so`, deploys both. If `move.local` is
unreachable, **report DEVICE OFFLINE to the user in CAPS** and stop this task.

- [ ] **Step 2: Prove the split changes no samples**

The equivalence arm exists for this. Engine params go over the WebSocket on port
7700, not ssh — `scripts/engine-param.mjs`, the same path `scripts/lib/chain-bench.sh`
wraps as `ep`. With a set loaded and chains sounding:

```bash
H=move.local   # an IP, if your ssh alias does not resolve for the WebSocket too

# arm A: today's path
node scripts/engine-param.mjs set chidle    0  "$H"
node scripts/engine-param.mjs set chdigest  64 "$H"
sleep 2
node scripts/engine-param.mjs set chdigestlog 1 "$H"
ssh ableton@"$H" 'grep "chain digest" /data/UserData/schwung/debug.log | tail -1'

# arm B: split, nothing sleeping
node scripts/engine-param.mjs set chidle    1  "$H"
node scripts/engine-param.mjs set chdigest  64 "$H"
sleep 2
node scripts/engine-param.mjs set chdigestlog 1 "$H"
ssh ableton@"$H" 'grep "chain digest" /data/UserData/schwung/debug.log | tail -1'
```

Expected: identical per-chain digests. A difference here means the split is not
equivalent and Task 4 is wrong — stop and fix before enabling any gate.

`engine-param.mjs` exits non-zero only when it cannot open the socket at all: a
write that reached nothing looks exactly like a write that changed nothing. If
both arms report the same digest *and* the same everything else, confirm the
writes landed before believing the PASS.

> `chdigest` strikes its own chord inside the render, and lane-0-only passes are
> tautological. Read `plans/2026-08-23-parallel-render-prototype.md` before
> interpreting a PASS.

- [ ] **Step 3: Prove a sleeping chain still wakes**

Load a chain with a tempo-synced LFO driving a filter into audibility, leave it
silent past a second, and confirm it speaks. This is what `mod_tick` is for;
without it the LFO advances only on probe blocks and the drone never arrives.

- [ ] **Step 4: Prove tails and loopers survive**

With `chidle 3`: a long reverb tail must decay smoothly rather than cut at ~1 s,
and a looper (any FX declaring `requires_continuous_processing`) must keep its
position through a silent passage.

- [ ] **Step 5: Measure**

Run: `./scripts/bench-all-tracks.sh`
Compare the idle columns at `chidle 0` (control) and `chidle 3`. Expected: the
idle figures collapse toward baseline — `docs/chain-idle-cpu-optimization.md`
predicts twelve idle `helm` chains falling from ~2340 µs.

Record the real numbers in `docs/chain-idle-cpu-optimization.md` and change its
status line from "documented, not implemented" to what shipped.

- [ ] **Step 6: Run the device suites**

Run: `./scripts/test-all-device.sh`
Expected: no new failures. `test-seq.sh` builds and deploys `dsp.so`, so run it
for this change.

- [ ] **Step 7: Commit and push**

```bash
git add docs/chain-idle-cpu-optimization.md MANUAL.md
git commit -m "chain idle: measured on device"
git push
```
