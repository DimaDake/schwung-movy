# Batch 3 — Smooth playhead + step-length editing: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A continuously-sweeping on-screen playhead (hidden when stopped), a hold-A-press-B note-length gesture, and a step-row visualization of a held note's length.

**Architecture:** The engine gains three read/▾write status/command bits — `pos=` (watched `pos_tick`), `slen` (absolute note length), and `hold`/`hlen=` (length of the note at a queried step). The UI mirrors them and draws a smooth playhead, a length-span on the step LEDs, and routes the hold-A-press-B gesture to `slen`.

**Tech Stack:** TypeScript (movy UI), Rust (`engine/crates/seq-core`, `movy-dsp`), Node browser tests.

**Spec:** `movy/plans/2026-06-14-batch3-playhead-steplength.md`

**Branch:** continue on `feat/seq-led-affordance`.

**cargo:** not on the bare PATH — prefix `PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"` (run from `engine/`).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `engine/crates/seq-core/src/engine.rs` | `pos=` + `hlen=` in status; `held_query` field | modify |
| `engine/crates/seq-core/src/clip.rs` | `set_length` (absolute gate); `note_len_steps_at` | modify |
| `engine/crates/seq-core/src/command.rs` | `slen` + `hold` commands | modify |
| `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` | `ENGINE_VERSION` → 0.12.0 | modify |
| `src/seq/state.ts` | `posTick` / `holdStep` / `holdLen` mirror | modify |
| `src/seq/engine.ts` | parse `pos=` / `hlen=` | modify |
| `src/seq/render.ts` | `playheadX` + smooth sweep in `drawLoopStrip` | modify |
| `src/seq/step-edit.ts` | `setLengthTo(B)`, `heldStepAbs()` | modify |
| `src/seq/router.ts` | hold-A-press-B gesture; emit `hold`/clear | modify |
| `src/seq/leds.ts` | step-row length span (dim track color) | modify |
| `browser-test/logic.mjs` | unit tests | modify |

**Conventions:** `npm run build:browser` before `.mjs` tests; all LEDs via `cachedSet*`; comments explain WHY; ≤200-line files; keep `occ=` last in the status format string.

---

## Task 1: Engine — `pos=` status (watched pos_tick)

**Files:** `engine/crates/seq-core/src/engine.rs`

- [ ] **Step 1: Write the failing test**

Add to `engine.rs` tests:

```rust
#[test]
fn status_reports_watched_pos_tick() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    e.play();
    let _ = run_ticks(&mut e, 5);
    let s = e.status();
    let pos = s.split("pos=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(pos.parse::<u32>().unwrap(), e.tracks[e.watch_track].pos_tick);
}
```

- [ ] **Step 2: Run to verify it fails**

`cd engine && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core status_reports_watched_pos_tick`
Expected: FAIL — no `pos=`.

- [ ] **Step 3: Implement**

In `status()` insert `pos={}` right after `step={}` in the format string, and pass `wt.pos_tick` as the matching arg (after `wt.current_step()`):

```rust
            "play={} tick={} bpm={} trk={} step={} pos={} len={} lstart={} rec={} cin={} metro={} dirty={} sess={} act={} mute={} occ={}",
            // ...existing through wt.current_step(), then:
            wt.pos_tick,
            clip.length_steps,
            // ...rest unchanged...
```

- [ ] **Step 4: Run to verify it passes**

`cd engine && PATH="…:$PATH" cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(seq-core): report watched track pos_tick in status (pos=)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Engine — `slen` command + `clip.set_length`

**Files:** `engine/crates/seq-core/src/clip.rs`, `engine/crates/seq-core/src/command.rs`

- [ ] **Step 1: Write the failing test (clip.rs)**

```rust
#[test]
fn set_length_sets_absolute_gate() {
    let mut c = Clip::new();
    c.toggle_step(0, &[(60, 100)]);            // gate = TICKS_PER_STEP
    c.set_length(0, 0, None, 4 * TICKS_PER_STEP);
    let n = c.notes.iter().find(|n| n.tick == 0).unwrap();
    assert_eq!(n.gate, 4 * TICKS_PER_STEP);
}
```

- [ ] **Step 2: Run to verify it fails**

`cd engine && PATH="…:$PATH" cargo test -p seq-core set_length_sets_absolute_gate`
Expected: FAIL — `set_length` not found.

- [ ] **Step 3: Implement `set_length` in clip.rs**

Mirror `adjust_length`'s cap logic but set an absolute target. Place next to `adjust_length`:

```rust
/// Set the gate of matching notes to an absolute tick length, capped at the
/// clip end and the next same-pitch note (mirrors adjust_length's caps).
pub fn set_length(&mut self, s0: u16, s1: u16, lane: Option<u8>, ticks: u32) {
    let clip_end = self.length_ticks();
    let others: Vec<(u32, u8)> = self.notes.iter().map(|n| (n.tick, n.pitch)).collect();
    for n in &mut self.notes {
        if !Clip::note_matches(n, s0, s1, lane) {
            continue;
        }
        let mut cap = clip_end.saturating_sub(n.tick);
        for &(t, p) in &others {
            if p == n.pitch && t > n.tick {
                cap = cap.min(t - n.tick);
            }
        }
        n.gate = ticks.clamp(1, cap.max(1));
    }
}
```

- [ ] **Step 4: Add the `slen` command (command.rs)**

Extend the `"evel" | "elen" | …` match arm to also accept `slen`, OR add a sibling arm. Simplest — add a dedicated arm after the `evel|elen|…` block:

```rust
        // slen <t> <s0> <s1> <p> <ticks> — set absolute note length.
        "slen" => {
            if let (Some(t), Some(s0), Some(s1), Some(p), Some(tk)) =
                (next(), next(), next(), next(), next())
            {
                if (t as usize) < NUM_TRACKS {
                    let lane = if (0..128).contains(&p) { Some(p as u8) } else { None };
                    let (a, b) = (s0.clamp(0, 255) as u16, s1.clamp(0, 255) as u16);
                    engine.tracks[t as usize].active_mut().set_length(a, b, lane, tk.max(1) as u32);
                }
            }
        }
```

- [ ] **Step 5: Add a command-level test (command.rs tests)**

```rust
#[test]
fn slen_sets_note_length() {
    let mut e = Engine::new(44100, 12000);
    let mut out = Vec::new();
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    apply_batch(&mut e, "slen 0 0 0 -1 96", &mut out); // 96 ticks = 4 steps
    let n = e.tracks[0].active().notes.iter().find(|n| n.tick == 0).unwrap();
    assert_eq!(n.gate, 96);
}
```

- [ ] **Step 6: Run to verify pass**

`cd engine && PATH="…:$PATH" cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/crates/seq-core/src/clip.rs engine/crates/seq-core/src/command.rs
git commit -m "$(cat <<'EOF'
feat(seq-core): slen command sets absolute note length

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Engine — `hold` query + `hlen=` status + version bump

**Files:** `engine/crates/seq-core/src/engine.rs`, `clip.rs`, `command.rs`, `movy-dsp/src/lib.rs`, `src/seq/constants.ts`

- [ ] **Step 1: Write the failing test (engine.rs)**

```rust
#[test]
fn hold_query_reports_note_length_in_steps() {
    let mut e = engine();
    let mut out = Vec::new();
    e.tracks[0].active_mut().toggle_step(2, &[(60, 100)]);
    e.tracks[0].active_mut().set_length(2, 2, None, 4 * TICKS_PER_STEP); // 4 steps
    crate::command::apply_batch(&mut e, "hold 0 2", &mut out);
    let hlen = e.status().split("hlen=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(hlen, "4");
    crate::command::apply_batch(&mut e, "hold 0 -1", &mut out); // clear
    let hlen0 = e.status().split("hlen=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(hlen0, "0");
}
```

- [ ] **Step 2: Run to verify it fails**

`cd engine && PATH="…:$PATH" cargo test -p seq-core hold_query_reports_note_length_in_steps`
Expected: FAIL — no `hold`/`hlen=`.

- [ ] **Step 3: Add the `held_query` field (engine.rs)**

Add to the `Engine` struct and `new()`:

```rust
    /// (track, step) the UI is holding, for the step-length readout. None = not held.
    held_query: Option<(usize, u16)>,
```
```rust
            held_query: None,
```

- [ ] **Step 4: Length-at-step helper (clip.rs)**

```rust
/// Length in whole steps (rounded up, min 1) of the note anchored at `step`,
/// or 0 if no note there. Uses the first matching pitch.
pub fn note_len_steps_at(&self, step: u16) -> u16 {
    self.notes
        .iter()
        .find(|n| n.step == step)
        .map(|n| ((n.gate + TICKS_PER_STEP - 1) / TICKS_PER_STEP).max(1) as u16)
        .unwrap_or(0)
}
```

- [ ] **Step 5: `hlen=` in status (engine.rs)**

Add a helper and field to `status()`:

```rust
fn held_len_steps(&self) -> u16 {
    match self.held_query {
        Some((t, step)) if t < NUM_TRACKS => self.tracks[t].active().note_len_steps_at(step),
        _ => 0,
    }
}
```

Insert `hlen={}` into the format (before `occ=`, after `mute=`), arg `self.held_len_steps()`.

- [ ] **Step 6: `hold` command (command.rs)**

```rust
        // hold <track> <step> — set the step-length query (step < 0 clears).
        "hold" => {
            if let (Some(t), Some(s)) = (next(), next()) {
                engine.set_held_query(if s < 0 { None } else { Some((t as usize, s.clamp(0,255) as u16)) });
            }
        }
```

Add the setter to engine.rs (the field is private):

```rust
pub fn set_held_query(&mut self, q: Option<(usize, u16)>) {
    self.held_query = q;
}
```

- [ ] **Step 7: Run to verify pass**

`cd engine && PATH="…:$PATH" cargo test -p seq-core`
Expected: PASS.

- [ ] **Step 8: Version bump**

`movy-dsp/src/lib.rs`: `ENGINE_VERSION` → `"0.12.0"`. `src/seq/constants.ts`: `'0.12.0'`.

- [ ] **Step 9: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/clip.rs engine/crates/seq-core/src/command.rs engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
feat(seq-core): hold-step length query (hold cmd / hlen= status); bump 0.12.0

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: UI mirror — posTick / holdStep / holdLen

**Files:** `src/seq/state.ts`, `src/seq/engine.ts`, `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { seqState } from '../dist/esm/seq/state.js';

function testBatch3Mirror() {
    _log('\nbatch3 status mirror:');
    parseStatusForTest('play=1 tick=10 step=2 pos=53 len=32 hlen=4 occ=' + '0'.repeat(64));
    eq('posTick parsed', seqState.posTick, 53);
    eq('holdLen parsed', seqState.holdLen, 4);
}
```

This needs `parseStatusForTest`. Add a test hook to `engine.ts`:

```ts
/* Test hook: drive parseStatus directly. */
export function parseStatusForTest(s: string): void { parseStatus(s); }
```

Import it in logic.mjs: `import { parseStatusForTest } from '../dist/esm/seq/engine.js';` and invoke `testBatch3Mirror();`.

- [ ] **Step 2: Run to verify it fails**

`npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `posTick`/`holdLen` undefined / `parseStatusForTest` missing.

- [ ] **Step 3: Implement state fields (state.ts)**

Add to `SeqUiState` + `defaults()`:

```ts
    posTick: number;         // watched track playhead tick (from `pos=`)
    holdStep: number;        // step whose length is being shown, or -1
    holdLen: number;         // held note length in steps (from `hlen=`), 0 = none
```
```ts
        posTick: 0,
        holdStep: -1,
        holdLen: 0,
```

- [ ] **Step 4: Parse in engine.ts**

In `parseStatus`, add:

```ts
        else if (key === 'pos') seqState.posTick = Number(val) || 0;
        else if (key === 'hlen') seqState.holdLen = Number(val) || 0;
```

Add the `parseStatusForTest` export from Step 1.

- [ ] **Step 5: Run to verify pass**

`npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/state.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): mirror posTick / holdStep / holdLen from status

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Smooth playhead

**Files:** `src/seq/render.ts`, `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { playheadX } from '../dist/esm/seq/render.js';

function testPlayhead() {
    _log('\nplayhead position:');
    const W = 128;
    eq('start at 0', playheadX(0, 32, W), 0);
    eq('mid', playheadX(16 * 24, 32, W), 64);   // half of a 32-step clip
    eq('clamps to width-1', playheadX(999999, 32, W), W - 1);
    eq('empty clip → 0', playheadX(0, 0, W), 0);
}
```

Invoke `testPlayhead();`.

- [ ] **Step 2: Run to verify it fails**

`npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `playheadX` not exported.

- [ ] **Step 3: Implement in render.ts**

```ts
const TICKS_PER_STEP = 24; // mirror of seq-core

/* Continuous playhead x within the strip: fraction of the clip elapsed. */
export function playheadX(posTick: number, lenSteps: number, stripW: number): number {
    const lenTicks = Math.max(lenSteps, 16) * TICKS_PER_STEP;
    if (lenTicks <= 0) return 0;
    const x = Math.round((posTick / lenTicks) * stripW);
    return Math.max(0, Math.min(x, stripW - 1));
}
```

Replace the playhead block in `drawLoopStrip` (the `if (seqState.playing) { … }` at the bottom) with:

```ts
    if (seqState.playing) {
        const px = playheadX(seqState.posTick, seqState.lenSteps, W);
        fill_rect(px, STRIP_Y - 2, 1, 4, 1);
    }
```

(Drop the old `playBar`-centered computation. Keep everything above it.)

- [ ] **Step 4: Run to verify pass**

`npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/render.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): smooth continuous playhead sweep on the loop strip

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Hold-A-press-B length gesture

**Files:** `src/seq/step-edit.ts`, `src/seq/router.ts`, `browser-test/logic.mjs`

**Background:** When exactly one step is held (Note mode) and a *different* step is pressed, set the held note's length to span A→B. `step-edit.ts` exposes the held absolute step and a `setLengthTo`.

- [ ] **Step 1: Write the failing test**

```js
import { editStepDown, setLengthTo, heldStepAbs, resetStepEdit } from '../dist/esm/seq/step-edit.js';

function testLengthGesture() {
    _log('\nhold-A-press-B length:');
    resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.barOffset = 0; seqState.watchLane = -1; seqState.watchTrack = 0;
    editStepDown(2);                  // hold step 2 (abs 2)
    eq('heldStepAbs is 2', heldStepAbs(), 2);
    setLengthTo(6);                   // press step 6 → length 4 steps = 96 ticks
    eq('slen emitted', peekSeqCmdQueue().some(c => c === 'slen 0 2 2 -1 96'), true);
    resetStepEdit();
    editStepDown(4);
    eq('B<=A is no-op', setLengthTo(4), false);
}
```

Invoke `testLengthGesture();` (needs `peekSeqCmdQueue` from Batch 2 — already exported).

- [ ] **Step 2: Run to verify it fails**

`npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `setLengthTo`/`heldStepAbs` not exported.

- [ ] **Step 3: Implement in step-edit.ts**

```ts
const TICKS_PER_STEP_EDIT = 24; // (TICKS_PER_STEP already defined in this file)

/* The single held step's absolute index (Note mode), or -1 if not exactly one. */
export function heldStepAbs(): number {
    if (heldRanges.size !== 1) return -1;
    const r = [...heldRanges.values()][0];
    return r.s0 === r.s1 ? r.s0 : -1;
}

/* Hold A + press B → set A's note length to span to B. Returns true if a
 * length-set was emitted (B > A), false otherwise. */
export function setLengthTo(absB: number): boolean {
    const a = heldStepAbs();
    if (a < 0 || absB <= a) return false;
    markGestured();
    const ticks = (absB - a) * TICKS_PER_STEP;
    seqCmd(`slen ${seqState.watchTrack} ${a} ${a} ${lane()} ${ticks}`);
    seqToast('Length ' + (absB - a));
    return true;
}
```

(`TICKS_PER_STEP` already exists at the top of step-edit.ts; reuse it — do not add a duplicate.)

- [ ] **Step 4: Route the gesture in router.ts**

In `seqHandleMidi`'s step-button branch, in the `on` (press) path, before the existing `editStepDown(button)` for a normal press, intercept the length gesture: if a single step is already held and this press is a different step, call `setLengthTo` and consume it.

Locate the `} else if (on) {` arm (normal press, not shift/copy/delete) and change it to:

```ts
        } else if (on) {
            const absB = seqState.barOffset * NUM_STEP_BUTTONS + button;
            if (!seqState.loopMode && heldStepAbs() >= 0 && absB !== heldStepAbs()
                && setLengthTo(absB)) {
                // length gesture consumed; do not register B as a held step
            } else {
                editStepDown(button);
                if (seqState.loopMode) loopStepOn(button);
            }
        }
```

Import `heldStepAbs, setLengthTo` from `./step-edit.js` (extend the existing import).

- [ ] **Step 5: Run to verify pass**

`npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/step-edit.ts src/seq/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): hold step A + press step B sets A's note length

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Step-row length visualization

**Files:** `src/seq/router.ts`, `src/seq/leds.ts`, `browser-test/logic.mjs`

**Background:** While a single step is held, emit `hold <t> <absStep>` (and `hold <t> -1` on release); the step-row painter lights the held step's note plus the next `holdLen−1` steps in `trackColorDim`.

- [ ] **Step 1: Emit hold/clear from router.ts**

In the step-button branch: when `editStepDown(button)` registers a single Note-mode step, set `seqState.holdStep` and emit `hold`. On `editStepUp` when no steps remain held, clear. Concretely, after the `editStepDown(button)` call in the `else` arm above add:

```ts
                if (!seqState.loopMode && heldStepAbs() >= 0) {
                    seqState.holdStep = heldStepAbs();
                    seqCmd('hold ' + seqState.watchTrack + ' ' + seqState.holdStep);
                }
```

And in the release path (`const wasTap = editStepUp(button);`) add after it:

```ts
            if (!anyStepHeld()) {
                seqState.holdStep = -1;
                seqState.holdLen = 0;
                seqCmd('hold ' + seqState.watchTrack + ' -1');
            }
```

- [ ] **Step 2: Write the failing test (step-row color)**

```js
import { lengthSpanColor } from '../dist/esm/seq/leds.js';
import { trackColorDim } from '../dist/esm/seq/colors.js';

function testLengthSpan() {
    _log('\nstep-row length span:');
    // held abs step 2, length 4 → steps 3,4,5 are span (dim), step 2 is the held note.
    eq('span step dim', lengthSpanColor(4, 2, 4, 0), trackColorDim(0)); // absStep 4 within [3,5]
    eq('held step not span', lengthSpanColor(2, 2, 4, 0), -1);          // -1 = "not a span step"
    eq('past span', lengthSpanColor(6, 2, 4, 0), -1);
    eq('no hold', lengthSpanColor(4, -1, 0, 0), -1);
}
```

Invoke `testLengthSpan();`.

- [ ] **Step 3: Run to verify it fails**

`npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `lengthSpanColor` not exported.

- [ ] **Step 4: Implement in leds.ts**

```ts
/* Length-span overlay while a step is held: the steps AFTER the held step, up
 * to its note length, light dim track color. Returns -1 when `absStep` is not a
 * span step (so the caller keeps the normal step color). */
export function lengthSpanColor(absStep: number, holdStep: number, holdLen: number, track: number): number {
    if (holdStep < 0 || holdLen <= 1) return -1;
    if (absStep > holdStep && absStep <= holdStep + holdLen - 1) return trackColorDim(track);
    return -1;
}
```

In `seqLedsTick`'s Note-mode step-row loop, consult it before falling back to the normal color:

```ts
        const span = lengthSpanColor(step, seqState.holdStep, seqState.holdLen, seqState.watchTrack);
        let color: number;
        if (span >= 0) {
            color = span;
        } else if (step === playStep) {
            color = C_GREEN;
        } else if (occHasStep(step)) {
            color = C_WHITE;
        } else if (seqState.lenSteps > 0 && step < seqState.lenSteps) {
            color = dimTrack;
        } else {
            color = C_DARKGREY;
        }
```

(`step` here is the absolute step `base + i` already computed in the loop.)

- [ ] **Step 5: Run to verify pass**

`npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/router.ts src/seq/leds.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): step-row shows held note length in dim track color

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Build + local + device verification

**Files:** none (verification)

- [ ] **Step 1: Engine build + tests**

`cd engine && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test && cd ..`
Expected: all pass.

- [ ] **Step 2: Full local suite**

```bash
npm run typecheck                 # only pre-existing file-handler.ts error
npm run build:browser
node browser-test/logic.mjs       # 0 failures
node browser-test/perf.mjs        # within budget
node browser-test/screenshot.mjs  # update only intended playhead frames if they diff
```

- [ ] **Step 3: Device (if reachable)**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" ./scripts/test-seq.sh && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, report DEVICE OFFLINE in CAPS. On device, eyeball: playhead glides smoothly and disappears on stop; hold a step → its length lights dim on the step row; hold A + press B → length changes (audibly longer/shorter note).

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-review notes

- **Spec coverage:** `pos=` (T1) · `slen`+set_length (T2) · `hold`/`hlen=` (T3) · UI mirror (T4) · smooth playhead (T5) · hold-A-press-B gesture (T6) · step-row length viz (T7) · verification (T8). All spec items covered.
- **Type consistency:** `playheadX(posTick,lenSteps,stripW)`, `lengthSpanColor(absStep,holdStep,holdLen,track)`, `heldStepAbs()`, `setLengthTo(absB)`, `parseStatusForTest` — used consistently across tasks. `TICKS_PER_STEP=24` mirrored in render.ts and reused (not duplicated) in step-edit.ts.
- **Status format:** `pos=` after `step=`; `hlen=` after `mute=`; `occ=` stays last. (Batch-2 added `mute=`; do not reorder it.)
- **Ordering:** Task 6 must precede Task 7 (Task 7's router edits extend the step-button arm Task 6 introduces). Do T6 then T7.
- **Deferred:** count-in gating + visual metronome (Batch 4).
```
