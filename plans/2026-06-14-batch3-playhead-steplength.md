# Batch 3 — Smooth playhead + step-length editing

Status: design (approved, proceeding to plan)
Date: 2026-06-14
Part of: the movy sequencer LED/UX refinement epic. Batch 3.
Prereq: Batches 1–2 on `feat/seq-led-affordance`.

## Goal

The on-screen playhead sweeps smoothly along the bottom strip (hidden when the
track isn't playing); holding a step shows that note's current length on the
**step row** (dark track color); holding step A then pressing step B sets A's
note length to span A→B.

## Established facts (verified in code)

- Notes carry `tick` (start, within clip) + `gate` (length in ticks);
  `clip.adjust_length(a,b,lane,dv)` changes gate by a delta (the UI's `elen`).
  No absolute-set exists yet.
- `Track::current_step() = pos_tick / TICKS_PER_STEP`; `pos_tick` is the finer
  playhead position. Status reports step-granular `step=`, not `pos_tick`.
- `TICKS_PER_STEP = 24` (96 PPQN / 4); mirrored UI-side in `step-edit.ts`.
- Step-row painting + the bottom Loop strip both live in the UI: `seq/leds.ts`
  (`seqLedsTick` step row) and `seq/render.ts` (`drawLoopStrip`).
- `step-edit.ts` tracks held step buttons (`heldRanges`, `anyStepHeld`).

## Engine changes (`seq-core`) — small, read/▾write

1. **`pos=` status field** — the watched track's `pos_tick` (u32). Lets the UI
   draw a continuous playhead. Insert after `step=` in `status()`.
2. **`slen` command** — `slen <t> <s0> <s1> <lane> <ticks>`: set the gate of the
   note(s) in `[s0,s1]` (lane filter as in `elen`) to an absolute tick length.
   Add `clip.set_length(a,b,lane,ticks)` next to `adjust_length`.
3. **`hold` query + `hlen=` status** — `hold <track> <step>` records a queried
   step (or `-1` to clear); `status()` reports `hlen=<steps>` = the note length
   (in whole steps, rounded up, min 1) at that step on that track, or `0` when
   none / not held. Drives the step-row length visualization.
4. Bump `ENGINE_VERSION` 0.11.0 → 0.12.0 (UI + Rust). `cargo test` for each new
   behavior.

## UI components

### 1. Smooth playhead — `seq/state.ts`, `seq/engine.ts`, `seq/render.ts`
- Mirror `posTick` (from `pos=`) in `seqState`; parse in `parseStatus`.
- `drawLoopStrip`: replace the bar-centered mark with a continuous sweep at
  `x = round(posTick / clipLenTicks × stripWidth)`, clamped to the strip, where
  `clipLenTicks = max(lenSteps,16) × TICKS_PER_STEP`. Keep `if (playing)` gate
  (no playhead when stopped). Pure helper `playheadX(posTick, lenSteps, stripW)`
  unit-tested.

### 2. Hold-step length gesture — `seq/router.ts`, `seq/step-edit.ts`
- When exactly one step is held (Note mode) and another step button is pressed,
  consume it as a length-set: `slen <t> A A <lane> <(B−A)×TICKS_PER_STEP>` where
  A = held step (absolute), B = pressed step (absolute), `B > A`. A press at or
  before A is ignored (no-op).
- Lives in the step-button branch of `seqHandleMidi`: if `anyStepHeld()` and the
  new press isn't the held button, route to `step-edit.ts setLengthTo(B)`.
- `setLengthTo` marks the held range gestured (so the held button's release is
  not treated as a tap/toggle) and emits `slen`.

### 3. Step-row length visualization — `seq/state.ts`, `seq/router.ts`, `seq/leds.ts`
- On step-down of a single step (Note mode), emit `hold <track> <absStep>`; on
  release of the last held step, emit `hold <track> -1`.
- Mirror `holdStep` (abs step or −1) and `holdLen` (from `hlen=`) in `seqState`.
- In `seqLedsTick`'s step-row loop: when `holdStep` is in the visible bar, paint
  the held step itself (its note → white as today) and the following
  `holdLen−1` steps within the bar in **`trackColorDim`** (the "dark track
  color", dimmer than an unselected step). The span is clipped to the visible
  bar; it overlays the normal step row only while a step is held.
- Pure helper `stepRowColor(...)` extended (or a `lengthSpanColor`) so the
  branch is unit-testable.

## Performance
- Playhead draws each tick only while playing (the strip already redraws every
  tick); `playheadX` is integer math, no allocation.
- Length-span painting stays on `cachedSetLED`; it changes only on hold/release
  or when `hlen` updates — zero steady-state cost otherwise.
- `hold`/`hlen` round-trips at the status-poll cadence (~24 Hz); a ~1-poll delay
  before the span appears is acceptable for a visualization.

## Testing
- `logic.mjs`: `playheadX` (start/mid/end, clamp); `slen` gesture emits the
  right command for B>A and is a no-op for B≤A; step-row length-span color
  branch; `posTick`/`holdStep`/`holdLen` mirror parsing.
- `cargo test`: `pos=` present; `slen` sets absolute gate; `hold`/`hlen` reports
  the note length at the queried step (and 0 when cleared/none).
- `screenshot.mjs`: playhead position frames (update only the intended new
  frames). `perf.mjs`: within budget.
- Device: `test-seq.sh` + `test.sh`. Eyeball: playhead glides (no stepping) and
  vanishes on stop; holding a step lights its length span dim; hold A + press B
  sets the length audibly.

## Deferred → Batch 4
Count-in gating (no clip playback during count-in; never count-in while already
playing) + empty-clip visual metronome.
