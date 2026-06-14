# Batch 4 — Count-in gating + empty-clip visual metronome

Status: design (approved, proceeding to plan)
Date: 2026-06-14
Part of: the movy sequencer LED/UX refinement epic. Final batch.
Prereq: Batches 1–3 on `feat/seq-led-affordance`.

## Goal

Recording with a count-in plays no clips until the count-in bar finishes;
pressing Rec while already playing records immediately (no count-in); and an
empty clip shows a green cycling 4-step visual metronome while the transport
plays.

## Established facts (verified in code)

- `service_tick` (engine.rs) emits clip `NoteOn`s and advances `pos_tick` on
  **every** tick, regardless of `count_in_left` — so clips currently play
  during the count-in (the bug).
- The metronome `Click` already fires on the beat while `count_in_left > 0`
  (engine.rs ~386); count-in decrements at ~407 and sets `recording = true`
  when it reaches 0.
- `toggle_record` always arms `count_in_left = TICKS_PER_BAR`; it calls
  `play()` only when stopped, but arms the count-in unconditionally.
- `play()` seeds each playing track's `pos_tick` to its loop start; with all
  clips empty, no `playing_slot` is set but `master_tick` still advances while
  `playing` (so a global beat exists for the visual metronome).
- `PPQN = 96` ticks per quarter note (one beat); `TICKS_PER_STEP = 24`,
  `TICKS_PER_BAR = 384` (16 steps). The UI already mirrors `master_tick` as
  `seqState.engineTick` (from `tick=`).

## Engine changes (`seq-core`)

### 1. No clip playback during count-in
Wrap the per-track note-emission/advance loop in `service_tick` (the
`for ti in 0..NUM_TRACKS { … }` block, ~engine.rs:429) in
`if self.count_in_left == 0 { … }`. During the count-in: clicks still fire,
`master_tick` advances, but no clip `NoteOn`s and no `pos_tick` advance — so the
playhead stays at loop-start and playback begins cleanly from the top on the
tick the count-in reaches 0 (that tick has `count_in_left == 0`, so the loop
runs and emits from `pos = loop_start`).

### 2. No count-in while already playing (punch-in)
In `toggle_record`, snapshot `was_playing = self.playing` before the
`if !self.playing { self.play(); }`. Then:
```
if was_playing {
    self.recording = true;          // record immediately, no count-in
} else {
    self.count_in_left = crate::TICKS_PER_BAR;
}
```
(Replaces the unconditional `self.count_in_left = TICKS_PER_BAR`.)

### 3. Version bump 0.12.0 → 0.13.0 (UI + Rust). `cargo test` for both behaviors.

## UI change

### Empty-clip visual metronome — `seq/leds.ts`
- Pure helper:
  ```ts
  const TICKS_PER_BEAT = 96; // PPQN, mirror of seq-core
  /* Which beat-group (0..3) of 4 steps is lit this tick. */
  export function metronomeStep(stepInBar: number, engineTick: number): boolean {
      return Math.floor(stepInBar / 4) === Math.floor(engineTick / TICKS_PER_BEAT) % 4;
  }
  ```
- In `seqLedsTick`'s Note-mode step-row loop: when `seqState.lenSteps === 0 &&
  seqState.playing`, the step color is `metronomeStep(i, seqState.engineTick) ?
  C_GREEN : C_BLACK` (green like the Play button, uniform, no downbeat accent).
  This takes precedence over the normal empty-step coloring; when the clip has
  content or the transport is stopped, the existing logic (length-span /
  playhead / note / in-loop / out-of-loop) is unchanged.
- No new state mirror needed (`engineTick` already mirrored).

## Performance
- The metronome painting stays on `cachedSetLED` — it changes only when the
  beat-group advances (~2–4×/sec), so near-zero IPC.
- `metronomeStep` is integer math, no allocation; called only for the 16 step
  LEDs while empty+playing.

## Testing
- `cargo test`: clips silent while `count_in_left > 0` then audible when it
  reaches 0 (assert no `NoteOn` during the count-in bar, `NoteOn` after);
  `toggle_record` while playing sets `recording` immediately with
  `count_in_left == 0`; while stopped arms the count-in.
- `logic.mjs`: `metronomeStep` group cycling (beat 0 → steps 0-3, beat 1 →
  4-7, …, wrap at beat 4).
- `perf.mjs`: within budget. `screenshot.mjs`: no on-screen change expected
  (LED-only); confirm 22/0.
- Device: `test-seq.sh` + `test.sh`. Eyeball: count-in bar clicks with silent
  clips, then playback starts on the downbeat; Rec while playing records with
  no count-in; an empty clip shows the green 4-step group marching each beat.

## Epic complete after this
Batch 4 is the final batch. After it merges, the full refinement list (LED
affordance, view interaction, playhead/step-length, count-in/metronome) is done.
