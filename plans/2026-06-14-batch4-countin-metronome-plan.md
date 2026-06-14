# Batch 4 — Count-in gating + empty-clip visual metronome: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No clip playback during a record count-in; no count-in when Rec is pressed while already playing; an empty clip shows a green cycling 4-step visual metronome while playing.

**Architecture:** Two small `seq-core` changes gate the scheduler's note emission on `count_in_left` and make `toggle_record` punch-in when already playing. One UI helper drives a green beat-group overlay on the step row for empty clips.

**Tech Stack:** Rust (`engine/crates/seq-core`, `movy-dsp`), TypeScript (movy UI), Node browser tests.

**Spec:** `movy/plans/2026-06-14-batch4-countin-metronome.md`

**Branch:** continue on `feat/seq-led-affordance`.

**cargo:** not on the bare PATH — prefix `PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"` (run from `engine/`).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `engine/crates/seq-core/src/engine.rs` | gate note emission on count-in; punch-in record | modify |
| `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` | `ENGINE_VERSION` → 0.13.0 | modify |
| `src/seq/leds.ts` | `metronomeStep` helper + empty-clip overlay in step row | modify |
| `browser-test/logic.mjs` | `metronomeStep` test | modify |

**Conventions:** keep `occ=` last in status (unchanged here); all LEDs via `cachedSetLED`; comments explain WHY; `src/seq/leds.ts` is near the 200-line limit — keep additions compact.

---

## Task 1: Engine — no clip playback during count-in

**Files:** `engine/crates/seq-core/src/engine.rs`

**Background:** `service_tick`'s per-track note-emission/advance loop (the `for ti in 0..NUM_TRACKS { … }` at ~engine.rs:429) runs every tick. Gating it on `count_in_left == 0` keeps clips silent and the playhead parked at loop-start during the count-in; the click loop (above it) is untouched.

- [ ] **Step 1: Write the failing test**

Add to `engine.rs` tests (the module already has `engine()`, `run_ticks`, and `OutEvent` in scope):

```rust
#[test]
fn clips_silent_during_count_in_then_play() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    e.toggle_record(0); // arms a one-bar count-in, starts transport
    // Most of the count-in bar: no clip NoteOn (clicks are a different event).
    let during = run_ticks(&mut e, crate::TICKS_PER_BAR as u64 - 4);
    assert!(!during.iter().any(|x| matches!(x, OutEvent::NoteOn { .. })),
            "no clip notes during count-in");
    // Cross the count-in boundary: the step-0 note plays.
    let after = run_ticks(&mut e, 8);
    assert!(after.iter().any(|x| matches!(x, OutEvent::NoteOn { pitch: 60, .. })),
            "note plays once count-in ends");
}
```

- [ ] **Step 2: Run to verify it fails**

`cd engine && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core clips_silent_during_count_in_then_play`
Expected: FAIL — a NoteOn is emitted during the count-in.

- [ ] **Step 3: Implement**

In `service_tick`, wrap the per-track emission loop. Find:

```rust
        for ti in 0..NUM_TRACKS {
            let Some(slot) = self.tracks[ti].playing_slot else {
                continue;
            };
            // … note emission + pos_tick advance + wrap …
        }
```

Wrap the entire `for ti in 0..NUM_TRACKS { … }` block in:

```rust
        // No clip playback (and no playhead advance) during the count-in: the
        // pre-roll bar only clicks; playback starts cleanly from loop-start on
        // the tick the count-in reaches 0.
        if self.count_in_left == 0 {
            for ti in 0..NUM_TRACKS {
                // … unchanged loop body …
            }
        }
```

(The note-off gate loop above it stays outside the guard — harmless during count-in since no gates are open.)

- [ ] **Step 4: Run to verify it passes**

`cd engine && PATH="…:$PATH" cargo test -p seq-core`
Expected: PASS (all, including the new test).

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(seq-core): suppress clip playback during the record count-in

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Engine — punch-in record (no count-in while playing) + version bump

**Files:** `engine/crates/seq-core/src/engine.rs`, `engine/crates/movy-dsp/src/lib.rs`, `src/seq/constants.ts`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn record_while_playing_skips_count_in() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    e.play();              // transport already running
    e.toggle_record(0);
    assert!(e.recording, "records immediately");
    assert!(!e.counting_in(), "no count-in while already playing");
}

#[test]
fn record_while_stopped_arms_count_in() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    e.toggle_record(0);
    assert!(e.counting_in(), "stopped: arms the count-in");
    assert!(!e.recording, "recording begins only after the count-in");
}
```

- [ ] **Step 2: Run to verify it fails**

`cd engine && PATH="…:$PATH" cargo test -p seq-core record_while_playing_skips_count_in record_while_stopped_arms_count_in`
Expected: `record_while_playing_skips_count_in` FAILS (count-in armed even while playing).

- [ ] **Step 3: Implement**

In `toggle_record`, replace the tail. Find:

```rust
        self.tracks[track].active_mut().ensure_exists();
        if !self.playing {
            self.play();
        }
        self.count_in_left = crate::TICKS_PER_BAR;
```

with:

```rust
        let was_playing = self.playing;
        self.tracks[track].active_mut().ensure_exists();
        if !self.playing {
            self.play();
        }
        if was_playing {
            self.recording = true;             // punch-in: record now, no count-in
        } else {
            self.count_in_left = crate::TICKS_PER_BAR;
        }
```

- [ ] **Step 4: Run to verify it passes**

`cd engine && PATH="…:$PATH" cargo test -p seq-core`
Expected: PASS (all).

- [ ] **Step 5: Version bump**

`engine/crates/movy-dsp/src/lib.rs`: `ENGINE_VERSION` → `"0.13.0"`.
`src/seq/constants.ts`: `ENGINE_VERSION = '0.13.0'`.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
feat(seq-core): Rec while playing records immediately (no count-in); bump 0.13.0

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: UI — empty-clip visual metronome

**Files:** `src/seq/leds.ts`, `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

Add to `logic.mjs`:

```js
import { metronomeStep } from '../dist/esm/seq/leds.js';

function testMetronome() {
    _log('\nvisual metronome:');
    eq('beat0 lights step 0', metronomeStep(0, 0), true);
    eq('beat0 lights step 3', metronomeStep(3, 0), true);
    eq('beat0 dark step 4', metronomeStep(4, 0), false);
    eq('beat1 lights step 4', metronomeStep(4, 96), true);
    eq('beat3 lights step 12', metronomeStep(12, 96 * 3), true);
    eq('wraps to beat0 at 4 beats', metronomeStep(0, 96 * 4), true);
}
```

Invoke `testMetronome();` in the run sequence.

- [ ] **Step 2: Run to verify it fails**

`npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `metronomeStep` not exported.

- [ ] **Step 3: Implement in `seq/leds.ts`**

Add the helper (near the other step-row helpers):

```ts
const TICKS_PER_BEAT = 96; // PPQN, mirror of seq-core

/* Empty-clip visual metronome: which of the 4 four-step beat-groups is lit
 * this engine tick. Marches one group per beat, cycling each bar. */
export function metronomeStep(stepInBar: number, engineTick: number): boolean {
    return Math.floor(stepInBar / 4) === Math.floor(engineTick / TICKS_PER_BEAT) % 4;
}
```

In `seqLedsTick`'s Note-mode step-row loop, add the empty+playing branch as the first color decision:

```ts
    const emptyMetro = seqState.lenSteps === 0 && seqState.playing;
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        const step = base + i;
        let color: number;
        if (emptyMetro) {
            color = metronomeStep(i, seqState.engineTick) ? C_GREEN : C_BLACK;
        } else {
            const span = lengthSpanColor(step, seqState.holdStep, seqState.holdLen, seqState.watchTrack);
            if (span >= 0) color = span;
            else if (step === playStep) color = C_GREEN;
            else if (occHasStep(step)) color = C_WHITE;
            else if (seqState.lenSteps > 0 && step < seqState.lenSteps) color = dimTrack;
            else color = C_DARKGREY;
        }
        cachedSetLED(STEP_NOTE_BASE + i, color);
    }
```

(Adapt to the loop's existing variable names — `playStep`, `dimTrack` are already computed above the loop. Keep the file under 200 lines; compact the existing branch into the `else` as shown.)

- [ ] **Step 4: Run to verify it passes**

`npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, zero new TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): empty clip shows a green cycling 4-step visual metronome

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Build + local + device verification

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
node browser-test/screenshot.mjs  # expect 22/0 (LED-only change; no display diff)
```

- [ ] **Step 3: Device (if reachable)**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" ./scripts/test-seq.sh && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, report DEVICE OFFLINE in CAPS. On device, eyeball: Rec from stopped → one bar of clicks with silent clips, then playback on the downbeat; Rec while playing → records instantly (no count-in); an empty clip while playing shows the green 4-step group marching each beat.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-review notes

- **Spec coverage:** count-in gating (T1) · punch-in record (T2) · version bump (T2) · visual metronome (T3) · verification (T4). All spec items covered.
- **Type consistency:** `metronomeStep(stepInBar, engineTick)` defined T3, used in the same loop; `TICKS_PER_BEAT=96` matches `PPQN`. `was_playing`/`recording`/`count_in_left` are engine-internal, consistent with existing fields.
- **No status-format change** this batch, so `occ=` ordering is untouched (still bump the version because engine *behavior* changed and the UI re-probes on version match).
- **Epic complete** after this batch.
```
