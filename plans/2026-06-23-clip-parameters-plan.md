# Clip Parameters page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Track-view-only "Clip Parameters" page (Shift+Step 3) exposing per-clip SCALE (playback-speed multiplier), LENGTH (clip length in steps), and TRANSPOSE (non-destructive sequence transpose) on knobs 0–2, mirroring the existing Main Params page.

**Architecture:** Three new per-clip fields live in the Rust engine (`Clip`): a rational playback scale (`scale_num`/`scale_den`), and `transpose: i8`. Scale drives a per-track fixed-point accumulator around the existing per-tick playback body so 2X/4X run multiple ticks per master tick and 1/2X etc. run one tick every N master ticks. Transpose is applied only at note emission (non-destructive) and recording stores `pitch − transpose` so re-emission reproduces the live pad. The UI adds `clip-page.ts`/`clip-page-vm.ts` that copy `main-page.ts`/`main-page-vm.ts` exactly (state machine, toasts, detents, long-enum overlay).

**Tech Stack:** Rust (`seq-core`, host-tested with `cargo test`), TypeScript (`src/seq`, browser-tested with node `.mjs` harnesses), esbuild bundle → `ui.js`, Rust cdylib → `dsp.so`.

## Global Constraints

- **File size:** hard limit 200 lines/file; target 50–100. Split if exceeded.
- **No code duplication:** refactor shared logic into a shared location before proceeding.
- **Comments explain WHY** (constraints/invariants), never WHAT.
- **ENGINE_VERSION must match** between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts`. Bump both when the engine wire protocol changes (new commands/status fields). `build-dsp.sh` fails the build otherwise.
- **Cargo path:** cargo is not on PATH; use `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo` (alias `CARGO` below).
- **New rendering logic → screenshot test. New business logic → logic/cargo test.**
- **Scale enum (8 values), index → rational, default index 4 (`1X`):**
  `1/8 (1/8), 1/4 (1/4), 1/2 (1/2), 3/4 (3/4), 1X (1/1), 3/2 (3/2), 2X (2/1), 4X (4/1)`.
- **Transpose range:** −36…+36 semitones (labelled `ct`). **Length range:** 1…256 steps (`MAX_STEPS`).
- Run the full local suite (`npm test` = build:browser + logic + app-loop + screenshot + perf) plus `cd engine && cargo test` at the end of every engine-touching task. Device tests (`./scripts/test-seq.sh`) when `move.local` is reachable; if offline, report **DEVICE OFFLINE** in CAPS.

Throughout: `CARGO=~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo`.

---

## File Structure

**Engine (Rust):**
- Modify `engine/crates/seq-core/src/clip.rs` — add `scale_num`, `scale_den`, `transpose` fields + accessors.
- Modify `engine/crates/seq-core/src/track.rs` — add `scale_acc: u32` accumulator.
- Modify `engine/crates/seq-core/src/command.rs` — add `clen`, `cscl`, `ctr` ops.
- Modify `engine/crates/seq-core/src/engine.rs` — scale accumulator loop, transpose at emit, record un-transpose, `csc=`/`ctr=` status.
- Modify `engine/crates/seq-core/src/persist.rs` — new `cp` clip-params line (back-compatible).
- Modify `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` — bump ENGINE_VERSION.

**UI (TypeScript):**
- Create `src/seq/clip-scale.ts` — scale enum tables (labels, rationals, helpers). Shared by VM + page.
- Create `src/seq/clip-page.ts` — `clipPageState` + open/close/touch/release/knob (mirrors `main-page.ts`).
- Create `src/seq/clip-page-vm.ts` — `buildClipPageVM()` (mirrors `main-page-vm.ts`).
- Modify `src/seq/state.ts` — mirror fields `clipScaleIdx`, `clipTranspose`.
- Modify `src/seq/engine.ts` — parse `csc=`/`ctr=`.
- Modify `src/seq/router.ts` — open on Shift+Step 3 (Track view).
- Modify `src/midi/router.ts` — knob/touch/release/Back + Session-switch close.
- Modify `src/app/tick.ts` — render dispatch when `clipPageActive()`.
- Modify `src/seq/leds.ts` — steps ≥ length paint Black.
- Modify the step-hold note display (`src/seq/leds.ts` / wherever `holdNotes` are turned into LEDs/labels) — add clip transpose.

**Tests:**
- `engine/crates/seq-core/src/*.rs` `#[cfg(test)]` modules (cargo).
- `browser-test/logic.mjs`, `browser-test/screenshot.mjs` (+ baselines), `browser-test/perf.mjs`.

---

## Task 1: Clip fields + persistence round-trip

**Files:**
- Modify: `engine/crates/seq-core/src/clip.rs` (struct ~77–106, `Clip::new`, `clear` ~126)
- Modify: `engine/crates/seq-core/src/persist.rs` (writer ~35, reader match ~117)
- Test: `engine/crates/seq-core/src/persist.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: `Clip.scale_num: u8`, `Clip.scale_den: u8`, `Clip.transpose: i8` (public fields, defaults `1,1,0`). New persist line `cp <track> <slot> <scale_num> <scale_den> <transpose>`.

- [ ] **Step 1: Write the failing test** — append to the `#[cfg(test)]` module in `persist.rs`:

```rust
#[test]
fn clip_params_round_trip_and_default() {
    let mut e = Engine::new(44100);
    {
        let c = e.tracks[1].active_mut();
        c.set_loop(0, 16);          // make the clip exist
        c.scale_num = 3; c.scale_den = 2; c.transpose = -5;
    }
    let saved = serialize(&e);
    let mut e2 = Engine::new(44100);
    deserialize(&mut e2, &saved);
    let c2 = e2.tracks[1].active();
    assert_eq!((c2.scale_num, c2.scale_den, c2.transpose), (3, 2, -5));

    // Legacy line without `cp` → defaults.
    let mut e3 = Engine::new(44100);
    deserialize(&mut e3, "MOVYSEQ1\ncl 0 0 16 0 \n");
    let c3 = e3.tracks[0].active();
    assert_eq!((c3.scale_num, c3.scale_den, c3.transpose), (1, 1, 0));
}
```

(Confirm the exact names of the serialize/deserialize fns and `FORMAT_TAG` at the top of `persist.rs`; use whatever the existing tests in that module call — match them.)

- [ ] **Step 2: Run test, verify it fails**

Run: `cd engine && $CARGO test -p seq-core clip_params_round_trip`
Expected: FAIL — `no field scale_num on type Clip`.

- [ ] **Step 3: Add fields.** In `clip.rs` struct `Clip` (after `loop_start_steps`):

```rust
    /// Playback-speed multiplier as a rational (num/den); 1/1 = 1X (default).
    /// Higher = faster: the per-track accumulator runs num ticks per den
    /// master ticks. See engine::service_tick.
    pub scale_num: u8,
    pub scale_den: u8,
    /// Non-destructive sequence transpose in semitones, applied only at note
    /// emission so Note.pitch (and live pads) stay untouched. Range -36..=36.
    pub transpose: i8,
```

In `Clip::new()` add `scale_num: 1, scale_den: 1, transpose: 0,`. In `clear()` reset them to `1, 1, 0` (clearing a slot returns it to defaults).

- [ ] **Step 4: Write the `cp` line.** In `persist.rs` writer, immediately after the block that writes the `cl` line for a clip (~35–43), add (still inside the same `if clip exists` guard):

```rust
                s.push_str(&format!(
                    "cp {} {} {} {} {}\n",
                    ti, ci, c.scale_num, c.scale_den, c.transpose
                ));
```

Update the format doc comment near line 11 to list `cp <track> <slot> <scale_num> <scale_den> <transpose>`.

- [ ] **Step 5: Parse the `cp` line.** In the reader match (~117, next to `Some("cl") => load_clip(...)`), add:

```rust
            Some("cp") => {
                if let (Some(ti), Some(ci), Some(sn), Some(sd), Some(tr)) = (
                    it.next().and_then(|s| s.parse::<usize>().ok()),
                    it.next().and_then(|s| s.parse::<usize>().ok()),
                    it.next().and_then(|s| s.parse::<u8>().ok()),
                    it.next().and_then(|s| s.parse::<u8>().ok()),
                    it.next().and_then(|s| s.parse::<i8>().ok()),
                ) {
                    if ti < engine.tracks.len() && ci < engine.tracks[ti].clips.len() {
                        let c = &mut engine.tracks[ti].clips[ci];
                        c.scale_num = sn.max(1);
                        c.scale_den = sd.max(1);
                        c.transpose = tr.clamp(-36, 36);
                    }
                }
            }
```

(Match the iterator/token style `load_clip` uses — if the reader splits lines then tokens, mirror that exactly.)

- [ ] **Step 6: Run test, verify pass**

Run: `cd engine && $CARGO test -p seq-core clip_params_round_trip`
Expected: PASS.

- [ ] **Step 7: Full engine tests + commit**

```bash
cd engine && $CARGO test
git add engine/crates/seq-core/src/clip.rs engine/crates/seq-core/src/persist.rs
git commit -m "feat(engine): add clip scale/transpose fields + cp persist line"
```

---

## Task 2: Engine commands — `clen`, `cscl`, `ctr`

**Files:**
- Modify: `engine/crates/seq-core/src/command.rs` (`apply_op` match, ~27)
- Modify: `engine/crates/seq-core/src/clip.rs` (helper setters)
- Test: `engine/crates/seq-core/src/command.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `Clip.scale_num/scale_den/transpose` (Task 1).
- Produces: ops `clen <track> <steps>`, `cscl <track> <num> <den>`, `ctr <track> <semitones>` acting on `tracks[t].active_mut()`. New `Clip::set_clip_length(steps)`.

- [ ] **Step 1: Write the failing test** — append to the `command.rs` test module:

```rust
#[test]
fn clip_param_commands_set_active_clip() {
    let mut e = Engine::new(44100);
    e.tracks[0].active_mut().set_loop(0, 16);
    let mut out = Vec::new();
    apply_batch(&mut e, "clen 0 9; cscl 0 3 4; ctr 0 -40", &mut out);
    let c = e.tracks[0].active();
    assert_eq!(c.length_steps, 9);
    assert_eq!((c.scale_num, c.scale_den), (3, 4));
    assert_eq!(c.transpose, -36);            // clamped to -36
    // length clamps to [1, MAX_STEPS]
    apply_batch(&mut e, "clen 0 0; cscl 0 9 9", &mut out);
    assert_eq!(e.tracks[0].active().length_steps, 1);
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && $CARGO test -p seq-core clip_param_commands`
Expected: FAIL — unknown op (assert mismatch; ops are ignored today).

- [ ] **Step 3: Add `Clip::set_clip_length`** in `clip.rs`:

```rust
    /// Set the active loop length in steps from the knob, preserving
    /// loop_start. Clamped to [1, MAX_STEPS - loop_start_steps].
    pub fn set_clip_length(&mut self, steps: u16) {
        let max = MAX_STEPS - self.loop_start_steps;
        self.length_steps = steps.clamp(1, max);
    }
```

- [ ] **Step 4: Add the ops** to the `apply_op` match in `command.rs` (alongside `slen`/`elen`):

```rust
        // clen <track> <steps> — set active clip length in steps (knob).
        "clen" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].active_mut()
                        .set_clip_length(s.clamp(0, 65535) as u16);
                }
            }
        }
        // cscl <track> <num> <den> — set active clip playback scale (rational).
        "cscl" => {
            if let (Some(t), Some(n), Some(d)) = (next(), next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    let c = engine.tracks[t as usize].active_mut();
                    c.scale_num = n.clamp(1, 255) as u8;
                    c.scale_den = d.clamp(1, 255) as u8;
                }
            }
        }
        // ctr <track> <semitones> — set active clip transpose (non-destructive).
        "ctr" => {
            if let (Some(t), Some(v)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize].active_mut().transpose = v.clamp(-36, 36) as i8;
                }
            }
        }
```

- [ ] **Step 5: Run, verify pass**

Run: `cd engine && $CARGO test -p seq-core clip_param_commands`
Expected: PASS.

- [ ] **Step 6: Full tests + commit**

```bash
cd engine && $CARGO test
git add engine/crates/seq-core/src/command.rs engine/crates/seq-core/src/clip.rs
git commit -m "feat(engine): clen/cscl/ctr clip-param commands"
```

---

## Task 3: Transpose at emit + record un-transpose

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (note emit ~609; `live_note_off` record commit ~496)
- Test: `engine/crates/seq-core/src/engine.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `Clip.transpose` (Task 1).
- Produces: emitted `NoteOn.pitch == clamp(note.pitch + transpose, 0, 127)`; recorded note stores `clamp(pad_pitch − transpose, 0, 127)`.

- [ ] **Step 1: Write failing tests** — append to engine test module. (Mirror an existing playback test such as `loop_wraps_and_replays` for transport/seed setup.)

```rust
#[test]
fn transpose_shifts_emitted_pitch_only() {
    let mut e = Engine::new(44100);
    e.tracks[0].active_mut().set_loop(0, 16);
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    e.tracks[0].active_mut().transpose = 12;
    e.tracks[0].playing_slot = Some(e.tracks[0].active_clip);
    e.play();
    let mut out = Vec::new();
    // Service ticks until step 0 fires.
    for _ in 0..(TICKS_PER_STEP as usize) { e.service_tick(&mut out); }
    let on = out.iter().find_map(|x| match x {
        OutEvent::NoteOn { pitch, .. } => Some(*pitch), _ => None });
    assert_eq!(on, Some(72));                       // 60 + 12, emitted only
    assert_eq!(e.tracks[0].active().notes[0].pitch, 60); // stored pitch untouched
}

#[test]
fn recording_stores_untransposed_pitch() {
    let mut e = Engine::new(44100);
    e.tracks[0].active_mut().set_loop(0, 16);
    e.tracks[0].active_mut().transpose = 5;
    e.play();
    e.start_recording(0);                           // use the real rec entrypoint
    e.live_note_on(0, 67, 100);                     // pad plays raw 67
    e.tracks[0].pos_tick += 4;
    e.live_note_off(0, 67);
    // Stored as 67 - 5 = 62, so emit re-adds 5 -> 67 (matches the pad).
    assert_eq!(e.tracks[0].active().notes.last().unwrap().pitch, 62);
}
```

(Use the actual recording API names — check `start_recording`/`live_note_on` signatures near `rec_pending` ~473 and adjust the test to them. The assertion values are the contract.)

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && $CARGO test -p seq-core transpose_shifts_emitted_pitch_only recording_stores_untransposed_pitch`
Expected: FAIL — emitted pitch 60, stored 67.

- [ ] **Step 3: Apply transpose at emit.** In `engine.rs` ~609 replace the `NoteOn` push so it transposes:

```rust
                        let tp_pitch = (n.pitch as i32
                            + self.tracks[ti].clips[slot].transpose as i32)
                            .clamp(0, 127) as u8;
                        out.push(OutEvent::NoteOn { track: ti as u8, pitch: tp_pitch, vel: n.vel });
                        self.gates.push(Gate {
                            track: ti as u8,
                            pitch: tp_pitch,                  // gate must match the emitted note for note-off
                            ticks_left: n.gate.max(1),
                        });
```

(Borrow note: read `transpose` before the `out.push` if the borrow checker complains; bind `let transpose = self.tracks[ti].clips[slot].transpose;` near the top of the per-note loop.)

- [ ] **Step 4: Un-transpose on record.** In `live_note_off` (~496) change the commit to subtract transpose:

```rust
            let transpose = self.tracks[track].active().transpose as i32;
            let stored = (pitch as i32 - transpose).clamp(0, 127) as u8;
            self.tracks[track].active_mut().record_note(p.start_tick, gate.max(1), stored, p.vel);
```

- [ ] **Step 5: Run, verify pass**

Run: `cd engine && $CARGO test -p seq-core transpose_shifts_emitted_pitch_only recording_stores_untransposed_pitch`
Expected: PASS.

- [ ] **Step 6: Full tests + commit**

```bash
cd engine && $CARGO test
git add engine/crates/seq-core/src/engine.rs
git commit -m "feat(engine): apply clip transpose at emit; un-transpose on record"
```

---

## Task 4: Scale accumulator playback

**Files:**
- Modify: `engine/crates/seq-core/src/track.rs` (add `scale_acc: u32`, init 0)
- Modify: `engine/crates/seq-core/src/engine.rs` (extract per-track tick body; drive with accumulator)
- Test: `engine/crates/seq-core/src/engine.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `Clip.scale_num/scale_den` (Task 1), `Track.scale_acc`.
- Produces: per-track playhead advances `scale_num` ticks per `scale_den` master ticks. New private `fn step_tick(&mut self, ti: usize, out: &mut Vec<OutEvent>)` holding the existing note-emit + advance/wrap + automation body.

- [ ] **Step 1: Write failing tests** — append to engine test module:

```rust
// Count how many distinct playhead ticks a track visits over N master ticks.
fn ticks_visited(scale_num: u8, scale_den: u8, master_ticks: usize) -> usize {
    let mut e = Engine::new(44100);
    e.tracks[0].active_mut().set_loop(0, 16);
    e.tracks[0].active_mut().scale_num = scale_num;
    e.tracks[0].active_mut().scale_den = scale_den;
    e.tracks[0].playing_slot = Some(e.tracks[0].active_clip);
    e.play();
    let start = e.tracks[0].pos_tick;
    let mut out = Vec::new();
    for _ in 0..master_ticks { e.service_tick(&mut out); }
    // pos advanced by (visited) ticks, modulo the loop window length.
    let len = e.tracks[0].active().length_ticks();
    ((e.tracks[0].pos_tick + len - start) % len) as usize
}

#[test]
fn scale_changes_playhead_rate() {
    assert_eq!(ticks_visited(1, 1, 48), 48);   // 1X  → 1:1
    assert_eq!(ticks_visited(2, 1, 48), 96 % (16 * TICKS_PER_STEP as usize)); // 2X → 2:1
    assert_eq!(ticks_visited(1, 2, 48), 24);   // 1/2X → 1 tick per 2 master
    assert_eq!(ticks_visited(3, 4, 48), 36);   // 3/4X → 36 ticks
}
```

(Adjust the `2X` expected value to the loop-length modulo with `TICKS_PER_STEP` from the crate; the contract is 2:1, 1:2, 3:4 ratios with no drift.)

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && $CARGO test -p seq-core scale_changes_playhead_rate`
Expected: FAIL — every ratio currently advances 48 (1 tick/master tick).

- [ ] **Step 3: Add `scale_acc`** to `track.rs` `Track` struct (`pub scale_acc: u32,`) and init `scale_acc: 0,` in its constructor. Reset to 0 wherever `pos_tick` is seeded on `play()` (engine.rs ~315/the `play` seeding loop) so scale starts phase-aligned.

- [ ] **Step 4: Extract `step_tick` and wrap with the accumulator.** In `engine.rs`, move the existing per-track body (the note-emit loop + advance/wrap block + automation latch, ~573–643) into:

```rust
    /// One sequencer tick for a single playing track: emit due notes, advance
    /// + wrap the playhead, latch automation. Driven 0..N times per master tick
    /// by the clip scale accumulator (see service_tick).
    fn step_tick(&mut self, ti: usize, out: &mut Vec<OutEvent>) {
        // ... (the moved body, unchanged) ...
    }
```

Then in `service_tick`, replace the `for ti in 0..NUM_TRACKS { ... }` playback block (after the `count_in_left == 0` guard) with:

```rust
        if self.count_in_left == 0 {
            for ti in 0..NUM_TRACKS {
                let Some(slot) = self.tracks[ti].playing_slot else { continue; };
                if !self.tracks[ti].clips[slot].exists() { continue; }
                let (num, den) = {
                    let c = &self.tracks[ti].clips[slot];
                    (c.scale_num.max(1) as u32, c.scale_den.max(1) as u32)
                };
                self.tracks[ti].scale_acc += num;
                while self.tracks[ti].scale_acc >= den {
                    self.tracks[ti].scale_acc -= den;
                    self.step_tick(ti, out);
                }
            }
        }
```

`step_tick` must early-return cleanly if the track is muted (keep the existing `muted` check inside it) but still advance the playhead (today muted tracks still advance — preserve that behaviour; only the `out.push` note emits are gated by `!muted`).

- [ ] **Step 5: Run, verify pass**

Run: `cd engine && $CARGO test -p seq-core scale_changes_playhead_rate`
Expected: PASS.

- [ ] **Step 6: Full tests (regression — loop wrap, recording, automation all run through step_tick now) + commit**

```bash
cd engine && $CARGO test
git add engine/crates/seq-core/src/track.rs engine/crates/seq-core/src/engine.rs
git commit -m "feat(engine): clip scale via per-track tick accumulator"
```

---

## Task 5: Status fields `csc=` / `ctr=` + ENGINE_VERSION bump

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`status()` ~882)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (ENGINE_VERSION)
- Modify: `src/seq/constants.ts` (ENGINE_VERSION)
- Test: `engine/crates/seq-core/src/engine.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: status string gains ` csc=<num>/<den> ctr=<signed>` for the watched track's active clip.

- [ ] **Step 1: Write failing test:**

```rust
#[test]
fn status_reports_clip_scale_and_transpose() {
    let mut e = Engine::new(44100);
    e.tracks[0].active_mut().set_loop(0, 16);
    e.tracks[0].active_mut().scale_num = 3;
    e.tracks[0].active_mut().scale_den = 2;
    e.tracks[0].active_mut().transpose = -7;
    let s = e.status();
    assert!(s.contains("csc=3/2"), "{s}");
    assert!(s.contains("ctr=-7"), "{s}");
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd engine && $CARGO test -p seq-core status_reports_clip_scale`
Expected: FAIL — substring missing.

- [ ] **Step 3: Extend `status()`.** Append ` csc={}/{} ctr={}` to the format string (end of the literal ~883) and add the three args at the end of the arg list (after `self.swing_pct`):

```rust
            clip.scale_num,
            clip.scale_den,
            clip.transpose,
```

with the format literal gaining ` csc={}/{} ctr={}`.

- [ ] **Step 4: Bump ENGINE_VERSION** in `engine/crates/movy-dsp/src/lib.rs` and the matching constant in `src/seq/constants.ts` (same new integer in both — grep `ENGINE_VERSION` in each).

- [ ] **Step 5: Run, verify pass**

Run: `cd engine && $CARGO test -p seq-core status_reports_clip_scale`
Expected: PASS.

- [ ] **Step 6: Full engine tests + commit**

```bash
cd engine && $CARGO test
git add engine/crates/seq-core/src/engine.rs engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "feat(engine): report csc/ctr in status; bump ENGINE_VERSION"
```

---

## Task 6: UI scale tables + state mirror + status parse

**Files:**
- Create: `src/seq/clip-scale.ts`
- Modify: `src/seq/state.ts` (add mirror fields + init)
- Modify: `src/seq/engine.ts` (parse `csc`/`ctr` ~162)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Produces: `SCALE_LABELS: string[]` (8), `SCALE_RATIONALS: [number, number][]` (8), `SCALE_DEFAULT_IDX = 4`, `scaleCellText(idx): string`, `scaleToastText(idx): string`, `rationalToIdx(num, den): number`. `seqState.clipScaleIdx: number`, `seqState.clipTranspose: number`.

- [ ] **Step 1: Write the failing logic test** — add to `browser-test/logic.mjs` (import from the built `dist/esm`):

```js
import { SCALE_LABELS, SCALE_RATIONALS, scaleCellText, scaleToastText, rationalToIdx, SCALE_DEFAULT_IDX }
  from '../dist/esm/seq/clip-scale.js';

assert.equal(SCALE_LABELS.length, 8);
assert.equal(SCALE_DEFAULT_IDX, 4);
assert.deepEqual(SCALE_RATIONALS[4], [1, 1]);
assert.equal(scaleCellText(4), '1X');     // whole → 'NX' on one line
assert.equal(scaleCellText(2), '1/2');    // fraction → 'n/d' (stacked by renderer)
assert.equal(scaleToastText(2), '1/2X');  // toast/overlay always carry X
assert.equal(scaleToastText(6), '2X');
assert.equal(rationalToIdx(3, 4), 3);
```

- [ ] **Step 2: Run, verify fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/seq/clip-scale.ts`:**

```ts
/* Clip SCALE enum: index 0..7 over playback-speed multipliers. The cell shows
 * whole multiples as 'NX' on one line and fractions as a stacked 'n/d' (via the
 * length-square renderer); toasts and the overlay always append 'X'. */

export const SCALE_RATIONALS: [number, number][] = [
    [1, 8], [1, 4], [1, 2], [3, 4], [1, 1], [3, 2], [2, 1], [4, 1],
];
export const SCALE_DEFAULT_IDX = 4;

export const SCALE_LABELS: string[] =
    SCALE_RATIONALS.map(([n, d]) => (d === 1 ? `${n}X` : `${n}/${d}X`));

/** Cell text: whole → 'NX'; fraction → 'n/d' (renderer stacks it). */
export function scaleCellText(idx: number): string {
    const [n, d] = SCALE_RATIONALS[idx];
    return d === 1 ? `${n}X` : `${n}/${d}`;
}

/** Toast/overlay text: always with trailing X (e.g. '1/2X', '2X'). */
export function scaleToastText(idx: number): string {
    return SCALE_LABELS[idx];
}

export function rationalToIdx(num: number, den: number): number {
    const i = SCALE_RATIONALS.findIndex(([n, d]) => n === num && d === den);
    return i < 0 ? SCALE_DEFAULT_IDX : i;
}
```

- [ ] **Step 4: Add mirror fields.** In `src/seq/state.ts` interface add:

```ts
    clipScaleIdx: number;    // active clip playback-scale enum index (from `csc=`)
    clipTranspose: number;   // active clip transpose in semitones (from `ctr=`)
```

and initialise them in the state factory (`clipScaleIdx: 4, clipTranspose: 0,` — use `SCALE_DEFAULT_IDX`).

- [ ] **Step 5: Parse status.** In `src/seq/engine.ts` parse loop (~162, beside `len`/`lstart`):

```ts
        else if (key === 'csc') {
            const [n, d] = val.split('/').map(Number);
            seqState.clipScaleIdx = rationalToIdx(n || 1, d || 1);
        }
        else if (key === 'ctr') seqState.clipTranspose = Number(val) || 0;
```

(Add `import { rationalToIdx } from './clip-scale.js';` at the top.)

- [ ] **Step 6: Run, verify pass**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/seq/clip-scale.ts src/seq/state.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "feat(ui): clip-scale tables + status mirror (csc/ctr)"
```

---

## Task 7: Clip Params page state machine

**Files:**
- Create: `src/seq/clip-page.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `seqState.clipScaleIdx/clipTranspose/lenSteps` (Task 6), `seqCmd` (engine.ts), `countDetents` (detent.ts), `SCALE_RATIONALS/SCALE_DEFAULT_IDX` (Task 6).
- Produces: `clipPageState { active, origin, touchedKnob, scaleOverlay, scaleSel }`, `clipPageActive()`, `openClipPage(origin, track)`, `closeClipPage(): number`, `clipPageTouch(k, down)`, `clipPageRelease(k, track)`, `clipPageKnob(k, delta, track)`, `resetClipPage()`.

- [ ] **Step 1: Write failing test** — add to `logic.mjs`:

```js
import { clipPageState, openClipPage, closeClipPage, clipPageKnob, clipPageActive }
  from '../dist/esm/seq/clip-page.js';
import { seqState } from '../dist/esm/seq/state.js';

openClipPage(2, 0);
assert.equal(clipPageActive(), true);
seqState.clipTranspose = 0;
clipPageKnob(2, 40, 0);                 // knob 2 = transpose, +1 detent
assert.equal(seqState.clipTranspose, 1);
clipPageKnob(2, -40 * 60, 0);           // drive well past -36
assert.equal(seqState.clipTranspose, -36);   // clamped
assert.equal(closeClipPage(), 2);       // returns origin view
assert.equal(clipPageActive(), false);
```

(Use the detent magnitude the existing main-page logic test uses for one detent — copy from the `mainPageKnob` test in `logic.mjs`.)

- [ ] **Step 2: Run, verify fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/seq/clip-page.ts`** (mirror `main-page.ts`; knob 0 SCALE with overlay, 1 LENGTH, 2 TRANSPOSE):

```ts
/* Clip Parameters page: per-clip Scale / Length / Transpose on knobs 0-2,
 * opened with Shift+Step 3 in Track view, closed with Back or a Session-view
 * switch. Mirrors main-page.ts; rendering reads clip-page-vm. Edits the active
 * track's playing clip via engine commands; seqState mirrors the values. */

import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { countDetents } from './detent.js';
import { SCALE_RATIONALS, SCALE_DEFAULT_IDX } from './clip-scale.js';
import { MAX_STEPS } from './constants.js';   // add if absent: export const MAX_STEPS = 256;

const TRANSPOSE_MIN = -36, TRANSPOSE_MAX = 36;

export const clipPageState = {
    active: false,
    origin: 0,
    touchedKnob: -1,
    scaleOverlay: false,
    scaleSel: SCALE_DEFAULT_IDX,
};

const accum = [0, 0, 0, 0];

export function clipPageActive(): boolean { return clipPageState.active; }

export function openClipPage(origin: number, _track: number): void {
    clipPageState.active = true;
    clipPageState.origin = origin;
    clipPageState.touchedKnob = -1;
    clipPageState.scaleOverlay = false;
    accum.fill(0);
}

export function closeClipPage(): number {
    clipPageState.active = false;
    clipPageState.touchedKnob = -1;
    clipPageState.scaleOverlay = false;
    return clipPageState.origin;
}

export function clipPageTouch(k: number, down: boolean): void {
    clipPageState.touchedKnob = down ? k : -1;
    if (k === 0 && down) {              // SCALE opens the long-enum overlay
        clipPageState.scaleOverlay = true;
        clipPageState.scaleSel = seqState.clipScaleIdx;
        accum[0] = 0;
    }
}

export function clipPageRelease(k: number, track: number): void {
    if (k === 0 && clipPageState.scaleOverlay) {
        const idx = clipPageState.scaleSel;
        if (idx !== seqState.clipScaleIdx) {
            seqState.clipScaleIdx = idx;
            const [n, d] = SCALE_RATIONALS[idx];
            seqCmd('cscl ' + track + ' ' + n + ' ' + d);
        }
        clipPageState.scaleOverlay = false;
    }
    if (clipPageState.touchedKnob === k) clipPageState.touchedKnob = -1;
}

export function clipPageKnob(k: number, delta: number, track: number): void {
    clipPageState.touchedKnob = k;
    const n = countDetents(accum, k, delta);
    if (n === 0) return;
    if (k === 0 && clipPageState.scaleOverlay) {
        clipPageState.scaleSel = Math.max(0, Math.min(SCALE_RATIONALS.length - 1, clipPageState.scaleSel + n));
    } else if (k === 1) {
        const next = Math.max(1, Math.min(MAX_STEPS, seqState.lenSteps + n));
        if (next !== seqState.lenSteps) { seqState.lenSteps = next; seqCmd('clen ' + track + ' ' + next); }
    } else if (k === 2) {
        const next = Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, seqState.clipTranspose + n));
        if (next !== seqState.clipTranspose) { seqState.clipTranspose = next; seqCmd('ctr ' + track + ' ' + next); }
    }
}

export function resetClipPage(): void {
    clipPageState.active = false;
    clipPageState.origin = 0;
    clipPageState.touchedKnob = -1;
    clipPageState.scaleOverlay = false;
    clipPageState.scaleSel = SCALE_DEFAULT_IDX;
    accum.fill(0);
}
```

(If `MAX_STEPS` isn't already exported from `constants.ts`, add `export const MAX_STEPS = 256;` there with a comment that it mirrors the engine's `clip::MAX_STEPS`.)

- [ ] **Step 4: Run, verify pass**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/clip-page.ts src/seq/constants.ts browser-test/logic.mjs
git commit -m "feat(ui): clip-page state machine (scale/length/transpose)"
```

---

## Task 8: Clip Params ViewModel

**Files:**
- Create: `src/seq/clip-page-vm.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `paramCell` (param-vm.ts), `clipPageState` (Task 7), `seqState`, `SCALE_LABELS/scaleCellText/scaleToastText` (Task 6).
- Produces: `buildClipPageVM(): ViewModel` with header `CLIP PARAMETERS`, cells [SCALE(`type:'len'`), LENGTH(`renderStyle:'preset'`), TRANSPOSE(`renderStyle:'preset'`), null], toast, overlay.

- [ ] **Step 1: Write failing test** — add to `logic.mjs`:

```js
import { buildClipPageVM } from '../dist/esm/seq/clip-page-vm.js';
import { openClipPage as openCP, clipPageTouch, clipPageState as cps } from '../dist/esm/seq/clip-page.js';

seqState.clipScaleIdx = 2; seqState.lenSteps = 16; seqState.clipTranspose = 12;
openCP(0, 0);
let vm = buildClipPageVM();
assert.equal(vm.headerOverride, 'CLIP PARAMETERS');
assert.equal(vm.rows[0][0].displayValue, '1/2');   // scale cell stacked text
assert.equal(vm.rows[0][0].type, 'len');
assert.equal(vm.rows[0][1].displayValue, '16');    // length big-font
assert.equal(vm.rows[0][2].displayValue, '12');    // transpose big-font
// Touch knob 1 → toast carries the unit.
clipPageTouch(1, true);
vm = buildClipPageVM();
assert.equal(vm.toast.value, '16 steps');
// Touch knob 0 → scale overlay + 'X' toast.
clipPageTouch(0, true);
vm = buildClipPageVM();
assert.equal(vm.toast.value, '1/2X');
assert.ok(vm.overlay && vm.overlay.slot === 0);
```

- [ ] **Step 2: Run, verify fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/seq/clip-page-vm.ts`** (mirror `main-page-vm.ts`):

```ts
/* Builds the Clip Params page ViewModel. Knob 0 SCALE (len-style box +
 * scrollable overlay), 1 LENGTH (big preset, 'N steps' toast), 2 TRANSPOSE
 * (big preset signed, 'N ct' toast). Mirrors main-page-vm conventions. */

import type { ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from './param-vm.js';
import { clipPageState } from './clip-page.js';
import { seqState } from './state.js';
import { SCALE_LABELS, SCALE_RATIONALS, scaleCellText, scaleToastText } from './clip-scale.js';

const MAX_STEPS = 256;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function buildClipPageVM(): ViewModel {
    const sIdx = seqState.clipScaleIdx;
    const len = seqState.lenSteps;
    const tr = seqState.clipTranspose;

    const scale = cell({
        shortName: 'SCALE', fullName: 'Scale', type: 'len',
        displayValue: scaleCellText(sIdx),
        normalizedValue: SCALE_RATIONALS.length > 1 ? sIdx / (SCALE_RATIONALS.length - 1) : 0,
    });
    const length = cell({
        shortName: 'LENGTH', fullName: 'Length', renderStyle: 'preset',
        displayValue: String(len), normalizedValue: clamp01((len - 1) / (MAX_STEPS - 1)),
    });
    const transpose = cell({
        shortName: 'TRANSPOSE', fullName: 'Transpose', renderStyle: 'preset',
        displayValue: String(tr), normalizedValue: clamp01((tr + 36) / 72),
    });

    const cells = [scale, length, transpose];
    const tk = clipPageState.touchedKnob;
    let toast = null;
    if (tk >= 0 && tk < cells.length) {
        cells[tk].touched = true;
        const value = tk === 0 ? scaleToastText(sIdx)
            : tk === 1 ? len + ' steps'
            : (tr >= 0 ? '+' + tr : String(tr)) + ' ct';
        toast = { fullName: cells[tk].fullName, value, browseHint: false };
    }

    const overlay = clipPageState.scaleOverlay
        ? { slot: 0, options: SCALE_LABELS, selected: clipPageState.scaleSel }
        : null;

    return {
        moduleName: 'CLIP PARAMETERS', headerOverride: 'CLIP PARAMETERS',
        bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[scale, length, transpose, null], [null, null, null, null]],
        touchedSlot: null, toast, overlay, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/clip-page-vm.ts browser-test/logic.mjs
git commit -m "feat(ui): clip-page ViewModel"
```

---

## Task 9: Routing — open / knob / close

**Files:**
- Modify: `src/seq/router.ts` (Shift+Step map ~69, ~260)
- Modify: `src/midi/router.ts` (knob ~151, touch ~76, release, Back ~179, ~218)
- Modify: `src/app/tick.ts` (render dispatch ~2 import + render branch)
- Test: device + manual; logic covered by Tasks 7/8.

**Interfaces:**
- Consumes: `clipPageActive/openClipPage/closeClipPage/clipPageKnob/clipPageTouch/clipPageRelease` (Task 7), `buildClipPageVM` (Task 8).

- [ ] **Step 1: Open on Shift+Step 3 in Track view.** In `src/seq/router.ts`, in the Shift+Step handler that calls `openMainPage(appState.currentView)` (~260), add a Step-3 branch that opens the clip page only when **not** in Session view:

```ts
import { openClipPage, clipPageActive } from './clip-page.js';
// ... in the Shift+Step switch, case Step 3 (index 2):
if (!seqState.sessionMode) openClipPage(appState.currentView, appState.activeSlot);
```

(Match the existing Step→action mapping structure near line 69; Step buttons are 0-indexed — "Step 3" is the third pad. Confirm the index the existing map uses for Steps 5/7/9 and place 3 consistently.)

- [ ] **Step 2: Knob + touch + release + Back.** In `src/midi/router.ts`, beside each `mainPageActive()` branch add the clip-page equivalent:

```ts
import { clipPageActive, clipPageKnob, clipPageTouch, clipPageRelease, closeClipPage } from '../seq/clip-page.js';

// knob turn (~151):
if (clipPageActive()) {
    if (k < 3) { clipPageKnob(k, delta, appState.activeSlot); appState.dirty = true; }
    return;
}
// knob touch down/up (~76): forward to clipPageTouch(d1, d2>0) / clipPageRelease
if (clipPageActive()) {
    if (d2 > 0) clipPageTouch(d1, true); else clipPageRelease(d1, appState.activeSlot);
    return;
}
// Back (~179):
if (clipPageActive()) { appState.currentView = closeClipPage(); return; }
```

(Place each clip-page guard immediately before or after the corresponding `mainPageActive()` guard, copying its exact control-flow/return pattern. Only knobs 0–2 act; knob ≥3 is ignored.)

- [ ] **Step 3: Auto-close on Session switch.** Find where `seqState.sessionMode` is set true (Session toggle handler). After it flips to Session, add:

```ts
if (clipPageActive()) appState.currentView = closeClipPage();
```

- [ ] **Step 4: Render dispatch.** In `src/app/tick.ts`, beside the `mainPageActive()` render branch (import ~2), add:

```ts
import { clipPageActive } from '../seq/clip-page.js';
import { buildClipPageVM } from '../seq/clip-page-vm.js';
// in the render selection, before the normal seq render:
if (clipPageActive()) { renderKnobsView(buildClipPageVM()); return; }
```

(Use the exact render function the main page uses — copy that line, swapping `buildMainPageVM` → `buildClipPageVM`.)

- [ ] **Step 5: Build + typecheck**

Run: `npm run build:device && npm run typecheck`
Expected: zero TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/seq/router.ts src/midi/router.ts src/app/tick.ts
git commit -m "feat(ui): route Shift+Step3 → Clip Params; close on Back/Session"
```

---

## Task 10: Step LEDs off beyond clip length

**Files:**
- Modify: `src/seq/leds.ts` (step LED color, ~130–190)
- Test: `browser-test/app-loop.mjs` (LED assertions) + `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `seqState.lenSteps`.
- Produces: step LEDs for absolute steps `>= lenSteps` paint Black instead of the dim in-clip colour.

- [ ] **Step 1: Write failing assertion** — in `app-loop.mjs`, after setting a clip length, assert a step beyond length is Black. (Locate the existing step-LED collection in that harness and add: with `lenSteps = 4`, step index 5's LED == Black/0.)

- [ ] **Step 2: Run, verify fail**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: FAIL — step 5 still dim.

- [ ] **Step 3: Gate the step color.** In `leds.ts` where each step's base/dim colour is chosen, add the earliest guard:

```ts
// Steps beyond the clip length are not part of the pattern → fully off.
if (absStep >= seqState.lenSteps) return Black;
```

(Insert before the in-clip dim fallthrough; ensure `absStep` is the absolute step index already used there, and that the playhead/occupied branches still run only for in-length steps.)

- [ ] **Step 4: Run, verify pass**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts browser-test/app-loop.mjs
git commit -m "feat(ui): blank step LEDs beyond clip length"
```

---

## Task 11: Transposed step-hold note display

**Files:**
- Modify: the step-hold readout that maps `seqState.holdNotes` → LEDs/labels (grep `holdNotes` in `src/seq/leds.ts` and any keys/label renderer).
- Test: `browser-test/logic.mjs` (if the mapping is a pure fn) or `app-loop.mjs`.

**Interfaces:**
- Consumes: `seqState.holdNotes`, `seqState.clipTranspose`.
- Produces: held-step note pitches displayed as `clamp(pitch + clipTranspose, 0, 127)` so they match the (untransposed) live pads visually.

- [ ] **Step 1: Write failing test** — where `holdNotes` are turned into displayed pitches (e.g. for highlighting pads or a label), assert the displayed pitch includes the transpose. If a pure helper exists, test it; otherwise add a tiny pure helper `displayHoldNotes(): number[]` in `leds.ts` returning transposed pitches and test it in `logic.mjs`:

```js
import { displayHoldNotes } from '../dist/esm/seq/leds.js';
seqState.holdNotes = [60, 64]; seqState.clipTranspose = 3;
assert.deepEqual(displayHoldNotes(), [63, 67]);
```

- [ ] **Step 2: Run, verify fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — undefined / untransposed.

- [ ] **Step 3: Add the transposed mapping** in `leds.ts`:

```ts
/* Held-step notes shown transposed so they line up with the live pads (which
 * play untransposed). Mirrors the engine's emit-time transpose. */
export function displayHoldNotes(): number[] {
    return seqState.holdNotes.map((p) => Math.max(0, Math.min(127, p + seqState.clipTranspose)));
}
```

Use `displayHoldNotes()` wherever `seqState.holdNotes` currently feeds pad-highlight / label rendering.

- [ ] **Step 4: Run, verify pass**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts browser-test/logic.mjs
git commit -m "feat(ui): show held-step notes transposed (match live pads)"
```

---

## Task 12: Screenshot baselines + perf + full suite

**Files:**
- Modify: `browser-test/screenshot.mjs` (add Clip Params states)
- Baselines: regenerate via `--update`.
- Verify: `browser-test/perf.mjs`.

- [ ] **Step 1: Add screenshot cases.** In `screenshot.mjs`, render `buildClipPageVM()` via `renderKnobsView` for these states (mirror how the main-page screenshot case is set up): (a) default (`1X`, len 16, transpose 0); (b) fraction scale (`1/4` stacked) + transpose −5 + length 9; (c) scale overlay open. Name baselines `clip-params-*`.

- [ ] **Step 2: Run to confirm new cases fail (no baseline yet)**

Run: `npm run build:browser && node browser-test/screenshot.mjs`
Expected: FAIL/diff for the new `clip-params-*` cases.

- [ ] **Step 3: Generate baselines**

Run: `node browser-test/screenshot.mjs --update`
Then inspect the produced PNGs to confirm: scale box shows `1X` / stacked `1/4`, length/transpose render big, overlay lists all 8 with `X`.

- [ ] **Step 4: Full local suite**

Run: `npm test && node browser-test/perf.mjs && cd engine && $CARGO test`
Expected: 0 failures everywhere; perf shows no regression vs baseline (fill_rect/IPC/render-time within existing thresholds).

- [ ] **Step 5: Commit**

```bash
git add browser-test/screenshot.mjs browser-test/baselines
git commit -m "test(ui): clip-params screenshot baselines + suite"
```

---

## Task 13: Device end-to-end

**Files:** none (verification).

- [ ] **Step 1: Reachability check**

Run: `ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && echo ONLINE || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"`

- [ ] **Step 2: If ONLINE — deploy engine + UI and run seq e2e**

Run: `./scripts/test-seq.sh`
Expected: PASS (transport, steps, record, session, persistence).

- [ ] **Step 3: If ONLINE — manual smoke** (the page has no scripted e2e yet): open movy in Track view, Shift+Step 3 → Clip Params appears; knob 0 opens scale overlay and changes playback speed audibly; knob 1 shrinks the lit step range and blanks LEDs beyond it; knob 2 transposes playback while live pads stay at pitch; record a pad note on a transposed clip and confirm it replays at the pad pitch; reopen after a power cycle to confirm persistence.

- [ ] **Step 4: If OFFLINE — report in CAPS** to the user that device verification was skipped, and stop here (local suite already green).

---

## Self-review notes

- **Spec coverage:** SCALE (Tasks 1,2,4,5,6,7,8 incl. overlay + box/fraction render + toast X), LENGTH (Tasks 2,7,8,10 incl. LEDs-off + last-write-wins via shared `length_steps`), TRANSPOSE (Tasks 1,2,3,7,8,11 incl. emit-only, record un-transpose, transposed hold display), navigation (Task 9: Shift+Step3 Track-only, Back + Session auto-close), persistence (Task 1 `cp` line), tests (Tasks 1–12). Doubling clip length "works correctly" is inherited — `dbl` writes `length_steps` which the LENGTH cell mirrors via status.
- **`8X` dropped, `1X` default (idx 4):** Task 6 tables.
- **`ct` unit + ±36 range:** Tasks 2 (clamp), 7 (clamp), 8 (toast).
- **Type consistency:** `scaleCellText`/`scaleToastText`/`rationalToIdx`/`SCALE_RATIONALS`/`SCALE_DEFAULT_IDX` defined Task 6, used Tasks 7/8. `clipScaleIdx`/`clipTranspose` defined Task 6, used Tasks 6–8,11. Engine ops `clen/cscl/ctr` defined Task 2, used Task 7. Status `csc`/`ctr` defined Task 5, parsed Task 6.
- **Open verification points for the implementer (confirm against code, don't assume):** exact `serialize`/`deserialize` fn names + `FORMAT_TAG` in persist.rs; recording entrypoint names (`start_recording`/`live_note_on`) in engine.rs; the Step-button index map in `seq/router.ts`; the render function name in `app/tick.ts`; whether `MAX_STEPS` is already exported from `constants.ts`.
