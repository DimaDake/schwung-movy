# Non-Destructive Quantization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn quantization from a destructive one-shot action into a per-clip 0–100% strength applied at note emission, with a set-level default that new clips inherit and a machine-level default that new sets inherit.

**Architecture:** `Note.step` is already the quantize target, so quantization is an interpolation between `n.tick` and `n.step * TICKS_PER_STEP + swing` computed in the emit path — no new per-note storage and no change to any consumer, because locks, trigs, LEDs and step editing are all keyed on `step`, never `tick`. Clip strength persists in the engine blob's existing `cp` line; the set default persists in the UI blob with a new machine-level `prefs.json` as its fallback.

**Tech Stack:** Rust (`engine/crates/seq-core`, `cargo test`), TypeScript (`src/`, esbuild → `ui.js`), node test suites in `browser-test/`.

**Design doc:** `movy/plans/2026-08-08-nondestructive-quantization-design.md` — read it before starting. It records *why* each decision was made; this plan records *what to type*.

## Global Constraints

- **File size: hard limit 200 lines, target 50–100.** Split rather than exceed.
- **ENGINE_VERSION must match** between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts`. Any engine change in this plan requires bumping both (Task 2 does it once).
- Comments explain WHY (constraints, invariants, workarounds), never WHAT.
- No code duplication — refactor into a shared location before adding a second copy.
- Performance matters: the emit loop runs per note per tick at 63–205 Hz. `browser-test/perf.mjs` must not regress.
- New rendering logic → screenshot test. New business logic → logic test.
- `cargo` is not on PATH: use `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo`.
- Percentages are `u8` 0..=100 everywhere; the UI list is `[0,10,…,100]`.

---

### Task 1: Engine — clip quantization applied at emit

**Files:**
- Modify: `engine/crates/seq-core/src/clip.rs` (`Note`, `Clip`, `Clip::new`, `release_suppressed`)
- Modify: `engine/crates/seq-core/src/engine.rs` (`step_tick` emit block ~1470–1520; wrap handler ~1545)
- Test: `engine/crates/seq-core/src/engine.rs` (`mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `Clip.quant: u8` (0..=100, default 0), `Note.fired: bool`, `Clip::release_pass_flags(&mut self)` replacing `release_suppressed`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `engine.rs`:

```rust
/// Clip-position tick at which the note on `step` actually fires.
/// Mirrors `swing_delays_offbeat_steps_only`: status `tick=` is
/// post-increment and the note fires while pos == master_tick - 1.
fn fire_pos(e: &mut Engine, pitch: u8) -> u64 {
    let mut out = Vec::new();
    for _ in 0..(TICKS_PER_STEP * 40) {
        let before = e.clock.tick;
        e.advance_block(FRAMES, &mut out);
        if out.iter().any(|ev| matches!(ev, OutEvent::NoteOn { pitch: p, .. } if *p == pitch)) {
            return before;
        }
        out.clear();
    }
    panic!("note {pitch} never fired");
}

#[test]
fn quant_100_snaps_to_grid() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
    e.tracks[0].active_mut().nudge(2, 2, None, 7);   // tick 48 -> 55
    e.tracks[0].active_mut().quant = 100;
    e.launch_clip(0, 0);
    assert_eq!(fire_pos(&mut e, 60), (2 * TICKS_PER_STEP) as u64);
}

#[test]
fn quant_0_plays_raw_timing() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
    e.tracks[0].active_mut().nudge(2, 2, None, 7);
    e.tracks[0].active_mut().quant = 0;
    e.launch_clip(0, 0);
    assert_eq!(fire_pos(&mut e, 60), (2 * TICKS_PER_STEP + 7) as u64);
}

#[test]
fn quant_0_does_not_apply_swing() {
    // Swing is a property of the grid we pull toward, so an unquantized
    // take must not be swung on top of the timing that was played.
    let mut e = engine();
    e.swing_pct = 66;
    e.tracks[0].active_mut().toggle_step(1, &[(60, 100)]);   // off-beat 16th
    e.tracks[0].active_mut().nudge(1, 1, None, 5);
    e.tracks[0].active_mut().quant = 0;
    e.launch_clip(0, 0);
    assert_eq!(fire_pos(&mut e, 60), (TICKS_PER_STEP + 5) as u64);
}

#[test]
fn quant_50_lands_midway_toward_grid() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
    e.tracks[0].active_mut().nudge(2, 2, None, 8);   // 8 ticks late
    e.tracks[0].active_mut().quant = 50;
    e.launch_clip(0, 0);
    assert_eq!(fire_pos(&mut e, 60), (2 * TICKS_PER_STEP + 4) as u64);
}

#[test]
fn quant_pulls_early_note_forward() {
    // A note before its anchor moves later as strength rises (rounding must
    // work in both directions).
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
    e.tracks[0].active_mut().nudge(2, 2, None, -8);
    e.tracks[0].active_mut().quant = 50;
    e.launch_clip(0, 0);
    assert_eq!(fire_pos(&mut e, 60), (2 * TICKS_PER_STEP - 4) as u64);
}

#[test]
fn quant_change_mid_pass_does_not_double_trigger() {
    // Note fires quantized at step 2; dropping strength moves its target
    // later in the same pass. Without `fired` it sounds twice.
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
    e.tracks[0].active_mut().nudge(2, 2, None, 9);
    e.tracks[0].active_mut().quant = 100;
    e.launch_clip(0, 0);
    let mut out = Vec::new();
    while e.tracks[0].pos_tick < 2 * TICKS_PER_STEP + 3 {
        e.advance_block(FRAMES, &mut out);
    }
    e.tracks[0].active_mut().quant = 0;
    while e.tracks[0].pos_tick < 3 * TICKS_PER_STEP {
        e.advance_block(FRAMES, &mut out);
    }
    let ons = out.iter()
        .filter(|ev| matches!(ev, OutEvent::NoteOn { pitch: 60, .. }))
        .count();
    assert_eq!(ons, 1, "the note already sounded this pass");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core quant_`
Expected: FAIL — `no field 'quant' on type 'Clip'`.

- [ ] **Step 3: Add the fields**

In `clip.rs`, add to `Note` (after `suppress`):

```rust
    /// Already sounded this pass. Cleared on wrap alongside `suppress`: a
    /// quantization change can move a note's fire tick past the playhead
    /// after it has played, which would otherwise retrigger it.
    pub fired: bool,
```

Add to `Clip` (after `transpose`):

```rust
    /// Non-destructive timing strength, 0..=100 %. Interpolates each note's
    /// emitted tick between what was played and its `step` anchor; stored
    /// ticks are never modified. 0 on legacy saves, so they sound unchanged.
    pub quant: u8,
```

Set `quant: 0` in `Clip::new()`. Add `fired: false` to every `Note { … }` literal in `clip.rs` (`record_note`, `push_note`, `add_note_raw`) — the compiler lists them.

Rename `release_suppressed` to `release_pass_flags` and clear both:

```rust
    /// Start a fresh pass: recorded notes become audible and every note is
    /// eligible to fire again.
    pub fn release_pass_flags(&mut self) {
        for n in &mut self.notes {
            n.suppress = false;
            n.fired = false;
        }
    }
```

- [ ] **Step 4: Rewrite the emit tick calculation**

In `engine.rs` `step_tick`, replace

```rust
                        let fire_tick = n.tick + self.swing_delay(n.step, snum, sden);
                        if fire_tick != pos || n.suppress {
                            continue;
                        }
```

with

```rust
                        // Non-destructive quantization: interpolate between
                        // the tick that was played and the note's `step`
                        // anchor (the swung grid position). 100 % reproduces
                        // the old destructive quantize exactly; 0 % plays the
                        // take as recorded, unswung — swing belongs to the
                        // grid we pull toward, so a hand-swung note must not
                        // be swung twice.
                        let grid = n.step as u32 * TICKS_PER_STEP
                            + self.swing_delay(n.step, snum, sden);
                        let d = grid as i64 - n.tick as i64;
                        let half = if d >= 0 { 50 } else { -50 };
                        let off = (d * quant as i64 + half) / 100;
                        let mut fire_tick = (n.tick as i64 + off).max(0) as u32;
                        // A note played just before a bar line anchors to the
                        // next bar's downbeat: at full strength that target
                        // lands on the loop end, which is the loop start.
                        // Interpolating toward the UNwrapped target and
                        // wrapping the result keeps partial strengths from
                        // sweeping backwards through the whole bar.
                        if fire_tick >= end {
                            fire_tick -= self.tracks[ti].clips[slot].length_ticks().max(1);
                        }
                        if fire_tick != pos || n.suppress || n.fired {
                            continue;
                        }
                        self.tracks[ti].clips[slot].notes[ni].fired = true;
```

`end` is computed further down today; hoist `let end = self.tracks[ti].clips[slot].loop_end_ticks();` above the note loop and reuse it at the wrap site. Read `quant` next to `snum`/`sden`:

```rust
                    let quant = self.tracks[ti].clips[slot].quant.min(100);
```

`fired` is set **before** the probability/condition branch — a note that rolls "skip" has still had its turn this pass.

- [ ] **Step 5: Clear pass flags on wrap and on launch**

Rename the wrap-site call `release_suppressed()` → `release_pass_flags()`. Add the same call where a queued launch resets the playhead (`service_tick`, the `queued_slot.take()` block), so stale flags from a previous pass cannot silence bar 1:

```rust
                    t.clips[slot].release_pass_flags();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core`
Expected: PASS, whole suite green.

- [ ] **Step 7: Prove the `fired` test has teeth**

Temporarily delete `|| n.fired` from the emit guard, re-run
`cargo test -p seq-core quant_change_mid_pass`. Expected: FAIL with `ons == 2`.
Restore the guard.

- [ ] **Step 8: Commit**

```bash
git add engine/crates/seq-core/src/clip.rs engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(engine): non-destructive per-clip quantization at emit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Engine — set default, commands, status; drop destructive quantize

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`Engine` struct + `new`, `quantize_active` removal, status `format!`)
- Modify: `engine/crates/seq-core/src/clip.rs` (delete `Clip::quantize`)
- Modify: `engine/crates/seq-core/src/command.rs` (`quant` removal, `cq`/`dq`)
- Modify: `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` (ENGINE_VERSION)

**Interfaces:**
- Consumes: `Clip.quant` (Task 1).
- Produces: `Engine.default_quant: u8`; `Engine::reseed_empty_clips(&mut self)`; commands `cq <track> <pct>` and `dq <pct>`; status keys `quant=<pct>` (active clip) and `dquant=<pct>`.

- [ ] **Step 1: Write the failing tests**

In `command.rs` `mod tests`:

```rust
#[test]
fn cq_sets_active_clip_quantization() {
    let mut e = engine();
    let mut out = Vec::new();
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    dispatch(&mut e, "cq 0 70", &mut out);
    assert_eq!(e.tracks[0].active().quant, 70);
    dispatch(&mut e, "cq 0 250", &mut out);
    assert_eq!(e.tracks[0].active().quant, 100, "clamped");
}

#[test]
fn new_clip_inherits_default_quant() {
    let mut e = engine();
    let mut out = Vec::new();
    dispatch(&mut e, "dq 60", &mut out);
    e.tracks[0].clips[3].toggle_step(0, &[(60, 100)]);
    assert_eq!(e.tracks[0].clips[3].quant, 60);
}

#[test]
fn default_change_does_not_retime_existing_clips() {
    let mut e = engine();
    let mut out = Vec::new();
    dispatch(&mut e, "dq 40", &mut out);
    e.tracks[0].clips[0].toggle_step(0, &[(60, 100)]);
    dispatch(&mut e, "dq 90", &mut out);
    assert_eq!(e.tracks[0].clips[0].quant, 40, "clips own a copy, not a link");
    e.tracks[0].clips[1].toggle_step(0, &[(60, 100)]);
    assert_eq!(e.tracks[0].clips[1].quant, 90);
}

#[test]
fn cleared_slot_reseeds_to_current_default() {
    let mut e = engine();
    let mut out = Vec::new();
    dispatch(&mut e, "dq 30", &mut out);
    e.tracks[0].clips[0].toggle_step(0, &[(60, 100)]);
    dispatch(&mut e, "dq 80", &mut out);
    dispatch(&mut e, "clipdel 0 0", &mut out);
    e.tracks[0].clips[0].toggle_step(0, &[(60, 100)]);
    assert_eq!(e.tracks[0].clips[0].quant, 80);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core -- cq_ new_clip_inherits default_change cleared_slot`
Expected: FAIL — unknown command / field.

- [ ] **Step 3: Add the engine field and the seeding sweep**

In `engine.rs`, add to `Engine` and initialise `default_quant: 0` in `new()`:

```rust
    /// Set-level quantization stamped onto clips as they are created. Held in
    /// every EMPTY clip too (see reseed_empty_clips), so a clip is born with
    /// the right value and no creation path needs to know about the default.
    pub default_quant: u8,
```

```rust
    /// Push the default into every slot that holds no clip yet. Cheap (32
    /// checks) and idempotent, so it can run wherever creation may follow.
    pub fn reseed_empty_clips(&mut self) {
        let q = self.default_quant;
        for t in &mut self.tracks {
            for c in &mut t.clips {
                if !c.exists() {
                    c.quant = q;
                }
            }
        }
    }
```

- [ ] **Step 4: Wire the commands and delete the destructive path**

In `command.rs`, replace the `quant` arm with:

```rust
        // cq <track> <pct> — active clip quantization strength (0..=100).
        Some("cq") => {
            if let (Some(t), Some(v)) = (next_num(&mut it), next_num(&mut it)) {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].active_mut().quant = v.clamp(0, 100) as u8;
                }
            }
        }
        // dq <pct> — set-level default, stamped onto clips created from here on.
        Some("dq") => {
            if let Some(v) = next_num(&mut it) {
                engine.default_quant = v.clamp(0, 100) as u8;
            }
        }
```

(Match the argument-parsing helper the neighbouring `ctr` arm uses; copy its
shape rather than inventing one.)

At the end of `dispatch`, after the match, add:

```rust
    // Any command may have created or cleared a clip; an empty slot must
    // always carry the current default so it is born with it.
    engine.reseed_empty_clips();
```

Delete `Engine::quantize_active` (engine.rs:705), `Clip::quantize` (clip.rs:389), the `quant` command arm, and the `quantize_snaps_notes_to_grid` test plus its `apply_quant` helper.

- [ ] **Step 5: Add the status keys**

In the status `format!` (engine.rs:1841), append ` quant={} dquant={}` to the format string and `clip.quant, self.default_quant` to the argument list, immediately after `ctr`.

- [ ] **Step 6: Bump ENGINE_VERSION**

Increment the version in `engine/crates/movy-dsp/src/lib.rs` and the matching
`ENGINE_VERSION` in `src/seq/constants.ts`. They must be identical or
`build-dsp.sh` fails.

- [ ] **Step 7: Run the tests**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add engine/crates/seq-core/src engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
feat(engine): cq/dq commands, default quantization seeding; drop destructive quantize

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Engine — persist clip quantization

**Files:**
- Modify: `engine/crates/seq-core/src/persist.rs` (module doc, `serialize` `cp` line, `cp` parse arm, end of `load`)
- Test: `engine/crates/seq-core/src/persist.rs` (`mod tests`)

**Interfaces:**
- Consumes: `Clip.quant`, `Engine::reseed_empty_clips`.
- Produces: `cp <track> <slot> <scale_num> <scale_den> <transpose> <quant>`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn roundtrips_clip_quant() {
    let mut e = Engine::new(44100, 12000);
    e.tracks[0].clips[0].toggle_step(0, &[(60, 100)]);
    e.tracks[0].clips[0].quant = 70;
    let blob = serialize(&e);
    let mut e2 = Engine::new(44100, 12000);
    assert!(load(&mut e2, &blob));
    assert_eq!(e2.tracks[0].clips[0].quant, 70);
}

#[test]
fn legacy_cp_line_loads_quant_zero() {
    // Five-field `cp` is every save written before this feature. Those clips
    // must stay at 0 so existing sets sound exactly as they did.
    let blob = "movy1\ncl 0 0 16 0 0:24:60:100\ncp 0 0 1 1 0\n";
    let mut e = Engine::new(44100, 12000);
    e.default_quant = 80;
    assert!(load(&mut e, blob));
    assert_eq!(e.tracks[0].clips[0].quant, 0);
}

#[test]
fn load_reseeds_empty_slots_only() {
    let blob = "movy1\ncl 0 0 16 0 0:24:60:100\ncp 0 0 1 1 0\n";
    let mut e = Engine::new(44100, 12000);
    e.default_quant = 80;
    assert!(load(&mut e, blob));
    assert_eq!(e.tracks[0].clips[0].quant, 0, "loaded clip keeps its value");
    assert_eq!(e.tracks[0].clips[1].quant, 80, "empty slot carries the default");
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core -- roundtrips_clip_quant legacy_cp load_reseeds`
Expected: FAIL.

- [ ] **Step 3: Extend serialize**

```rust
                s.push_str(&format!(
                    "cp {} {} {} {} {} {}\n",
                    ti, ci, c.scale_num, c.scale_den, c.transpose, c.quant
                ));
```

Update the module-doc line format block to show the sixth field.

- [ ] **Step 4: Extend the parse arm**

In the `Some("cp")` arm, after `c.transpose = tr.clamp(-36, 36);`, add — reading
the optional sixth token *inside* the existing `if let`:

```rust
                        // Sixth field absent = saved before non-destructive
                        // quantization existed. Those notes were already hard
                        // quantized or were meant to stay raw, so 0 keeps the
                        // set sounding exactly as it did.
                        c.quant = it.next()
                            .and_then(|x| x.parse::<u8>().ok())
                            .unwrap_or(0)
                            .min(100);
```

- [ ] **Step 5: Reseed after load**

At the end of `load`, just before `true`:

```rust
    // Slots that stayed empty must carry the current default; loaded clips
    // keep whatever their `cp` line said (0 on legacy saves).
    engine.reseed_empty_clips();
```

- [ ] **Step 6: Run the tests**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/crates/seq-core/src/persist.rs
git commit -m "$(cat <<'EOF'
feat(engine): persist per-clip quantization in the cp line

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Engine — capture notes played inside the count-in

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`RecPending`, `live_note_on`, `live_note_off`)
- Test: `engine/crates/seq-core/src/engine.rs` (`mod tests`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `RecPending.start_tick: i32`.

**Why:** `live_note_on` gates on `self.recording`, which flips true only when
`count_in_left` reaches 0, so a note played just before the downbeat never
reaches `rec_pending` and is lost outright. During the count-in `pos_tick` never
advances, so `count_in_left` *is* the note's distance before recording start.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn preroll_note_is_captured_at_step_zero() {
    let mut e = engine();
    let mut out = Vec::new();
    e.toggle_record(0);
    assert!(e.count_in_left > 0);
    while e.count_in_left > 6 {
        e.advance_block(FRAMES, &mut out);
    }
    e.live_note_on(0, 60, 100);
    while e.count_in_left > 0 {
        e.advance_block(FRAMES, &mut out);
    }
    e.live_note_off(0, 60);
    let n = e.tracks[0].active().notes.iter().find(|n| n.pitch == 60);
    assert!(n.is_some(), "a note played inside the count-in must be recorded");
    assert_eq!(n.unwrap().step, 0);
    assert_eq!(n.unwrap().tick, 0);
}

#[test]
fn preroll_gate_spans_the_count_in() {
    // Gate is measured from the signed start, so a note held from before the
    // downbeat keeps its true length instead of being clipped short.
    let mut e = engine();
    let mut out = Vec::new();
    e.toggle_record(0);
    while e.count_in_left > 6 {
        e.advance_block(FRAMES, &mut out);
    }
    e.live_note_on(0, 60, 100);
    while e.count_in_left > 0 {
        e.advance_block(FRAMES, &mut out);
    }
    let target = e.tracks[0].pos_tick + 10;
    while e.tracks[0].pos_tick < target {
        e.advance_block(FRAMES, &mut out);
    }
    e.live_note_off(0, 60);
    let n = e.tracks[0].active().notes.iter().find(|n| n.pitch == 60).unwrap();
    assert!(n.gate >= 16, "gate {} should span the pre-roll", n.gate);
}

#[test]
fn preroll_note_released_before_recording_still_records() {
    let mut e = engine();
    let mut out = Vec::new();
    e.toggle_record(0);
    while e.count_in_left > 8 {
        e.advance_block(FRAMES, &mut out);
    }
    e.live_note_on(0, 62, 100);
    e.live_note_off(0, 62);
    assert!(e.tracks[0].active().notes.iter().any(|n| n.pitch == 62));
}

#[test]
fn note_earlier_than_half_a_step_is_ignored() {
    // Beyond half a step it belongs to a different grid position, and
    // record_note's own rounding boundary is exactly there.
    let mut e = engine();
    let mut out = Vec::new();
    e.toggle_record(0);
    while e.count_in_left > TICKS_PER_STEP {
        e.advance_block(FRAMES, &mut out);
    }
    e.live_note_on(0, 64, 100);
    e.live_note_off(0, 64);
    assert!(!e.tracks[0].active().notes.iter().any(|n| n.pitch == 64));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core preroll`
Expected: FAIL — note absent.

- [ ] **Step 3: Widen the recording window**

Change `RecPending.start_tick` to `i32`. Add above `live_note_on`:

```rust
    /// Ticks before the recording start at which a note still belongs to the
    /// take. Half a step is where `record_note` already puts the boundary
    /// between one grid position and the next — this removes an artificial
    /// floor at zero rather than inventing a rule. At PPQN 96 it is ~62 ms
    /// at 120 BPM: wider than human push, narrow enough not to swallow a
    /// deliberate pickup, and it scales with tempo for free.
    fn preroll_offset(&self) -> Option<i32> {
        if self.count_in_left > 0 && self.count_in_left <= TICKS_PER_STEP / 2 {
            Some(-(self.count_in_left as i32))
        } else {
            None
        }
    }
```

In `live_note_on`, replace the `self.recording` gate:

```rust
        if track >= NUM_TRACKS || track != self.rec_track {
            return;
        }
        let start_tick = if self.recording {
            self.tracks[track].pos_tick as i32
        } else if let Some(off) = self.preroll_offset() {
            off
        } else {
            return;
        };
        self.rec_pending.push(RecPending { pitch, vel, start_tick });
```

(Keep the `capture_push` call first, unchanged.)

In `live_note_off`, replace the early return and the gate arithmetic:

```rust
        if track >= NUM_TRACKS || track != self.rec_track {
            return;
        }
        if !self.recording && self.preroll_offset().is_none() {
            return;
        }
        if let Some(idx) = self.rec_pending.iter().rposition(|p| p.pitch == pitch) {
            let p = self.rec_pending.swap_remove(idx);
            let now = self.tracks[track].pos_tick as i32;
            let span = self.tracks[track].active().length_ticks().max(1) as i32;
            let gate = if now >= p.start_tick { now - p.start_tick } else { span - p.start_tick + now };
            let stored = (pitch as i32 - self.active_clip_transpose(track)).clamp(0, 127) as u8;
            // Anchor at the clip start: the push itself is not preserved
            // (that would need notes stored before their anchor), but the
            // gate keeps its true length from the signed start.
            self.tracks[track]
                .active_mut()
                .record_note(p.start_tick.max(0) as u32, gate.max(1) as u32, stored, p.vel);
        }
```

- [ ] **Step 4: Run the tests**

Run: `cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p seq-core`
Expected: PASS, whole suite green (`recording_captures_live_notes_after_count_in` still passes).

- [ ] **Step 5: Prove the test has teeth**

Temporarily restore the `self.recording &&` gate in `live_note_on`, re-run
`cargo test -p seq-core preroll_note_is_captured`. Expected: FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
fix(engine): capture notes played inside the count-in instead of dropping them

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: UI — quantization value list and shortcut cycle (pure logic)

**Files:**
- Create: `src/seq/quant.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `QUANT_VALUES: number[]` — `[0,10,…,100]`
  - `QUANT_LABELS: string[]` — `['0%','10%',…,'100%']`
  - `quantIndexForPct(pct: number): number`
  - `quantCandidates(defPct: number): number[]` — ascending, deduped
  - `nextQuantCandidate(cur: number, defPct: number): number`

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic.mjs`, following the file's existing
`check(name, cond)` style:

```js
import { quantCandidates, nextQuantCandidate, quantIndexForPct }
    from '../dist/esm/seq/quant.js';

check('quant candidates are 0/def/100',
    JSON.stringify(quantCandidates(70)) === JSON.stringify([0, 70, 100]));
check('quant candidates dedupe when default is 0',
    JSON.stringify(quantCandidates(0)) === JSON.stringify([0, 100]));
check('quant candidates dedupe when default is 100',
    JSON.stringify(quantCandidates(100)) === JSON.stringify([0, 100]));
check('quant cycle advances to the next higher candidate',
    nextQuantCandidate(0, 70) === 70 && nextQuantCandidate(70, 70) === 100);
check('quant cycle wraps from the top',
    nextQuantCandidate(100, 70) === 0);
check('quant cycle from an off-cycle value picks the next higher',
    nextQuantCandidate(40, 70) === 70 && nextQuantCandidate(80, 70) === 100);
check('quant cycle wraps from above the top candidate',
    nextQuantCandidate(100, 0) === 0);
check('quant index maps to the nearest listed value',
    quantIndexForPct(0) === 0 && quantIndexForPct(70) === 7
        && quantIndexForPct(100) === 10);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
/* Quantization strengths and the Shift+Step 16 cycle.
 *
 * The cycle is 0 / the set default / 100 — off, your taste, dead on grid.
 * From any value it advances to the next higher candidate and wraps, so the
 * button always reads as "tighten" and one press from a knob-dialled value
 * lands somewhere predictable. */

export const QUANT_VALUES: number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const QUANT_LABELS: string[] = QUANT_VALUES.map((v) => v + '%');

/** Index of the listed value nearest `pct` (the enum cell's selection). */
export function quantIndexForPct(pct: number): number {
    let best = 0;
    for (let i = 1; i < QUANT_VALUES.length; i++) {
        if (Math.abs(QUANT_VALUES[i] - pct) < Math.abs(QUANT_VALUES[best] - pct)) best = i;
    }
    return best;
}

/** Ascending 0 / default / 100, collapsed to two when the default is an end. */
export function quantCandidates(defPct: number): number[] {
    const d = Math.max(0, Math.min(100, Math.round(defPct)));
    return d === 0 || d === 100 ? [0, 100] : [0, d, 100];
}

/** The next candidate strictly above `cur`, wrapping to the lowest. */
export function nextQuantCandidate(cur: number, defPct: number): number {
    const c = quantCandidates(defPct);
    return c.find((v) => v > cur) ?? c[0];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/seq/quant.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): quantization value list and Shift+Step 16 cycle logic

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: UI — machine-level prefs file for the default

**Files:**
- Create: `src/seq/prefs.ts`
- Modify: `src/seq/ui-state.ts` (serialize/apply/reset)
- Modify: `src/undo/ui-fields.ts` (`UiField` union, reader, writer)
- Modify: `src/seq/state.ts` (`defaultQuant` mirror)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `seqCmd` from `src/seq/engine.js`.
- Produces:
  - `readPrefDefaultQuant(): number`
  - `writePrefDefaultQuant(pct: number): void`
  - `seqState.defaultQuant: number`
  - `UiField` gains `'defaultQuant'`.

**Why a new file:** everything movy persists today is owned by a set UUID. The
default must survive into *new* sets, so it needs machine-level storage — the
first such state, deliberately placed one level above `SETS_DIR` so the
filesystem shows it belongs to no set.

- [ ] **Step 1: Write the failing tests**

```js
import { readPrefDefaultQuant, writePrefDefaultQuant, PREFS_PATH }
    from '../dist/esm/seq/prefs.js';

// The suite already stubs host_read_file / host_write_file; follow whatever
// stub helper logic.mjs uses for persist-store tests.
globalThis.host_write_file = (p, c) => { files[p] = c; return true; };
globalThis.host_read_file  = (p) => (p in files ? files[p] : null);

files = {};
check('missing prefs fall back to the factory default',
    readPrefDefaultQuant() === 0);

files = {}; writePrefDefaultQuant(70);
check('prefs round-trip', readPrefDefaultQuant() === 70);

files = { [PREFS_PATH]: '{not json' };
check('corrupt prefs fall back to the factory default',
    readPrefDefaultQuant() === 0);

files = { [PREFS_PATH]: JSON.stringify({ defaultQuant: 999 }) };
check('out-of-range prefs are clamped', readPrefDefaultQuant() === 100);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/seq/prefs.ts`**

```ts
/* Machine-level preferences — the one piece of movy state no set owns.
 *
 * Lives one level above SETS_DIR so the filesystem shows the distinction. Its
 * durability is deliberately much cheaper than seq-state's: losing that file
 * loses the user's music, losing this one loses a number they retype once, so
 * there is no shadow rotation and no generation counter — just a verified
 * write. */

import { safeWrite } from './persist-store.js';

export const PREFS_PATH = '/data/UserData/schwung/modules/tools/movy/prefs.json';

/* 0 %, not 100 %: movy has always recorded raw with quantize as a manual
 * press, so a fresh install must change nothing until the user chooses. */
export const FACTORY_DEFAULT_QUANT = 0;

const clampPct = (v: unknown): number =>
    typeof v === 'number' && isFinite(v)
        ? Math.max(0, Math.min(100, Math.round(v)))
        : FACTORY_DEFAULT_QUANT;

export function readPrefDefaultQuant(): number {
    if (typeof host_read_file !== 'function') return FACTORY_DEFAULT_QUANT;
    const raw = host_read_file(PREFS_PATH);
    if (!raw) return FACTORY_DEFAULT_QUANT;
    try {
        return clampPct(JSON.parse(raw).defaultQuant);
    } catch {
        return FACTORY_DEFAULT_QUANT;
    }
}

export function writePrefDefaultQuant(pct: number): void {
    safeWrite(PREFS_PATH, JSON.stringify({ defaultQuant: clampPct(pct) }));
}
```

- [ ] **Step 4: Add the state mirror and UI-state persistence**

In `src/seq/state.ts`, add to the `seqState` interface and its initialiser:

```ts
    defaultQuant: number;    // set-level quantization default (from `dquant=`)
```

In `src/seq/engine.ts`'s status parser, next to the `ctr` line:

```ts
        else if (key === 'quant') seqState.clipQuant = Number(val) || 0;
        else if (key === 'dquant') seqState.defaultQuant = Number(val) || 0;
```

(add `clipQuant: number;` to `seqState` too — it mirrors the active clip.)

In `src/seq/ui-state.ts`: add `defaultQuant: seqState.defaultQuant` to
`serializeUiState()`; in `applyUiState()` resolve and push it —

```ts
        /* Absent = a set written before this feature, or a brand new one.
         * Both should adopt the machine default rather than snap to zero. */
        const dq = typeof o.defaultQuant === 'number'
            ? clampInt(o.defaultQuant, 0, 100, readPrefDefaultQuant())
            : readPrefDefaultQuant();
        seqState.defaultQuant = dq;
        seqCmd('dq ' + dq);
```

and in `resetUiState()` set `seqState.defaultQuant = readPrefDefaultQuant();`.

- [ ] **Step 5: Add the undo field**

In `src/undo/ui-fields.ts`: extend the union to
`'rootPc' | 'scale' | 'mutes' | 'defaultQuant'`, return
`String(seqState.defaultQuant)` from `readUiField`, and in `writeUiField` handle
it before the numeric tail:

```ts
    if (f === 'defaultQuant') {
        const q = Math.max(0, Math.min(100, Number(v) || 0));
        seqState.defaultQuant = q;
        seqCmd('dq ' + q);
        writePrefDefaultQuant(q);
        markUiStateDirty();
        return;
    }
```

- [ ] **Step 6: Run the tests**

Run: `npm run build:browser && node browser-test/logic.mjs && npm run typecheck`
Expected: PASS, 0 failures, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add src/seq/prefs.ts src/seq/ui-state.ts src/seq/state.ts src/seq/engine.ts src/undo/ui-fields.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): machine-level prefs file for the quantization default

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: UI — QUANT cells on the Clip Params and Main Params pages

**Files:**
- Modify: `src/seq/clip-page.ts` (`KNOB_VERBS`, `clipPageKnob`)
- Modify: `src/seq/clip-page-vm.ts` (new cell, row array)
- Modify: `src/seq/main-page.ts` (knob 3 handler)
- Modify: `src/seq/main-page-vm.ts` (new cell, `cells` array)
- Modify: `src/midi/router.ts` (clip-page knob gate `d1 < 3` → `d1 < 4`)
- Test: `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `QUANT_LABELS`, `quantIndexForPct` (Task 5); `seqState.clipQuant`, `seqState.defaultQuant` (Task 6).
- Produces: nothing new.

- [ ] **Step 1: Add the clip-page cell**

In `clip-page-vm.ts`, mirroring the TRANS cell at line 37:

```ts
    const quant = cell({
        shortName: 'QUANT', fullName: 'Clip Quantize', type: 'enum',
        options: QUANT_LABELS,
        enumIndex: quantIndexForPct(seqState.clipQuant),
        displayValue: seqState.clipQuant + '%',
        normalizedValue: seqState.clipQuant / 100,
    });
```

and put it in the free knob-3 slot: `rows: [[scale, length, transpose, quant], [null, null, null, null]]`.

- [ ] **Step 2: Add the clip-page knob handler**

In `clip-page.ts`, add `3: 'CLIP QUANT'` to `KNOB_VERBS`, and in `clipPageKnob`
after the `k === 2` branch:

```ts
    } else if (k === 3) {
        const i = Math.max(0, Math.min(QUANT_VALUES.length - 1,
            quantIndexForPct(seqState.clipQuant) + n));
        const next = QUANT_VALUES[i];
        if (next !== seqState.clipQuant) {
            seqState.clipQuant = next;
            seqCmd('cq ' + track + ' ' + next);
        }
    }
```

In `src/midi/router.ts`, the clip-page knob-touch gate `if (d1 < 3)` becomes
`if (d1 < 4)`.

- [ ] **Step 3: Add the main-page cell and handler**

In `main-page-vm.ts`, mirroring the SWING cell:

```ts
    const quant = cell({
        shortName: 'QUANT', fullName: 'Default Quantize', type: 'enum',
        options: QUANT_LABELS,
        enumIndex: quantIndexForPct(seqState.defaultQuant),
        displayValue: seqState.defaultQuant + '%',
        normalizedValue: seqState.defaultQuant / 100,
    });
```

and place it at knob 3: `const cells = [tempo, sw, link, quant, root, key, mode, layout];`

In `main-page.ts`, add a knob-3 branch that follows the file's existing
`recordUiOp` / `readUiField` pattern for UI-owned fields (the ROOT knob is the
model), writing through `writeUiField('defaultQuant', …)` so the prefs write and
the `dq` push happen in one place.

- [ ] **Step 4: Add screenshot scenes**

In `browser-test/screenshot.mjs`, add two scenes following the existing
clip-page / main-page scenes: `clip-params-quant` (clip at 70%) and
`main-params-quant` (default at 70%).

- [ ] **Step 5: Generate and inspect baselines**

Run: `npm run build:browser && node browser-test/screenshot.mjs --update`
Then open `browser-test/screenshots/baseline/clip-params-quant.png` and
`main-params-quant.png` and confirm the QUANT cell renders in the fourth
column with a legible value. Regenerate if the label overflows.

- [ ] **Step 6: Run the suites**

Run: `npm test && npm run typecheck`
Expected: all suites 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/seq/clip-page.ts src/seq/clip-page-vm.ts src/seq/main-page.ts src/seq/main-page-vm.ts src/midi/router.ts browser-test/screenshot.mjs browser-test/screenshots/baseline
git commit -m "$(cat <<'EOF'
feat(seq): QUANT cells on the Clip Params and Main Params pages

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: UI — the transient quantize overlay

**Files:**
- Create: `src/seq/quant-overlay.ts` (state, TTL, jog, input classifier)
- Create: `src/renderer/value-row.ts` (shared big-font value row)
- Create: `src/renderer/quant-overlay.ts` (the panel)
- Modify: `src/renderer/capture-overlay.ts` (use the shared row)
- Modify: `src/app/tick.ts` (age + draw)
- Test: `browser-test/logic.mjs`, `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `quantCandidates`, `nextQuantCandidate` (Task 5); `countDetents` (`src/seq/detent.ts`).
- Produces:
  - `armQuantOverlay(nowMs: number): void`
  - `quantOverlayActive(): boolean`
  - `quantOverlayTickAt(nowMs: number): boolean` — true on the tick it expires
  - `quantOverlayJog(delta: number, nowMs: number): void`
  - `dismissQuantOverlay(): void`
  - `quantOverlayAction(data: number[], shiftHeld: boolean): 'jog' | 'swallow' | 'dismiss' | 'through'`
  - `buildQuantVM(): { values: string[]; selIdx: number; defIdx: number }`
  - `drawValueRow(values, selIdx, y)` in `renderer/value-row.ts`
  - `drawQuantOverlay(vm)` in `renderer/quant-overlay.ts`

- [ ] **Step 1: Write the failing tests**

```js
import {
    armQuantOverlay, quantOverlayActive, quantOverlayTickAt,
    quantOverlayJog, quantOverlayAction, buildQuantVM,
} from '../dist/esm/seq/quant-overlay.js';

seqState.defaultQuant = 70; seqState.clipQuant = 0;
armQuantOverlay(1000);
check('overlay is up after arming', quantOverlayActive());
check('overlay survives short of its lifetime', !quantOverlayTickAt(2100));
check('overlay expires at 1200 ms', quantOverlayTickAt(2201) && !quantOverlayActive());

armQuantOverlay(1000);
check('overlay shows 0/DEF/100',
    JSON.stringify(buildQuantVM().values) === JSON.stringify(['0%', '70%', '100%']));
check('overlay marks the default', buildQuantVM().defIdx === 1);

// Jog: DETENT_DIV = 8, so one click is a delta of 8.
armQuantOverlay(1000); seqState.clipQuant = 0;
quantOverlayJog(8, 1100);
check('jog selects the next candidate', seqState.clipQuant === 70);
quantOverlayJog(8, 1200); quantOverlayJog(8, 1300);
check('jog clamps at the top', seqState.clipQuant === 100);
quantOverlayJog(-8, 1400); quantOverlayJog(-8, 1500); quantOverlayJog(-8, 1600);
check('jog clamps at the bottom', seqState.clipQuant === 0);
check('jog re-arms the timer', !quantOverlayTickAt(2500));

const CC = 0xB0, NOTE_ON = 0x90;
check('Back is consumed', quantOverlayAction([CC, 91, 127], false) === 'dismiss');
check('jog turn is jog', quantOverlayAction([CC, 14, 1], false) === 'jog');
check('jog touch is swallowed', quantOverlayAction([NOTE_ON, 3, 127], false) === 'swallow');
check('Shift+Step 16 is handled normally',
    quantOverlayAction([CC, 51, 127], true) === 'through');
check('Mute dismisses', quantOverlayAction([CC, 88, 127], false) === 'dismiss');
check('a pad passes through', quantOverlayAction([NOTE_ON, 68, 100], false) === 'through');
check('Play passes through', quantOverlayAction([CC, 85, 127], false) === 'through');
check('a release passes through', quantOverlayAction([CC, 91, 0], false) === 'through');
```

Replace the CC numbers with the real constants from `src/seq/constants.ts` and
`schwung.d.ts` (`MoveBack`, `MoveMainKnob`, `JOG_TOUCH`, `CC_MUTE`, `CC_PLAY`)
— do not hard-code guesses.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/seq/quant-overlay.ts`**

Key points the implementation must honour:

```ts
/* Transient confirmation panel for Shift+Step 16.
 *
 * Wall-clock, not ticks: the tick rate swings 63-205 Hz with load, so a
 * tick-counted lifetime would be 0.96 s on a busy device and 3.1 s on an idle
 * one. Follows the house *At(nowMs) convention so tests can drive time. */
const LIFETIME_MS = 1200;
```

- `armQuantOverlay(nowMs)` sets `untilMs = nowMs + LIFETIME_MS`, resets the
  detent accumulator, marks `appState.dirty`.
- `quantOverlayJog(delta, nowMs)` runs `countDetents`, moves the selection
  **clamped** within `quantCandidates(seqState.defaultQuant)`, sends
  `cq <watchTrack> <pct>` on change, and re-arms — a turn that changes nothing
  still re-arms.
- `quantOverlayAction(data, shiftHeld)` classification order, which is what the
  tests above pin: releases (`data[2] === 0`) → `'through'`; jog turn →
  `'jog'`; jog touch note → `'swallow'`; Shift+Step 16 → `'through'`; Back or
  jog press → `'dismiss'`; the noisy list → `'dismiss'`; everything else →
  `'through'`.
- The noisy list is one constant with the rule that generated it in a comment:

```ts
/* Inputs that repaint the screen or raise a toast, so leaving the panel up
 * behind them would collide. Everything else in the sequencer router is
 * LED-only and may run underneath — which is why pads, steps and transport
 * are absent here and never get eaten. */
const DISMISSING_CCS: number[] = [CC_MUTE, /* Shift+Step 3/5/7/9/10/12 */ ];
```

Note Shift+Step page opens and the Full-Vel/Metronome toasts arrive as step CCs
with `shiftHeld` true, so the classifier tests `shiftHeld && STEP_DISMISSES.has(step)`
rather than listing raw CCs for those.

- [ ] **Step 4: Extract the shared value row and write the panel**

Move the measure-and-draw loop out of `renderer/capture-overlay.ts` into
`renderer/value-row.ts`:

```ts
/** Big-font values laid out left to right, `selIdx` knocked out of a solid
 *  box. Shared by the capture overlay (full screen) and the quantize panel. */
export function drawValueRow(values: string[], selIdx: number, y: number): void
```

`capture-overlay.ts` keeps `clear_screen()`, its header and its arrow, and calls
`drawValueRow`. `renderer/quant-overlay.ts` draws a bordered ~19 px panel over
the current view, calls `drawValueRow`, then prints `DEF` in the 5 px font
centred under `vm.defIdx`'s value.

- [ ] **Step 5: Wire into the tick loop**

In `src/app/tick.ts`: age it beside `seqToastTick()` (repaint the underlying
view on the tick it expires) and draw it above the views but **below** the
capture overlay, matching how `captureOverlayActive()` is handled at line 481.

- [ ] **Step 6: Add screenshot scenes and baselines**

Scenes: `quant-overlay-three` (default 70, selection on DEF — box and `DEF`
marker coincide, the common case) and `quant-overlay-two` (default 0).

Run: `node browser-test/screenshot.mjs --update`, then open both PNGs and
confirm the row fits inside `W = 128` and the `DEF` marker is legible.

- [ ] **Step 7: Run the suites**

Run: `npm test && npm run typecheck`
Expected: all 0 failures. Confirm `browser-test/perf.mjs` shows no regression in
`fill_rect` count for scenes that do not show the overlay.

- [ ] **Step 8: Commit**

```bash
git add src/seq/quant-overlay.ts src/renderer/value-row.ts src/renderer/quant-overlay.ts src/renderer/capture-overlay.ts src/app/tick.ts browser-test/logic.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline
git commit -m "$(cat <<'EOF'
feat(seq): transient jog-selectable quantize overlay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: UI — rewire the Shift+Step 16 shortcut and the router gate

**Files:**
- Modify: `src/seq/router.ts` (`shiftStepFunction`, `STEP_QUANTIZE` branch)
- Modify: `src/midi/router.ts` (overlay gate below the capture gate)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: everything from Tasks 5–8.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```js
seqState.defaultQuant = 70; seqState.clipQuant = 0;
shiftStepFunction(15);      // STEP_QUANTIZE
check('shortcut advances the clip value', seqState.clipQuant === 70);
check('shortcut arms the overlay', quantOverlayActive());
shiftStepFunction(15);
check('a second press advances again', seqState.clipQuant === 100);
check('no toast — the panel is the feedback', seqToastText() === '');
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — still calls the deleted `quant` command and toasts.

- [ ] **Step 3: Rewrite the shortcut**

Replace the `STEP_QUANTIZE` branch in `router.ts:366`:

```ts
    } else if (step === STEP_QUANTIZE) {
        const track = seqState.watchTrack;
        const next = nextQuantCandidate(seqState.clipQuant, seqState.defaultQuant);
        /* One gesture key for the whole audition: pressing through
         * 0 -> 70 -> 100 is a single undo back to where you started, not
         * three. The panel is the feedback, so no toast. */
        beginGesture('quant:' + track, 'CLIP QUANT', trackLabel(track));
        seqState.clipQuant = next;
        seqCmd('cq ' + track + ' ' + next);
        armQuantOverlay(Date.now());
    }
```

The gesture closes when the overlay dismisses — call `endEdit('quant:' + track)`
inside `dismissQuantOverlay()`.

- [ ] **Step 4: Add the router gate**

In `src/midi/router.ts`, immediately **after** the `captureOverlayActive()`
block (so a capture overlay still wins) and before the `leaveModalActive()`
block:

```ts
    /* The quantize panel is a confirmation, not a decision: only Back and the
     * jog are consumed, and inputs that neither repaint nor toast run
     * underneath it without closing it. */
    if (quantOverlayActive()) {
        const action = quantOverlayAction(data, appState.shiftHeld);
        if (action === 'jog') { quantOverlayJog(decodeDelta(data[2]), Date.now()); return; }
        if (action === 'swallow') { armQuantOverlay(Date.now()); return; }
        if (action === 'dismiss') { dismissQuantOverlay(); return; }
    }
```

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run typecheck`
Expected: all 0 failures.

- [ ] **Step 6: Prove the gate has teeth**

Temporarily remove the `if (action === 'dismiss') { … return; }` line and add a
logic assertion that a Back press with the overlay up leaves it up. Confirm the
new assertion fails, then restore.

- [ ] **Step 7: Commit**

```bash
git add src/seq/router.ts src/midi/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): Shift+Step 16 cycles quantization instead of destroying timing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Docs, full verification, device run

**Files:**
- Modify: `MANUAL.md` (line ~495 Quantize bullet; Controls table ~986; Clip Params and Main Params sections)
- Modify: `README.md` (Features bullet)
- Modify: `CHANGELOG.md`
- Modify: `docs/assets/` (new screenshots)

- [ ] **Step 1: Run every local suite**

```bash
npm run build:browser
node browser-test/logic.mjs
node browser-test/dump-replay.mjs
node browser-test/app-loop.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test
```

Expected: 0 failures everywhere. Do not proceed past a failure.

- [ ] **Step 2: Generate doc screenshots**

```bash
node scripts/make-doc-assets.mjs clip-params-quant main-params-quant quant-overlay-three
```

- [ ] **Step 3: Update MANUAL.md**

Replace the one-line `**Quantize** — **Shift + Step 16**.` bullet with a
paragraph covering: quantization is a per-clip 0–100% strength that never
alters recorded timing; Shift+Step 16 cycles 0 / default / 100 and shows the
panel; the jog picks from the panel while it is up; QUANT on Clip Params sets
one clip and QUANT on Main Params sets the default that new clips inherit; the
default carries into new sets. Add both QUANT rows to the Controls reference
table, update the Shift+Step 16 row, and document the count-in capture window
("a note played just before the count-in ends is recorded on the downbeat
rather than lost"). Embed the three screenshots.

- [ ] **Step 4: Update README.md and CHANGELOG.md**

README: one Features bullet with the overlay screenshot. CHANGELOG: an entry
naming the **two behaviour changes** explicitly — swing is no longer applied to
unquantized notes, and quantize is no longer destructive — plus the count-in
capture fix.

- [ ] **Step 5: Device tests**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && (./scripts/test.sh && ./scripts/test-seq.sh) \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

If offline, report **DEVICE OFFLINE** to the user in CAPS.

If online, additionally verify by hand what no local test can: that one physical
jog click moves exactly one candidate (`DETENT_DIV = 8` may be wrong for the jog
— capture feeds `captureJog` the raw decoded delta), and that hitting pads with
the panel up leaves it on screen.

- [ ] **Step 6: Commit and push**

```bash
git add MANUAL.md README.md CHANGELOG.md docs/assets
git commit -m "$(cat <<'EOF'
docs: non-destructive quantization

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes

- **Spec coverage:** engine model → T1; default/commands/status → T2; persistence
  → T3; count-in pre-roll → T4; cycle logic → T5; prefs + UI state + undo field
  → T6; both param pages → T7; overlay + input policy → T8/T9; docs → T10.
- **Design deviation:** the spec's `ensure_exists(default_quant)` was replaced by
  `reseed_empty_clips()` (T2) because `ensure_exists` is reached through
  `extend_to_step` from three `Clip` methods, so a parameter would cascade
  through every note-entering command. The design doc has been updated to match.
- **Already done, do not redo:** `toggle_record` (engine.rs:669) already clears
  `rec_pending` on a count-in cancel, which T4 depends on.
- **Name consistency:** `quant` is the clip field and status key; `default_quant`
  / `dquant` the set default; `clipQuant` / `defaultQuant` the TS mirrors;
  `release_pass_flags` replaces `release_suppressed` everywhere.
