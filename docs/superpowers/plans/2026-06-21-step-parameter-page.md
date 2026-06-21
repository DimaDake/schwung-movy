# Step Parameter Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "step" parameter page — shown only while a step is held (a parameter-lock session) — exposing per-trig velocity, note length, probability, step-condition (A:B), and invert, with probability + conditions actually skipping/playing trigs in the Rust engine.

**Architecture:** The engine (`seq-core`) gains a sparse per-clip `Trig` table keyed `(step, lane)` plus a per-track cycle counter and a PRNG; the scheduler evaluates a per-trig play/skip decision (shared by all notes of a chord) before emitting. The UI adds a virtual page 0 (shown only during `stepAutoMode`), a dotted page-indicator segment, a dedicated step-page ViewModel, and knob routing that edits trig properties instead of chain automation.

**Tech Stack:** Rust (`seq-core`, host-tested with `cargo test`), TypeScript (`src/`, browser tests via `node browser-test/*.mjs`), esbuild bundle to `ui.js` / `dist/esm`.

**Key constants (already in the codebase):** `PPQN=96`, `TICKS_PER_STEP=24`, `STEPS_PER_BAR=16`, `TICKS_PER_BAR=384`. Note-length ticks: `1/32=12, 1/16=24, 1/8=48, 1/4=96, 1/2=192, 1(whole/bar)=384, n=n*384`.

---

## Phase 1 — Engine: data model, logic, commands, status, persistence

### Task 1: `Trig` struct + Clip storage and edit methods

**Files:**
- Modify: `engine/crates/seq-core/src/clip.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `clip.rs`:

```rust
    #[test]
    fn trig_defaults_when_absent() {
        let c = Clip::new();
        let t = c.governing_trig(5, 60);
        assert_eq!((t.prob, t.cond_a, t.cond_b, t.invert), (100, 1, 1, false));
    }

    #[test]
    fn set_and_read_trig_props_over_range() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 3, None, 50);
        c.set_trig_cond(0, 3, None, 2, 4);
        c.set_trig_invert(0, 3, None, true);
        let t = c.governing_trig(2, 60);
        assert_eq!((t.prob, t.cond_a, t.cond_b, t.invert), (50, 2, 4, true));
        // Out of range untouched.
        let u = c.governing_trig(9, 60);
        assert_eq!((u.prob, u.cond_a, u.cond_b, u.invert), (100, 1, 1, false));
    }

    #[test]
    fn drum_lane_trig_is_pitch_specific() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 0, Some(36), 25);   // only pad 36
        assert_eq!(c.governing_trig(0, 36).prob, 25);
        assert_eq!(c.governing_trig(0, 38).prob, 100); // other pad = default
    }

    #[test]
    fn lane_specific_trig_overrides_step_wide() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 0, None, 80);       // whole step
        c.set_trig_prob(0, 0, Some(36), 10);   // pad 36 more specific
        assert_eq!(c.governing_trig(0, 36).prob, 10);
        assert_eq!(c.governing_trig(0, 38).prob, 80);
    }

    #[test]
    fn trig_pruned_when_back_to_defaults() {
        let mut c = Clip::new();
        c.set_trig_prob(0, 0, None, 50);
        assert_eq!(c.trigs.len(), 1);
        c.set_trig_prob(0, 0, None, 100); // back to default → pruned
        assert!(c.trigs.is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p seq-core trig`
Expected: FAIL — `governing_trig`, `set_trig_prob`, etc. not found.

- [ ] **Step 3: Implement the `Trig` type, storage, and methods**

In `clip.rs`, after the `Lock` definition (around line 40) add:

```rust
/// Max trig-condition/probability entries per clip.
pub const MAX_TRIGS: usize = 1024;

/// Resolved per-trig properties (defaults when no row exists).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrigProps {
    pub prob: u8,   // 0..=100 (%)
    pub cond_a: u8, // A in A:B (>=1)
    pub cond_b: u8, // B in A:B (>=1)
    pub invert: bool,
}

impl TrigProps {
    pub const DEFAULT: TrigProps = TrigProps { prob: 100, cond_a: 1, cond_b: 1, invert: false };
    fn is_default(&self) -> bool { *self == TrigProps::DEFAULT }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Trig {
    pub step: u16,
    /// Some(pitch) = drum lane, None = melodic (whole step). Mirrors note_matches.
    pub lane: Option<u8>,
    pub props: TrigProps,
}
```

Add `pub trigs: Vec<Trig>,` to the `Clip` struct (after `locks`). Add `trigs: Vec::new(),` to both `Clip::new()` and any other initializer. Add `self.trigs.clear();` to `Clip::clear()`.

Then add these methods to `impl Clip` (near the lock methods):

```rust
    /// Resolved trig props for a note at (step, pitch): the most specific row
    /// wins — a (step, Some(pitch)) row, else a (step, None) row, else defaults.
    pub fn governing_trig(&self, step: u16, pitch: u8) -> TrigProps {
        let specific = self.trigs.iter()
            .find(|t| t.step == step && t.lane == Some(pitch));
        if let Some(t) = specific { return t.props; }
        let step_wide = self.trigs.iter()
            .find(|t| t.step == step && t.lane.is_none());
        step_wide.map_or(TrigProps::DEFAULT, |t| t.props)
    }

    fn edit_trig(&mut self, s0: u16, s1: u16, lane: Option<u8>, f: impl Fn(&mut TrigProps)) {
        for step in s0..=s1 {
            let idx = self.trigs.iter().position(|t| t.step == step && t.lane == lane);
            let mut props = idx.map_or(TrigProps::DEFAULT, |i| self.trigs[i].props);
            f(&mut props);
            match idx {
                Some(i) if props.is_default() => { self.trigs.swap_remove(i); }
                Some(i) => { self.trigs[i].props = props; }
                None if props.is_default() => {}
                None if self.trigs.len() < MAX_TRIGS => {
                    self.trigs.push(Trig { step, lane, props });
                }
                None => {}
            }
        }
    }

    pub fn set_trig_prob(&mut self, s0: u16, s1: u16, lane: Option<u8>, pct: u8) {
        self.edit_trig(s0, s1, lane, |p| p.prob = pct.min(100));
    }
    pub fn set_trig_cond(&mut self, s0: u16, s1: u16, lane: Option<u8>, a: u8, b: u8) {
        self.edit_trig(s0, s1, lane, |p| { p.cond_a = a.max(1); p.cond_b = b.max(1); });
    }
    pub fn set_trig_invert(&mut self, s0: u16, s1: u16, lane: Option<u8>, inv: bool) {
        self.edit_trig(s0, s1, lane, |p| p.invert = inv);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && cargo test -p seq-core trig`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/clip.rs
git commit -m "engine: per-clip Trig table (probability/condition/invert)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Condition evaluation + per-track cycle counter

**Files:**
- Modify: `engine/crates/seq-core/src/clip.rs` (pure `condition_plays` fn)
- Modify: `engine/crates/seq-core/src/track.rs` (cycle field)
- Modify: `engine/crates/seq-core/src/engine.rs` (reset/increment cycle)

- [ ] **Step 1: Write the failing tests**

Add to `clip.rs` tests:

```rust
    #[test]
    fn condition_truth_table() {
        use super::condition_plays;
        // 1:1 always
        for n in 1..=5 { assert!(condition_plays(1, 1, false, n)); }
        // 1:2 → 1,3,5
        assert!(condition_plays(1, 2, false, 1));
        assert!(!condition_plays(1, 2, false, 2));
        assert!(condition_plays(1, 2, false, 3));
        // 2:2 → 2,4,6
        assert!(!condition_plays(2, 2, false, 1));
        assert!(condition_plays(2, 2, false, 2));
        // 2:4 → 2,6,10
        assert!(condition_plays(2, 4, false, 2));
        assert!(condition_plays(2, 4, false, 6));
        assert!(!condition_plays(2, 4, false, 3));
        // 4:7 → 4,11,18
        assert!(condition_plays(4, 7, false, 4));
        assert!(condition_plays(4, 7, false, 11));
        assert!(!condition_plays(4, 7, false, 5));
        // invert flips
        assert!(!condition_plays(1, 2, true, 1));
        assert!(condition_plays(1, 2, true, 2));
    }
```

Add to `track.rs` tests:

```rust
    #[test]
    fn new_track_cycle_is_one() {
        assert_eq!(Track::new().cycle, 1);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p seq-core condition_truth_table new_track_cycle`
Expected: FAIL — `condition_plays` and `Track.cycle` not found.

- [ ] **Step 3: Implement**

In `clip.rs`, at module level (outside `impl`, e.g. just above the tests module):

```rust
/// Trig condition truth: with 1-based pattern play count `cycle`, A:B plays when
/// `((cycle-1) mod B) + 1 == A`. `invert` flips the result. (1:1 always plays.)
pub fn condition_plays(a: u8, b: u8, invert: bool, cycle: u32) -> bool {
    let b = b.max(1) as u32;
    let plays = (cycle.wrapping_sub(1) % b) + 1 == a as u32;
    plays ^ invert
}
```

In `track.rs`, add to the `Track` struct: `pub cycle: u32,`. In `Track::new()` add `cycle: 1,`.

In `engine.rs`:
- In `start_transport` (inside the `for t in &mut self.tracks` loop, after `t.auto_cur = [-1; 8];`) add: `t.cycle = 1;`.
- In `service_tick`, the queued-launch block (around line 501, after `t.pos_tick = t.clips[slot].loop_start_ticks();`) add: `t.cycle = 1;`.
- In `service_tick`, the wrap branch (around line 579, the `else` that does `self.tracks[ti].pos_tick = start;`) add right after it: `self.tracks[ti].cycle = self.tracks[ti].cycle.wrapping_add(1);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && cargo test -p seq-core condition_truth_table new_track_cycle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/clip.rs engine/crates/seq-core/src/track.rs engine/crates/seq-core/src/engine.rs
git commit -m "engine: trig condition eval + per-track cycle counter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: PRNG + scheduler integration (per-trig, chord-shared decision)

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs`

- [ ] **Step 1: Write the failing tests**

Add to `engine.rs` tests (the `#[cfg(test)] mod tests` block at the bottom):

```rust
    #[test]
    fn condition_skips_trig_on_off_cycle() {
        let mut e = Engine::new(44100, 12000);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        // 2:2 → silent on cycle 1, sounds on cycle 2.
        e.tracks[0].active_mut().set_trig_cond(0, 0, None, 2, 2);
        e.play();
        let mut out = Vec::new();
        // Run exactly one full bar (16 steps * 24 ticks) of cycle 1.
        for _ in 0..(16 * 24) { e.service_tick_pub(&mut out); }
        assert!(!out.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })),
            "cycle 1 should be silent for 2:2");
        out.clear();
        for _ in 0..(16 * 24) { e.service_tick_pub(&mut out); }
        assert!(out.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })),
            "cycle 2 should sound for 2:2");
    }

    #[test]
    fn probability_zero_never_plays_hundred_always() {
        let mut e = Engine::new(44100, 12000);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().set_trig_prob(0, 0, None, 0);
        e.play();
        let mut out = Vec::new();
        for _ in 0..(16 * 24 * 4) { e.service_tick_pub(&mut out); }
        assert!(!out.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })), "0% never plays");
    }

    #[test]
    fn chord_shares_one_probability_decision() {
        // Two notes on the same trig must play together or skip together (never split).
        let mut e = Engine::new(44100, 12000);
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100), (64, 100)]);
        e.tracks[0].active_mut().set_loop(0, 16);
        e.tracks[0].active_mut().set_trig_prob(0, 0, None, 50);
        e.play();
        let mut out = Vec::new();
        for _ in 0..(16 * 24 * 8) { e.service_tick_pub(&mut out); }
        // For every pass, count of pitch-60 NoteOns equals count of pitch-64.
        let n60 = out.iter().filter(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })).count();
        let n64 = out.iter().filter(|x| matches!(x, OutEvent::NoteOn { pitch: 64, .. })).count();
        assert_eq!(n60, n64, "chord notes must share the same play/skip decision");
    }
```

Note: these tests call `service_tick_pub`. If a public test shim does not already exist, add one (Step 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p seq-core condition_skips probability_zero chord_shares`
Expected: FAIL — `set_trig_*` reachable but the scheduler ignores trigs (notes still fire), and/or `service_tick_pub` missing.

- [ ] **Step 3: Implement PRNG + decision in the scheduler**

In `engine.rs`, add a PRNG field to `Engine`: `rng_state: u64,`. Initialize in `Engine::new` to a nonzero constant: `rng_state: 0x9E3779B97F4A7C15,`.

Add a helper method on `impl Engine`:

```rust
    /// xorshift64* → a 0..=99 percent roll. Free-running (Elektron-style).
    fn roll_pct(&mut self) -> u8 {
        let mut x = self.rng_state;
        x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
        self.rng_state = x;
        (x.wrapping_mul(0x2545F4914F6CDD1D) >> 33) as u8 % 100
    }
```

In `service_tick`, replace the per-note emit block (the `for ni in 0..len { ... }` loop around lines 550-561) with a version that evaluates the governing trig once per (step, lane) for this tick and caches the decision so a chord shares it:

```rust
                if !muted {
                    let len = self.tracks[ti].clips[slot].notes.len();
                    let cycle = self.tracks[ti].cycle;
                    // Per-tick decision cache: (note.step, governing-lane) -> play?
                    // Notes firing this tick are few; a small Vec scan is cheap.
                    let mut decided: Vec<((u16, Option<u8>), bool)> = Vec::new();
                    for ni in 0..len {
                        let n = self.tracks[ti].clips[slot].notes[ni];
                        if n.tick != pos || n.suppress { continue; }
                        // Governing lane: a pitch-specific trig if one exists, else step-wide.
                        let clip = &self.tracks[ti].clips[slot];
                        let lane_key = if clip.trigs.iter()
                            .any(|t| t.step == n.step && t.lane == Some(n.pitch)) {
                            Some(n.pitch)
                        } else { None };
                        let key = (n.step, lane_key);
                        let play = if let Some(&(_, p)) = decided.iter().find(|(k, _)| *k == key) {
                            p
                        } else {
                            let tp = clip.governing_trig(n.step, n.pitch);
                            let cond = crate::clip::condition_plays(tp.cond_a, tp.cond_b, tp.invert, cycle);
                            let p = cond && (tp.prob >= 100 || self.roll_pct() < tp.prob);
                            decided.push((key, p));
                            p
                        };
                        if !play { continue; }
                        out.push(OutEvent::NoteOn { track: ti as u8, pitch: n.pitch, vel: n.vel });
                        self.gates.push(Gate { track: ti as u8, pitch: n.pitch, ticks_left: n.gate.max(1) });
                    }
                }
```

If `service_tick` is private and the tests need to drive it, add a test-only public shim near the bottom of `impl Engine`:

```rust
    #[cfg(test)]
    pub fn service_tick_pub(&mut self, out: &mut Vec<OutEvent>) { self.service_tick(out); }
```

(If the engine already exposes a tick driver used by other tests, reuse that instead and adjust the test calls.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS (all existing + 3 new). The probability test relies on 50% being neither 0 nor 100; it only asserts equal counts, so it is deterministic regardless of the RNG sequence.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "engine: scheduler honors trig condition+probability (chord-shared)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Commands `eprob` / `econd` / `einv`

**Files:**
- Modify: `engine/crates/seq-core/src/command.rs`

- [ ] **Step 1: Write the failing test**

Add to `command.rs` tests:

```rust
    #[test]
    fn trig_property_commands() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
        crate::command::apply_batch(&mut e,
            "eprob 0 2 2 -1 40;econd 0 2 2 -1 2 3;einv 0 2 2 -1 1", &mut out);
        let t = e.tracks[0].active().governing_trig(2, 60);
        assert_eq!((t.prob, t.cond_a, t.cond_b, t.invert), (40, 2, 3, true));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && cargo test -p seq-core trig_property_commands`
Expected: FAIL — unknown verbs are ignored, so props stay default.

- [ ] **Step 3: Implement the command handlers**

In `command.rs`, add new match arms (after the `slen` arm, before `rec`):

```rust
        // eprob <t> <s0> <s1> <p> <pct>; econd <t> <s0> <s1> <p> <a> <b>;
        // einv <t> <s0> <s1> <p> <0|1>. p = lane pitch or -1 (whole step).
        "eprob" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(pct)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    engine.tracks[t as usize].active_mut()
                        .set_trig_prob(s0.clamp(0,255) as u16, s1.clamp(0,255) as u16, lane, pct.clamp(0,100) as u8);
                }
            }
        }
        "econd" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(a), Some(b)) =
                (next(), next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    engine.tracks[t as usize].active_mut()
                        .set_trig_cond(s0.clamp(0,255) as u16, s1.clamp(0,255) as u16, lane,
                                       a.clamp(1,64) as u8, b.clamp(1,64) as u8);
                }
            }
        }
        "einv" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(v)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    engine.tracks[t as usize].active_mut()
                        .set_trig_invert(s0.clamp(0,255) as u16, s1.clamp(0,255) as u16, lane, v != 0);
                }
            }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && cargo test -p seq-core trig_property_commands`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/command.rs
git commit -m "engine: eprob/econd/einv trig-property commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Held-step status fields (`hvel hgate hgmix hprob hcond hinv`)

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs`

- [ ] **Step 1: Write the failing test**

Add to `engine.rs` tests:

```rust
    #[test]
    fn status_reports_held_trig_props() {
        let mut e = Engine::new(44100, 12000);
        e.tracks[0].active_mut().toggle_step(3, &[(60, 90), (64, 110)]);
        e.tracks[0].active_mut().set_trig_prob(3, 3, None, 40);
        e.tracks[0].active_mut().set_trig_cond(3, 3, None, 2, 3);
        e.set_held_query(Some((0, 3)));
        let s = e.status();
        assert!(s.contains(" hvel=100"), "avg of 90,110 = 100; got: {s}"); // chord avg
        assert!(s.contains(" hgmix=0"), "same gate → not mixed; got: {s}");
        assert!(s.contains(" hprob=40"), "{s}");
        assert!(s.contains(" hcond=2:3"), "{s}");
        assert!(s.contains(" hinv=0"), "{s}");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && cargo test -p seq-core status_reports_held_trig`
Expected: FAIL — keys absent from status.

- [ ] **Step 3: Implement the status fields**

In `engine.rs`, add helper methods on `impl Engine` (near `held_len_steps`):

```rust
    /// Held-step readout: (avg velocity, gate ticks of first note, mixed-gate flag).
    /// lane filtered by watch_lane (None = melodic). Zeros when no step held / empty.
    fn held_note_stats(&self) -> (u8, u32, bool) {
        let Some((t, step)) = self.held_query else { return (0, 0, false); };
        if t >= NUM_TRACKS { return (0, 0, false); }
        let lane = self.watch_lane;
        let clip = self.tracks[t].active();
        let mut vels: Vec<u16> = Vec::new();
        let mut gate0: Option<u32> = None;
        let mut mixed = false;
        for n in clip.notes.iter().filter(|n| n.step == step && lane.map_or(true, |p| n.pitch == p)) {
            vels.push(n.vel as u16);
            match gate0 {
                None => gate0 = Some(n.gate),
                Some(g) if g != n.gate => mixed = true,
                _ => {}
            }
        }
        if vels.is_empty() { return (0, 0, false); }
        let avg = (vels.iter().sum::<u16>() / vels.len() as u16) as u8;
        (avg, gate0.unwrap_or(0), mixed)
    }

    /// Resolved trig props at the held step (lane = watch_lane), defaults otherwise.
    fn held_trig(&self) -> crate::clip::TrigProps {
        match self.held_query {
            Some((t, step)) if t < NUM_TRACKS => {
                let pitch = self.watch_lane.unwrap_or(0);
                self.tracks[t].active().governing_trig(step, pitch)
            }
            _ => crate::clip::TrigProps::DEFAULT,
        }
    }
```

Then, in `status()`, compute before the `format!`:

```rust
        let (hvel, hgate, hgmix) = self.held_note_stats();
        let htp = self.held_trig();
```

and extend the format string + args. Append to the end of the format literal (before the closing quote):
` hvel={} hgate={} hgmix={} hprob={} hcond={}:{} hinv={}`
and append the args after `hauto`:
```rust
            ,
            hvel, hgate, hgmix as u8, htp.prob, htp.cond_a, htp.cond_b, htp.invert as u8
```

(Note: `held_trig` uses `watch_lane.unwrap_or(0)` for the melodic case; melodic trigs are keyed `None`, and `governing_trig(step, 0)` falls through to the step-wide row since no `Some(0)` row exists — correct.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && cargo test -p seq-core status_reports_held_trig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "engine: status reports held-step velocity/gate/trig props

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Persist trigs

**Files:**
- Modify: `engine/crates/seq-core/src/persist.rs`

- [ ] **Step 1: Write the failing test**

Add to `persist.rs` tests:

```rust
    #[test]
    fn round_trips_trigs() {
        let mut e = Engine::new(44100, 12000);
        e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
        e.tracks[0].active_mut().set_trig_prob(2, 2, None, 30);
        e.tracks[0].active_mut().set_trig_cond(2, 2, None, 1, 4);
        e.tracks[0].active_mut().set_trig_invert(2, 2, Some(36), true);
        let s = serialize(&e);
        let mut e2 = Engine::new(44100, 12000);
        assert!(load(&mut e2, &s));
        let a = e2.tracks[0].active().governing_trig(2, 60);
        assert_eq!((a.prob, a.cond_a, a.cond_b), (30, 1, 4));
        assert!(e2.tracks[0].active().governing_trig(2, 36).invert);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && cargo test -p seq-core round_trips_trigs`
Expected: FAIL — trigs not serialized.

- [ ] **Step 3: Implement serialize + load**

In `serialize`, inside the clip loop (after the `lk` block, still inside `for (ci, c) ...`):

```rust
            if !c.trigs.is_empty() {
                s.push_str(&format!("tg {} {} ", ti, ci));
                for (i, tr) in c.trigs.iter().enumerate() {
                    if i > 0 { s.push(';'); }
                    // step:lane:prob:a:b:inv  (lane = pitch or -1)
                    let lane = tr.lane.map_or(-1i16, |p| p as i16);
                    s.push_str(&format!("{}:{}:{}:{}:{}:{}",
                        tr.step, lane, tr.props.prob, tr.props.cond_a, tr.props.cond_b, tr.props.invert as u8));
                }
                s.push('\n');
            }
```

In `load`, add a match arm `Some("tg") => load_trigs(engine, &mut it),` (next to `Some("lk")`), and add the function:

```rust
fn load_trigs<'a>(engine: &mut Engine, it: &mut impl Iterator<Item = &'a str>) {
    let track = it.next().and_then(|x| x.parse::<usize>().ok());
    let slot = it.next().and_then(|x| x.parse::<usize>().ok());
    let (Some(track), Some(slot)) = (track, slot) else { return; };
    if track >= engine.tracks.len() || slot >= 8 { return; }
    if let Some(list) = it.next() {
        for tok in list.split(';') {
            let p: Vec<&str> = tok.split(':').collect();
            if p.len() == 6 {
                let step = p[0].parse::<u16>().ok();
                let lane_raw = p[1].parse::<i16>().ok();
                let prob = p[2].parse::<u8>().ok();
                let a = p[3].parse::<u8>().ok();
                let b = p[4].parse::<u8>().ok();
                let inv = p[5].parse::<u8>().ok();
                if let (Some(step), Some(lane_raw), Some(prob), Some(a), Some(b), Some(inv)) =
                    (step, lane_raw, prob, a, b, inv)
                {
                    let lane = if (0..128).contains(&lane_raw) { Some(lane_raw as u8) } else { None };
                    let c = &mut engine.tracks[track].clips[slot];
                    c.set_trig_prob(step, step, lane, prob.min(100));
                    c.set_trig_cond(step, step, lane, a.max(1), b.max(1));
                    c.set_trig_invert(step, step, lane, inv != 0);
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && cargo test -p seq-core round_trips_trigs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/persist.rs
git commit -m "engine: persist trig table (tg lines)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Bump ENGINE_VERSION

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs:18`
- Modify: `src/seq/constants.ts:22`

- [ ] **Step 1: Edit both constants**

In `engine/crates/movy-dsp/src/lib.rs` line 18: `const ENGINE_VERSION: &str = "0.19.0";`
In `src/seq/constants.ts` line 22: `export const ENGINE_VERSION = '0.19.0';`

- [ ] **Step 2: Verify they match**

Run: `grep -n '0.19.0' engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts`
Expected: both files show `0.19.0`.

- [ ] **Step 3: Run the full engine suite**

Run: `cd engine && cargo test`
Expected: PASS (all crates).

- [ ] **Step 4: Commit**

```bash
git add engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "engine: bump ENGINE_VERSION 0.18.0 -> 0.19.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — UI state + status parsing

### Task 8: Mirror held-step trig values in `seqState`

**Files:**
- Modify: `src/seq/state.ts`
- Modify: `src/seq/engine.ts` (parseStatus)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, add a case (use the existing `parseStatusForTest` import pattern — check the top of the file for how `seqState`/`parseStatusForTest` are imported from `dist/esm`):

```js
// --- Step-page: held trig values parsed from status ---
parseStatusForTest('play=0 trk=0 step=3 hvel=100 hgate=48 hgmix=1 hprob=40 hcond=2:3 hinv=1');
assertEq(seqState.holdVel, 100, 'holdVel parsed');
assertEq(seqState.holdGate, 48, 'holdGate parsed');
assertEq(seqState.holdGateMixed, true, 'holdGateMixed parsed');
assertEq(seqState.holdProb, 40, 'holdProb parsed');
assertEq(seqState.holdCondA, 2, 'holdCondA parsed');
assertEq(seqState.holdCondB, 3, 'holdCondB parsed');
assertEq(seqState.holdInvert, true, 'holdInvert parsed');
```

(Match the file's actual assertion helper name; if it uses `assert(cond, msg)` adapt accordingly.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `seqState.holdVel` undefined.

- [ ] **Step 3: Implement state + parsing**

In `src/seq/state.ts`, add to the `SeqUiState` interface (after `holdNotes`):

```ts
    holdVel: number;        // avg velocity at held step (from `hvel`)
    holdGate: number;       // gate ticks of first held note (from `hgate`)
    holdGateMixed: boolean; // held notes differ in length (from `hgmix`)
    holdProb: number;       // probability % (from `hprob`)
    holdCondA: number;      // condition A (from `hcond`)
    holdCondB: number;      // condition B (from `hcond`)
    holdInvert: boolean;    // invert condition (from `hinv`)
```

Add to `defaults()`:

```ts
        holdVel: 0,
        holdGate: 0,
        holdGateMixed: false,
        holdProb: 100,
        holdCondA: 1,
        holdCondB: 1,
        holdInvert: false,
```

In `src/seq/engine.ts` `parseStatus`, add arms (after the `hnotes` arm):

```ts
        else if (key === 'hvel') seqState.holdVel = Number(val) || 0;
        else if (key === 'hgate') seqState.holdGate = Number(val) || 0;
        else if (key === 'hgmix') seqState.holdGateMixed = val === '1';
        else if (key === 'hprob') seqState.holdProb = Number(val) || 0;
        else if (key === 'hcond') {
            const [a, b] = val.split(':').map(Number);
            seqState.holdCondA = a || 1;
            seqState.holdCondB = b || 1;
        }
        else if (key === 'hinv') seqState.holdInvert = val === '1';
```

- [ ] **Step 4: Run to verify it passes**

Run: `node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/state.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "ui: mirror held-step trig values from status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Step-page selection state + session-memory rule

**Files:**
- Create: `src/seq/step-page.ts`
- Modify: `src/seq/step-edit.ts` (call into step-page on session start/end)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs` (import from the built `dist/esm/seq/step-page.js`):

```js
import {
    stepPageState, onSessionStart, onSessionEnd, setStepPageSelected, resetStepPage,
} from '../dist/esm/seq/step-page.js';

// Default: first-ever session opens module page (not step page).
resetStepPage();
onSessionStart();
assertEq(stepPageState.selected, false, 'first session defaults to module page');
// If a session ends while on the step page, next session reopens the step page.
setStepPageSelected(true);
onSessionEnd();
onSessionStart();
assertEq(stepPageState.selected, true, 'step page reopens after a step-page session');
// If a session ends on a module page, next session does NOT auto-open step page.
setStepPageSelected(false);
onSessionEnd();
onSessionStart();
assertEq(stepPageState.selected, false, 'module page session does not reopen step page');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node browser-test/logic.mjs`
Expected: FAIL — module `step-page.js` not found.

- [ ] **Step 3: Implement `src/seq/step-page.ts`**

```ts
/* Step parameter page: shown only during a parameter-lock session (a held
 * step). It is page 0, ahead of the module banks / chain slots. Selection is
 * remembered across sessions so a session that ended on the step page reopens
 * there next time (the page does not exist outside a session, so a flag carries
 * that intent). Knob/value editing lives in step-edit.ts; rendering reads this. */

export const stepPageState = {
    /** The step page (page 0) is the currently selected page this session. */
    selected: false,
    /** Carried across sessions: the prior session ended on the step page. */
    lastSessionStepPage: false,
};

/** Session (parameter lock) begins: open the step page iff the last one did. */
export function onSessionStart(): void {
    stepPageState.selected = stepPageState.lastSessionStepPage;
}

/** Session ends: remember whether the step page was open. */
export function onSessionEnd(): void {
    stepPageState.lastSessionStepPage = stepPageState.selected;
    stepPageState.selected = false;
}

export function setStepPageSelected(v: boolean): void {
    stepPageState.selected = v;
}

/** True when the step page should be rendered/edited (session active + selected). */
export function stepPageActive(sessionActive: boolean): boolean {
    return sessionActive && stepPageState.selected;
}

export function resetStepPage(): void {
    stepPageState.selected = false;
    stepPageState.lastSessionStepPage = false;
}
```

- [ ] **Step 4: Wire into session start/end in `src/seq/step-edit.ts`**

Add an import at the top: `import { onSessionStart, onSessionEnd } from './step-page.js';`

In `beginStepAutomation()`, inside the `if (!seqState.stepAutoMode) {` block (right after setting `seqState.stepAutoMode = true;`), add: `onSessionStart();`

In `endStepAutomation()`, add `onSessionEnd();` as the first line.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/step-page.ts src/seq/step-edit.ts browser-test/logic.mjs
git commit -m "ui: step-page selection state + session-memory rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — UI rendering

### Task 10: `drawBankBar` dotted-first segment

**Files:**
- Modify: `src/renderer/header.ts`
- Test: `browser-test/screenshot.mjs` (new baseline)

- [ ] **Step 1: Add the `dottedFirst` parameter**

Replace `drawBankBar` in `src/renderer/header.ts` with:

```ts
export function drawBankBar(bankIndex: number, bankCount: number, dottedFirst = false): void {
    if (bankCount <= 1) return;
    const segW = Math.floor((W - (bankCount - 1)) / bankCount);
    for (let b = 0; b < bankCount; b++) {
        const sx = b * (segW + 1);
        const sw = b === bankCount - 1 ? W - sx : segW;
        const h  = b === bankIndex ? 2 : 1;
        if (dottedFirst && b === 0) {
            // Step page indicator: dotted segment (every other pixel), double
            // height when selected.
            for (let x = sx; x < sx + sw; x += 2) fill_rect(x, BAR_Y, 1, h, 1);
        } else {
            fill_rect(sx, BAR_Y, sw, h, 1);
        }
    }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/dake/git/cld/movy && npm run typecheck`
Expected: zero errors (the new param is optional, existing callers unaffected).

- [ ] **Step 3: Commit (baseline regen happens in Task 12 with the renderer wiring)**

```bash
git add src/renderer/header.ts
git commit -m "renderer: drawBankBar dotted-first (step page) segment

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Step-page ViewModel builder + value mappings

**Files:**
- Create: `src/seq/step-page-vm.ts`
- Modify: `src/types/viewmodel.ts` (two optional fields)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`:

```js
import { buildStepPageVM, LENGTH_TICKS, lengthIndexForTicks } from '../dist/esm/seq/step-page-vm.js';

// 48 ticks = 1/8 note (index 2 in the length list).
assertEq(lengthIndexForTicks(48), 2, '48 ticks -> 1/8');
assertEq(LENGTH_TICKS[2], 48, 'length list 1/8 = 48 ticks');

const vm = buildStepPageVM({
    holdVel: 100, holdGate: 48, holdGateMixed: false,
    holdProb: 40, holdCondA: 2, holdCondB: 3, holdInvert: true,
});
assertEq(vm.moduleName, 'step', 'title is step');
const cells = vm.rows[0];
assertEq(cells[0].renderStyle, 'vbar', 'velocity = vbar');
assert(Math.abs(cells[0].normalizedValue - 100 / 127) < 0.01, 'velocity bar at avg');
assertEq(cells[1].type, 'enum', 'length = enum');
assertEq(cells[1].displayValue, '1/8', 'length shows 1/8');
assertEq(cells[2].displayValue, '40%', 'probability shows 40%');
assertEq(cells[3].renderStyle, 'preset', 'condition = preset big font');
assertEq(cells[3].displayValue, '2:3', 'condition shows 2:3');
assertEq(cells[4].displayValue, 'ON', 'invert ON');

// Mixed length shows '...'.
const vm2 = buildStepPageVM({ holdVel: 80, holdGate: 24, holdGateMixed: true,
    holdProb: 100, holdCondA: 1, holdCondB: 1, holdInvert: false });
assertEq(vm2.rows[0][1].displayValue, '...', 'mixed length shows ...');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node browser-test/logic.mjs`
Expected: FAIL — `step-page-vm.js` not found.

- [ ] **Step 3: Add ViewModel fields**

In `src/types/viewmodel.ts`, add to the `ViewModel` interface:

```ts
    stepPagePresent:  boolean;  // a parameter-lock session is active → indicator prepends dotted segment
    stepPageSelected: boolean;  // the step page is the selected page (render step params)
```

Then make `buildViewModel` (in `src/model/viewmodel.ts`) default them to `false` in its returned object (add `stepPagePresent: false, stepPageSelected: false,`). This keeps existing callers compiling; app/tick overrides them during a session.

- [ ] **Step 4: Implement `src/seq/step-page-vm.ts`**

```ts
/* Builds the step parameter page's ViewModel from the held-step trig mirror.
 * These five params are intrinsic note properties (not chain params), so this
 * bypasses model/viewmodel.ts. Knob 1 velocity (vbar), 2 length (enum square),
 * 3 probability (enum square), 4 condition (big preset font), 5 invert (enum
 * square). Knobs 6-8 blank. */
import type { ViewModel, ParamVM } from '../types/viewmodel.js';

/* Note-length values in ticks (TICKS_PER_STEP=24, whole note/bar=384). */
export const LENGTH_TICKS: number[] = [
    12, 24, 48, 96, 192,           // 1/32 1/16 1/8 1/4 1/2
    384, 768, 1152, 1536, 1920, 2304, 2688, 3072, 3456, 3840, 4224, // 1..11 bars
    4608, 4992, 5376, 5760, 6144,  // 12..16 bars
];
export const LENGTH_LABELS: string[] = [
    '1/32', '1/16', '1/8', '1/4', '1/2',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16',
];

/* Probability enum: 100..10 by 10. */
export const PROB_VALUES: number[] = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
export const PROB_LABELS: string[] = PROB_VALUES.map((v) => v + '%');

/* Condition A:B enumeration, B up to 8: 1:1, 1:2, 2:2, 1:3.. */
export const COND_PAIRS: [number, number][] = (() => {
    const out: [number, number][] = [];
    for (let b = 1; b <= 8; b++) for (let a = 1; a <= b; a++) out.push([a, b]);
    return out;
})();
export const COND_LABELS: string[] = COND_PAIRS.map(([a, b]) => a + ':' + b);

/** Nearest length-list index for a gate in ticks. */
export function lengthIndexForTicks(ticks: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < LENGTH_TICKS.length; i++) {
        const d = Math.abs(LENGTH_TICKS[i] - ticks);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}
export function probIndexForPct(pct: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < PROB_VALUES.length; i++) {
        const d = Math.abs(PROB_VALUES[i] - pct);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}
export function condIndexFor(a: number, b: number): number {
    const i = COND_PAIRS.findIndex(([x, y]) => x === a && y === b);
    return i < 0 ? 0 : i;
}

export interface HeldTrig {
    holdVel: number; holdGate: number; holdGateMixed: boolean;
    holdProb: number; holdCondA: number; holdCondB: number; holdInvert: boolean;
}

function cell(p: Partial<ParamVM>): ParamVM {
    return {
        shortName: '', fullName: '', type: 'float', normalizedValue: 0,
        displayValue: '', touched: false, isLongEnum: false, options: null,
        enumIndex: 0, renderStyle: 'arc', automated: false, automatable: false,
        assigned: false, ...p,
    };
}

export function buildStepPageVM(h: HeldTrig): ViewModel {
    const lenIdx  = lengthIndexForTicks(h.holdGate);
    const probIdx = probIndexForPct(h.holdProb);
    const condIdx = condIndexFor(h.holdCondA, h.holdCondB);

    const vel = cell({
        shortName: 'VEL', fullName: 'Velocity', type: 'float', renderStyle: 'vbar',
        normalizedValue: Math.max(0, Math.min(1, h.holdVel / 127)),
        displayValue: String(h.holdVel),
    });
    const len = cell({
        shortName: 'LEN', fullName: 'Length', type: 'enum', options: LENGTH_LABELS,
        enumIndex: lenIdx, displayValue: h.holdGateMixed ? '...' : LENGTH_LABELS[lenIdx],
    });
    const prob = cell({
        shortName: 'PROB', fullName: 'Probability', type: 'enum', options: PROB_LABELS,
        enumIndex: probIdx, displayValue: PROB_LABELS[probIdx],
    });
    const cond = cell({
        shortName: 'COND', fullName: 'Condition', type: 'cond', renderStyle: 'preset',
        enumIndex: condIdx, displayValue: COND_LABELS[condIdx],
    });
    const inv = cell({
        shortName: 'INV', fullName: 'Invert', type: 'enum', options: ['OFF', 'ON'],
        enumIndex: h.holdInvert ? 1 : 0, displayValue: h.holdInvert ? 'ON' : 'OFF',
    });

    return {
        moduleName: 'step', bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[vel, len, prob, cond], [inv, null, null, null]],
        touchedSlot: null, toast: null, overlay: null, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
        automationHeld: true, automationPoolFull: false,
        stepPagePresent: true, stepPageSelected: true,
    };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/step-page-vm.ts src/types/viewmodel.ts src/model/viewmodel.ts browser-test/logic.mjs
git commit -m "ui: step-page ViewModel builder + value mappings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Render the condition (big-font text) + wire step page into the views

**Files:**
- Modify: `src/renderer/knob.ts` (`drawPresetValue` text fallback)
- Modify: `src/renderer/knob-view.ts`, `src/renderer/chain-view.ts` (dotted indicator)
- Test: `browser-test/screenshot.mjs`

- [ ] **Step 1: Make `drawPresetValue` render non-numeric text (for `2:3`)**

In `src/renderer/knob.ts`, replace the `num`/`text` computation in `drawPresetValue` (lines ~87-90) with:

```ts
    const num = pvm.type === 'enum'
        ? pvm.enumIndex + 1
        : Number(pvm.displayValue);
    const text = Number.isFinite(num) ? String(Math.round(num)) : (pvm.displayValue || '—');
```

This keeps existing preset (enum → number) behavior, renders numeric strings as numbers, and renders `2:3` (non-numeric) as text. The existing big/small fallback below handles width.

- [ ] **Step 2: Wire the dotted indicator into `renderKnobsView`**

In `src/renderer/knob-view.ts`, replace the `drawBankBar(vm.bankIndex, vm.bankCount);` line with:

```ts
    if (vm.stepPagePresent) {
        const sel = vm.stepPageSelected ? 0 : vm.bankIndex + 1;
        drawBankBar(sel, vm.bankCount + 1, true);
    } else {
        drawBankBar(vm.bankIndex, vm.bankCount);
    }
```

- [ ] **Step 3: Wire the dotted indicator into `renderChainView`**

In `src/renderer/chain-view.ts`, replace the `drawBankBar(chainIndex, 4);` line (the one after `drawKnobParams`, not the `isEmpty` branch) with:

```ts
    if (vm.stepPagePresent) {
        const sel = vm.stepPageSelected ? 0 : chainIndex + 1;
        drawBankBar(sel, 5, true);
    } else {
        drawBankBar(chainIndex, 4);
    }
```

- [ ] **Step 4: Add screenshot baselines for the step page**

In `browser-test/screenshot.mjs`, find where scenes are declared (an array of `{ name, render }` or similar — inspect the file). Add scenes that build a step-page VM and render it in both views. Use the existing import of `buildStepPageVM` and the renderers. Example scene bodies (adapt to the file's harness API):

```js
// Step page (knobs view) selected
{
    name: 'step-page-knobs',
    render: () => {
        const vm = buildStepPageVM({ holdVel: 100, holdGate: 48, holdGateMixed: false,
            holdProb: 40, holdCondA: 2, holdCondB: 3, holdInvert: true });
        renderKnobsView(vm, false, 0);
    },
},
// Step page (chain view) selected
{
    name: 'step-page-chain',
    render: () => {
        const vm = buildStepPageVM({ holdVel: 64, holdGate: 24, holdGateMixed: true,
            holdProb: 100, holdCondA: 1, holdCondB: 1, holdInvert: false });
        renderChainView(vm, 1, false, 'T1');
    },
},
// Module page during a session (dotted, not selected)
{
    name: 'step-page-indicator-unselected',
    render: () => {
        const vm = /* build a normal module VM via the test's existing helper */ makeModuleVM();
        vm.stepPagePresent = true; vm.stepPageSelected = false;
        renderKnobsView(vm, false, 0);
    },
},
```

- [ ] **Step 5: Generate baselines and run**

Run: `npm run build:browser && node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs`
Expected: `--update` writes the new PNG baselines; the second run reports 0 failures.

- [ ] **Step 6: Visually confirm baselines**

Run: `ls browser-test/baselines | grep step-page` (confirm three new baselines exist). Open them to sanity-check the dotted indicator, vbar, enum squares, and the big `2:3`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/knob.ts src/renderer/knob-view.ts src/renderer/chain-view.ts browser-test/screenshot.mjs browser-test/baselines
git commit -m "renderer: step page (condition big font, dotted indicator) + baselines

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — Navigation, knob routing, render dispatch

### Task 13: Jog page navigation including the step page

**Files:**
- Modify: `src/midi/router.ts` (jog rotation + Left/Right handlers)
- Test: `browser-test/app-loop.mjs`

- [ ] **Step 1: Write the failing test**

In `browser-test/app-loop.mjs` (inspect the harness for how it injects MIDI and reads `appState`/`stepPageState`/`seqState`; reuse those helpers). Add a scenario:

```js
// Hold a step → session active. Jog left from module page 0 enters the step page.
// Jog right leaves it. (watchLane = -1 melodic, one step held.)
import { stepPageState } from '../dist/esm/seq/step-page.js';
// ... set up engine ready + a step held so seqState.stepAutoMode is true ...
// (Use the harness’s existing "hold step" helper or directly drive beginStepAutomation.)

// Precondition: session active, module page selected.
assertEq(seqState.stepAutoMode, true, 'session active');
stepPageState.selected = false;
// Jog left (decodeDelta < 0) while on module bank 0 → step page.
injectCC(MoveMainKnob, ccCCW);
assertEq(stepPageState.selected, true, 'jog left into step page');
// Jog right → leave step page.
injectCC(MoveMainKnob, ccCW);
assertEq(stepPageState.selected, false, 'jog right out of step page');
```

(Use the file's real constants for `MoveMainKnob` and CW/CCW encoded `d2`. If the harness exposes a higher-level "turn jog" helper, use it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: FAIL — jog does not yet touch `stepPageState`.

- [ ] **Step 3: Implement jog rotation handling**

In `src/midi/router.ts`, import at top: `import { stepPageState, setStepPageSelected } from '../seq/step-page.js';` and `import { seqState } from '../seq/state.js';` is already imported.

In the **jog rotation** block (`if (d1 === MoveMainKnob)`), wrap the `VIEW_CHAIN` and `VIEW_KNOBS` branches so the step page is page 0 during a session. Replace the `else if (appState.currentView === VIEW_CHAIN)` and `else if (appState.currentView === VIEW_KNOBS)` branches with:

```ts
            } else if (appState.currentView === VIEW_CHAIN) {
                const dir = delta > 0 ? 1 : -1;
                if (seqState.stepAutoMode) {
                    if (stepPageState.selected) {
                        if (dir > 0) setStepPageSelected(false); // leave step → slot 0..
                    } else if (dir < 0 && chainIndex() === 0) {
                        setStepPageSelected(true);               // enter step page
                    } else {
                        setChainIndex(Math.max(0, Math.min(3, chainIndex() + dir)));
                    }
                } else {
                    setChainIndex(Math.max(0, Math.min(3, chainIndex() + dir)));
                }
                mlog('chain chainIndex=' + chainIndex());
            } else if (appState.currentView === VIEW_KNOBS) {
                const dir = delta > 0 ? 1 : -1;
                const m = activeModel();
                if (seqState.stepAutoMode) {
                    const onBank0 = (m?.getKnobPage?.() ?? 0) === 0;
                    if (stepPageState.selected) {
                        if (dir > 0) setStepPageSelected(false);
                    } else if (dir < 0 && onBank0) {
                        setStepPageSelected(true);
                    } else {
                        m?.changePage(dir);
                    }
                } else {
                    m?.changePage(dir);
                }
            }
```

This references `m.getKnobPage()`. Add it to the model: in `src/model/index.ts`, in the returned object add `getKnobPage() { return s.knobPage; },`.

- [ ] **Step 4: Mirror the same logic for Left/Right buttons**

In `src/midi/router.ts`, the `MoveLeft` and `MoveRight` handlers also call `changePage` / `setChainIndex`. Apply the identical step-page gating there (Left = `dir < 0` behavior, Right = `dir > 0`). For `MoveLeft`:

```ts
    if (d1 === MoveLeft && d2 > 0) {
        if (masterChainActive()) {
            appState.masterChainIndex = Math.max(0, appState.masterChainIndex - 1);
        } else if (appState.currentView === VIEW_CHAIN) {
            if (seqState.stepAutoMode && !stepPageState.selected && chainIndex() === 0) setStepPageSelected(true);
            else if (!(seqState.stepAutoMode && stepPageState.selected)) setChainIndex(Math.max(0, chainIndex() - 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            const m = activeModel();
            if (seqState.stepAutoMode && !stepPageState.selected && (m?.getKnobPage?.() ?? 0) === 0) setStepPageSelected(true);
            else if (!(seqState.stepAutoMode && stepPageState.selected)) m?.changePage(-1);
        }
        appState.dirty = true;
        return;
    }
```

For `MoveRight`:

```ts
    if (d1 === MoveRight && d2 > 0) {
        if (masterChainActive()) {
            appState.masterChainIndex = Math.min(3, appState.masterChainIndex + 1);
        } else if (appState.currentView === VIEW_CHAIN) {
            if (seqState.stepAutoMode && stepPageState.selected) setStepPageSelected(false);
            else setChainIndex(Math.min(3, chainIndex() + 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            const m = activeModel();
            if (seqState.stepAutoMode && stepPageState.selected) setStepPageSelected(false);
            else m?.changePage(1);
        }
        appState.dirty = true;
        return;
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/midi/router.ts src/model/index.ts browser-test/app-loop.mjs
git commit -m "ui: jog/arrow nav includes the step page (page 0) during a session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Knob routing on the step page (edit trig props)

**Files:**
- Modify: `src/seq/step-edit.ts` (add `editStepPageKnob`)
- Modify: `src/midi/router.ts` (route knob CC to it when on step page)
- Test: `browser-test/app-loop.mjs`

- [ ] **Step 1: Write the failing test**

In `browser-test/app-loop.mjs`, with a step held and the step page selected:

```js
import { peekSeqCmdQueue } from '../dist/esm/seq/engine.js';
// ... session active, stepPageState.selected = true, watchTrack=0, one step held at abs step 3 ...

// Knob 3 (probability) turned down by one detent → eprob emitted, NOT aset.
// Seed the held probability so an index step is well-defined.
parseStatusForTest('play=0 trk=0 step=3 hvel=100 hgate=24 hgmix=0 hprob=100 hcond=1:1 hinv=0');
turnKnob(2, oneDetentDown);  // knob index 2 = probability
const q = peekSeqCmdQueue().join(';');
assert(q.includes('eprob 0 3 3 -1 90'), 'probability knob emits eprob to 90%; got ' + q);
assert(!q.includes('aset'), 'step page must not emit automation aset');

// Knob 4 (condition) up one detent → econd to 1:2.
turnKnob(3, oneDetentUp);
assert(peekSeqCmdQueue().join(';').includes('econd 0 3 3 -1 1 2'), 'condition -> 1:2');

// Knob 5 (invert) any turn → einv 1.
turnKnob(4, oneDetentUp);
assert(peekSeqCmdQueue().join(';').includes('einv 0 3 3 -1 1'), 'invert -> on');

// Knob 1 (velocity) up → evel delta (preserves spread), not absolute.
turnKnob(0, oneDetentUp);
assert(peekSeqCmdQueue().join(';').match(/evel 0 3 3 -1 \d+/), 'velocity uses evel delta');
```

(Use the harness's real `turnKnob`/`parseStatusForTest` helpers and detent encodings; `-1` is the melodic lane. If multiple steps are held, the command should target the held range — see implementation.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: FAIL — knob turns still go through automation/model.

- [ ] **Step 3: Implement `editStepPageKnob` in `src/seq/step-edit.ts`**

Add imports at the top of `step-edit.ts`:

```ts
import {
    LENGTH_TICKS, PROB_VALUES, COND_PAIRS,
    lengthIndexForTicks, probIndexForPct, condIndexFor,
} from './step-page-vm.js';
```

Add per-knob enum accumulators (enums need a detent threshold so one click = one step) and the handler. Add near the other module state:

```ts
/* Step-page enum knobs accumulate small deltas; one "detent" steps the value. */
const STEP_ENUM_DIV = 8;
const enumAccum = [0, 0, 0, 0, 0]; // per step-page knob (0..4)

function detents(knob: number, delta: number): number {
    enumAccum[knob] += delta;
    let n = 0;
    while (enumAccum[knob] >= STEP_ENUM_DIV)  { enumAccum[knob] -= STEP_ENUM_DIV; n++; }
    while (enumAccum[knob] <= -STEP_ENUM_DIV) { enumAccum[knob] += STEP_ENUM_DIV; n--; }
    return n;
}

export function resetStepPageKnobs(): void { enumAccum.fill(0); }
```

Add the handler (uses `forEach` over held ranges so multi-step / Loop-bar holds all get the edit, mirroring `editVelocity`):

```ts
/* Route a knob turn on the step page to the trig-property edit it represents.
 * Knob 0 velocity (evel delta), 1 length (slen absolute), 2 probability (eprob),
 * 3 condition (econd), 4 invert (einv). Returns true if consumed. */
export function editStepPageKnob(knob: number, delta: number): boolean {
    if (!anyStepHeld()) return false;
    const t = seqState.watchTrack;
    const ln = lane();
    if (knob === 0) {
        // Velocity: delta nudge (preserves chord spread; full CW clamps to max).
        const d = (delta > 0 ? 1 : -1) * VEL_STEP;
        forEach((r) => seqCmd(`evel ${t} ${r.s0} ${r.s1} ${ln} ${d}`));
        seqToast(d > 0 ? 'Velocity +' : 'Velocity -');
        return true;
    }
    const n = detents(knob, delta);
    if (n === 0) { markHeldGestured(); return true; } // consumed; below detent threshold
    if (knob === 1) {
        const idx = clampIdx(lengthIndexForTicks(seqState.holdGate) + n, LENGTH_TICKS.length);
        const ticks = LENGTH_TICKS[idx];
        forEach((r) => seqCmd(`slen ${t} ${r.s0} ${r.s1} ${ln} ${ticks}`));
        seqState.holdGate = ticks; seqState.holdGateMixed = false;
        seqToast('Length ' + idx);
    } else if (knob === 2) {
        const idx = clampIdx(probIndexForPct(seqState.holdProb) + n, PROB_VALUES.length);
        const pct = PROB_VALUES[idx];
        forEach((r) => seqCmd(`eprob ${t} ${r.s0} ${r.s1} ${ln} ${pct}`));
        seqState.holdProb = pct;
        seqToast('Prob ' + pct + '%');
    } else if (knob === 3) {
        const idx = clampIdx(condIndexFor(seqState.holdCondA, seqState.holdCondB) + n, COND_PAIRS.length);
        const [a, b] = COND_PAIRS[idx];
        forEach((r) => seqCmd(`econd ${t} ${r.s0} ${r.s1} ${ln} ${a} ${b}`));
        seqState.holdCondA = a; seqState.holdCondB = b;
        seqToast('Cond ' + a + ':' + b);
    } else if (knob === 4) {
        const on = !seqState.holdInvert; // any turn toggles
        forEach((r) => seqCmd(`einv ${t} ${r.s0} ${r.s1} ${ln} ${on ? 1 : 0}`));
        seqState.holdInvert = on;
        seqToast(on ? 'Invert On' : 'Invert Off');
    }
    return true;
}

function clampIdx(i: number, len: number): number {
    return Math.max(0, Math.min(len - 1, i));
}
```

Note: `forEach` already calls `markGestured()`, so a turn won't toggle the note on release. The velocity branch must also mark gestured — it calls `forEach`, so it is covered. Call `resetStepPageKnobs()` from `resetStepEdit()` (add the call there).

- [ ] **Step 4: Route the knob CC in `src/midi/router.ts`**

In the knob-CC block (`if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE ...)`), add — before the `handleAutomationKnob` call — a step-page short-circuit:

```ts
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        // Step page owns the knobs while it is selected (intrinsic trig props,
        // never chain automation). Knobs 5..7 (index >=5) are blank → ignored.
        if (seqState.stepAutoMode && stepPageState.selected) {
            if (k < 5) editStepPageKnob(k, delta);
            return;
        }
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
```

Add the import: `import { editStepPageKnob } from '../seq/step-edit.js';` (extend the existing `step-edit` import which currently brings in `anyStepHeld`).

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/step-edit.ts src/midi/router.ts browser-test/app-loop.mjs
git commit -m "ui: knob turns on the step page edit trig props (evel/slen/eprob/econd/einv)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: Render dispatch — show the step page; mark the indicator during a session

**Files:**
- Modify: `src/app/tick.ts`
- Test: `browser-test/app-loop.mjs` (assert the rendered VM / log)

- [ ] **Step 1: Write the failing test**

`app-loop.mjs` drives `tick()` and can read the last-rendered framebuffer or a diag. The simplest robust assertion: when the step page is selected, the rendered header/title is `step`. If the harness exposes the framebuffer text or a render hook, assert it; otherwise assert via the diag log. Add:

```js
// With session active + step page selected, tick() renders the step page.
stepPageState.selected = true;
seqState.stepAutoMode = true;
parseStatusForTest('play=0 trk=0 step=3 hvel=100 hgate=48 hgmix=0 hprob=100 hcond=1:1 hinv=0');
appState.currentView = VIEW_KNOBS;
appState.dirty = true;
tick();
assert(lastRenderedTitleContains('step'), 'step page title rendered');
```

(If `app-loop.mjs` has no title hook, instead assert that `buildStepPageVM` is exercised by checking a observable side effect the harness already supports — e.g. extend the existing `diagAutoRender`-style log. Reuse whatever assertion mechanism the file already uses for "which view rendered".)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: FAIL — tick still renders the module page.

- [ ] **Step 3: Implement the dispatch**

In `src/app/tick.ts`, add imports:

```ts
import { stepPageState } from '../seq/step-page.js';
import { buildStepPageVM } from '../seq/step-page-vm.js';
```

Add a helper near `buildAutomationView`:

```ts
/* The held-step trig mirror as the step-page VM input. */
function heldTrigInput() {
    return {
        holdVel: seqState.holdVel, holdGate: seqState.holdGate, holdGateMixed: seqState.holdGateMixed,
        holdProb: seqState.holdProb, holdCondA: seqState.holdCondA, holdCondB: seqState.holdCondB,
        holdInvert: seqState.holdInvert,
    };
}
```

In the render block, modify the `VIEW_KNOBS` and `VIEW_CHAIN` branches. For `VIEW_KNOBS`:

```ts
        } else if (appState.currentView === VIEW_KNOBS) {
            const sessionActive = seqState.stepAutoMode;
            let vm;
            if (sessionActive && stepPageState.selected) {
                vm = buildStepPageVM(heldTrigInput());
            } else {
                vm = activeModel!.getViewModel(buildAutomationView(appState.activeSlot, activeModel!));
                if (sessionActive) { vm.stepPagePresent = true; vm.stepPageSelected = false; }
            }
            diagAutoRender(vm);
            renderKnobsView(vm, appState.jogTouched, appState.activeSlot);
            jogToastShown = (vm.automationHeld && vm.automationPoolFull)
                || !!vm.toast?.browseHint || appState.jogTouched;
            updateKnobLEDs(vm);
```

For `VIEW_CHAIN`:

```ts
        } else if (appState.currentView === VIEW_CHAIN) {
            const sessionActive = seqState.stepAutoMode;
            let vm;
            if (sessionActive && stepPageState.selected) {
                vm = buildStepPageVM(heldTrigInput());
            } else {
                vm = activeModel!.getViewModel(buildAutomationView(appState.activeSlot, activeModel!));
                if (sessionActive) { vm.stepPagePresent = true; vm.stepPageSelected = false; }
            }
            diagAutoRender(vm);
            renderChainView(vm, chainIdx, appState.jogTouched, 'T' + (appState.activeSlot + 1));
            jogToastShown = appState.jogTouched;
            updateKnobLEDs(vm);
```

Also force a repaint when the step-page selection changes: it changes via knob/jog handlers which already set `appState.dirty = true`; the session start/end also flips `stepAutoMode`. The existing `automationDisplayDirty()` repaint covers held-value changes, but add a guard so the step page repaints when its trig mirror changes. Add near the top of `tick()` after `stepAutoTick();`:

```ts
    // Repaint the step page when its mirrored trig values change.
    if (stepPageState.selected && stepTrigSig() !== lastStepTrigSig) {
        lastStepTrigSig = stepTrigSig();
        appState.dirty = true;
    }
```

and add module-level helpers in `tick.ts`:

```ts
let lastStepTrigSig = '';
function stepTrigSig(): string {
    return [seqState.holdVel, seqState.holdGate, seqState.holdGateMixed,
        seqState.holdProb, seqState.holdCondA, seqState.holdCondB, seqState.holdInvert].join(',');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/tick.ts browser-test/app-loop.mjs
git commit -m "ui: render the step page when selected; mark indicator during a session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5 — Full verification + device

### Task 16: Full local suite + perf

**Files:**
- Possibly modify: `browser-test/perf.mjs` (if a step-page perf scene is warranted)

- [ ] **Step 1: Build and run every local suite**

Run:
```bash
cd /Users/dake/git/cld/movy
npm run build:browser
node browser-test/logic.mjs
node browser-test/app-loop.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
npm run typecheck
(cd engine && cargo test)
```
Expected: every suite 0 failures; typecheck zero errors; cargo all green.

- [ ] **Step 2: If `screenshot.mjs` reports diffs from the `drawPresetValue` change**

The condition text-rendering change can shift existing `preset`-style baselines only if a non-numeric preset existed before (none should). If any legitimate baseline changed, regenerate and eyeball:
Run: `node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs`
Expected: 0 failures; confirm only intended scenes changed (`git diff --stat browser-test/baselines`).

- [ ] **Step 3: Add a step-page perf scene if the harness expects coverage for each render path**

Inspect `browser-test/perf.mjs`. If it enumerates render scenes for fill_rect/IPC budgets, add a `buildStepPageVM(...)` + `renderKnobsView` scene and assert it stays within the existing per-frame budget (copy the threshold style used by neighboring scenes). Run `node browser-test/perf.mjs`; Expected: PASS.

- [ ] **Step 4: Commit any test additions**

```bash
git add browser-test/perf.mjs browser-test/baselines 2>/dev/null; git commit -m "test: step-page perf scene + baseline refresh" || echo "nothing to commit"
```

(End the commit message body with the Co-Authored-By line as in prior tasks.)

---

### Task 17: Device deploy + sequencer e2e

**Files:** none (deploy/test scripts)

- [ ] **Step 1: Check device reachability**

Run: `ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && echo ONLINE || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"`

- [ ] **Step 2: If ONLINE — deploy engine + UI and run the sequencer e2e**

Run:
```bash
cd /Users/dake/git/cld/movy
./scripts/build-dsp.sh
./scripts/deploy.sh
./scripts/test-seq.sh
```
Expected: `test-seq.sh` PASS. The hot-reload re-loads `dsp.so` v0.19.0 (UI probes `ping` until the version matches).

- [ ] **Step 3: Manually confirm the new behavior on device (automated assertion if test-seq supports it; else log inspection)**

With the live log tailing (`ssh ableton@move.local 'tail -f /data/UserData/schwung/debug.log | grep "\[movy\]"'`):
- Hold a step → jog left → step page appears with the dotted selected indicator and `step` title.
- Turn knob 4 to set a condition (e.g. 2:2), play, and confirm the trig sounds only every other cycle.
- Set a step's probability to 0% and confirm it never sounds; 100% always sounds.
- Reload movy and confirm condition/probability persisted.

- [ ] **Step 4: If OFFLINE**

Print to the user, in CAPS: `DEVICE OFFLINE — DEVICE VERIFICATION SKIPPED`.

---

### Task 18: Final commit/push

- [ ] **Step 1: Confirm clean tree and all suites green (re-run Task 16 Step 1 if anything changed).**

- [ ] **Step 2: Push**

Run: `git push`
Expected: pushes all Phase 1–5 commits to `origin/main`.

---

## Self-review notes (for the implementer)

- **Trig granularity** is `(step, lane)` with `lane = Some(pitch)` (drum) / `None` (melodic), matching `Clip::note_matches`. The scheduler resolves the most specific governing trig and shares one decision across a chord (Task 3 cache).
- **Velocity** never has an absolute "set"; it uses `evel` delta, which clamps to 127 so full-CW makes all notes max even if they differed (the explicit requirement). Mixed velocity shows the bar at the engine-reported average.
- **Length** mixed → `...`; editing sets all matching notes to the picked absolute value via `slen`.
- **Method/field names** are consistent across tasks: `governing_trig`, `set_trig_prob/cond/invert`, `condition_plays`, `Track.cycle`, status keys `hvel/hgate/hgmix/hprob/hcond/hinv`, `stepPageState`, `buildStepPageVM`, `editStepPageKnob`, `getKnobPage`, ViewModel `stepPagePresent/stepPageSelected`.
- **Test harness hooks** (`assertEq`/`assert`, `injectCC`/`turnKnob`, baseline scene shape, `lastRenderedTitleContains`) are referenced generically — confirm the exact helper names in each `browser-test/*.mjs` file before writing the test, and adapt the snippet to them.
