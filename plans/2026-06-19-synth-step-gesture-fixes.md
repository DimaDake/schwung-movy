# Synth-track step gesture fixes — design

Date: 2026-06-19
Scope: UI-side only (`src/seq/colors.ts`, `leds.ts`, `held.ts`, `router.ts`,
`step-edit.ts`). No engine changes — `slen`/`hlen` and the `hold` query already
provide everything needed.

## Problem

Four issues with synth (melodic) step editing:

1. Holding a step gives no visible indication of its note length. The length-tail
   overlay is implemented (`lengthSpanColor`, `leds.ts`) but invisible: it paints
   the tail in `trackColorDim(track)`, the *same* color as in-clip empty steps.
2. Pressing a step to enter a note adds only the single last-played pitch, not the
   full set of currently selected (white) notes.
3. Pressing two empty steps at the same time should add notes to both (works for
   drum lanes already; not for synth).
4. The hold-A + press-B length gesture has two defects:
   - It fires even when the held anchor has no note, colliding with feature 3.
   - The first press sets the note to end at the *start* of B; it should end at the
     *end* of B. Pressing the same B again should trim back to the start of B.

## Decisions (confirmed with user)

- **Feature 3 vs 4 boundary — by occupancy.** If the held anchor step A already has
  a note, pressing another step is the length gesture (forward only; B≤A ignored).
  If A is empty, pressing another step enters notes on both (multi-entry). No timing
  window.
- **Feature 4 repeat behavior — toggle.** First press of a given B → note ends at the
  END of step B (`B−A+1` steps). Pressing the same B again → END of A..START of B
  (`B−A` steps). Each subsequent press of the same B flips between the two. The toggle
  state resets when the anchor is released.

## Design

### Feature 1 — visible length tail
- Add `C_LIGHTGREY = 118` to `colors.ts` (platform "dim white"; `schwung` shared
  `LightGrey`). Brighter than `C_DARKGREY` (124), distinct from the colored
  `TRACK_COLOR_DIM`.
- `lengthSpanColor()` returns `C_LIGHTGREY` instead of `trackColorDim(track)`.
- No other change: the span is already painted before the playhead/occupied checks
  (so it overrides existing white steps) and already returns `-1` for `holdLen <= 1`
  (no tail for a 1-step note). `holdStep`/`holdLen` are already set on a single hold
  and refreshed from the engine `hlen` readback, so the tail shows on a plain hold
  and during the hold-A+press-B gesture.

Resulting step-LED brightness order: white (occupied, untouched) > light-grey
(length tail) > track-dim (in-clip empty) > dark-grey (out-of-clip).

### Feature 2 — enter all selected (white) notes
- Add `heldSetList(track): number[]` to `held.ts`, returning the `lastHeld` pitches.
- In `toggleStep()` (`router.ts`), the melodic no-pads-down fallback becomes:
  held chord (`heldChord`) → else `heldSetList(t)` → else `[lastPitch[t]]`.
- Toggle-clear of an occupied step is unchanged.

### Feature 3 — two empty synth steps → notes on both
- In `editStepDown` (`step-edit.ts`), drop the `watchLane >= 0` gate on the
  `coPressed` exemption so it applies whenever `heldRanges.size >= 2`: mark both held
  buttons `coPressed`, clear their `gestured` flags, and cancel any 300ms
  auto-promotion (`endStepAutomation()`), so each held step toggles its note on
  release. This is the existing drum multi-entry path, now reachable for synth.
- The synth path only reaches `editStepDown(B)` when the anchor is empty (length
  gesture is gated on occupancy below), so multi-entry and length-set never collide.

### Feature 4 — occupancy-gated length gesture with end/start toggle
In `router.ts` step note-on handling, the length branch fires only when the anchor
has a note:
- Anchor occupied + B>A → `setLengthTo(B)`; B is not registered as a held step.
- Anchor occupied + B≤A → consumed, no-op.
- Anchor empty + press B → fall through to `editStepDown(B)` (Feature 3).

`setLengthTo` (`step-edit.ts`) gains toggle state — module-level last target
`{ anchor, b, atEnd }`:
- For a new `(anchor, B)`: `atEnd = true`, length `= (B−A+1) * TICKS_PER_STEP`.
- Same `(anchor, B)` again: flip `atEnd`; length `= (atEnd ? B−A+1 : B−A) * TICKS_PER_STEP`.
- Emits `slen` as today; clamping handled by the engine.
- Reset on anchor release (`editStepUp`) and in `resetStepEdit`.

## Testing

- **logic.mjs:** length-toggle math (end/start, repeat flip, B≤A no-op);
  occupancy-gated branch selection; `heldSetList` fallback ordering.
- **app-loop.mjs:** two empty synth steps held → both occupied; hold occupied A +
  press B → A's length spans to B and B is not toggled.
- **screenshot.mjs:** new baseline for the light-grey length tail (plain hold; tail
  overriding an occupied step). `node browser-test/screenshot.mjs --update`.
- **perf.mjs:** no added per-tick IPC / fill_rect.
- **engine `cargo test`:** only if engine changes (none expected).
- **device `test-seq.sh`:** when `move.local` is reachable.
