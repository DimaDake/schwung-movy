# Clip Parameters page — Design

Date: 2026-06-23

A new sequencer settings page — **Clip Parameters** — modelled on the existing
**Main Params** page (`src/seq/main-page.ts` + `main-page-vm.ts`). It exposes
three per-clip controls on the knobs: **SCALE** (playback-speed multiplier),
**LENGTH** (clip length in steps), and **TRANSPOSE** (non-destructive sequence
transpose). All navigation, toast, knob-touch, overlay and value-highlight
behaviour matches Main Params; when unsure of a UI detail, copy Main Params.

## Scope decisions (resolved during brainstorming)

- **Target clip:** the **active/playing clip** on the active track only. No
  per-clip selection UI, no Session-view clip-pad entry.
- **Availability:** **Track view only.** Opening from Session view is dropped.
  Switching to Session view auto-closes the page.
- **Scale direction:** higher = faster. `2X` = double BPM (each step half as
  long); `1/2X` = half BPM (each step twice as long).
- **Scale range:** `8X` dropped (too fast). Eight values remain.

## Navigation & lifecycle

- **Open:** `Shift + Step 3`, only in Track view. (Main Params uses Shift+Step
  5/7/9; add Step 3 → open Clip Params in `src/seq/router.ts`.)
- **Close:** Back button, or a switch to Session view (auto-close).
- New `src/seq/clip-page.ts` (state machine) and `src/seq/clip-page-vm.ts`
  (ViewModel) mirror `main-page.ts` / `main-page-vm.ts` exactly:
  `clipPageState { active, origin, touchedKnob, scaleOverlay, scaleSel }`, a
  detent accumulator (`countDetents`), knob-touch toasts, and a scrollable
  overlay for the long enum.
- Routing: `midi/router.ts` adds the same guarded branches it has for
  `mainPageActive()` (knob turn → `clipPageKnob`, knob touch/release, Back →
  `closeClipPage`). A Session-view switch calls `closeClipPage()`.
- Header: `CLIP PARAMETERS` (both `moduleName` and `headerOverride`).

## Knob layout (knobs 0–2; 3–7 unlit)

| Knob | Param      | Cell render                                              | Toast value |
|------|------------|---------------------------------------------------------|-------------|
| 0    | SCALE      | enum box; `1X`/`2X` on one line, fractions stacked      | `1/2X`      |
| 1    | LENGTH     | big "preset" font                                       | `16 steps`  |
| 2    | TRANSPOSE  | big "preset" font, signed                               | `+12 ct`    |

`normalizedValue` on each cell drives under-knob LED brightness, as in
Main Params.

### SCALE cell rendering

- Whole multiples (`1X`, `2X`, `4X`) render the number + `X` on one line.
- Fractions (`1/8`, `1/4`, `1/2`, `3/4`, `3/2`) render the numerator on the top
  line, a 1-pixel divider line, then the denominator below — identical to the
  step-parameter page's note-length fraction rendering. (`3/2` and `3/4` both
  stack.)
- Long-enum overlay lists all eight values with the current one highlighted,
  scrollable while knob 0 is held — same component/behaviour as the Key scale
  overlay on Main Params.
- Top toast renders the value with a trailing `X`, e.g. `1/2X`, `3/4X`, `2X`.

## SCALE — engine (new clip-level playback multiplier)

- New field `Clip.scale_num: u8`, `Clip.scale_den: u8` (a rational; default
  `1/1` = `1X`). The eight enum values map to rationals:
  `1/8, 1/4, 1/2, 3/4, 1/1, 3/2, 2/1, 4/1`.
- **Playback timing.** Today each track advances `pos_tick` by exactly 1 per
  master tick and wraps inside `[loop_start, loop_end)` (engine.rs ~609–643).
  Refactor that per-track tick body into a single `step_tick(ti)` function
  (emit notes at `pos_tick`, advance + wrap, automation latch), then drive it
  from a per-track fixed-point accumulator:

  ```
  track.scale_acc += clip.scale_num;        // once per master tick
  while track.scale_acc >= clip.scale_den {
      track.scale_acc -= clip.scale_den;
      step_tick(ti);
  }
  ```

  - `2/1`, `4/1` → multiple `step_tick`s per master tick (faster).
  - `1/2`, `1/4`, `1/8` → one `step_tick` every N master ticks (slower).
  - `3/4`, `3/2` → exact fractional rates with no drift.
- The UI reads playhead position from engine status, so the **loop-view cursor
  and the step-LED playhead scale automatically** — no separate UI timing code.
- Command: `cscl <track> <num> <den>` sets the active clip's scale.
- Recording interaction: recording continues to capture at master-clock
  resolution; scale affects playback only. (Edge cases around recording into a
  scaled clip are out of scope for v1 — note it but don't special-case.)

## LENGTH — engine (reuses existing `length_steps`)

- Big-font cell. Range **1…256 steps** (`MAX_STEPS` = 16 bars), 1-step
  granularity. Default = current clip length.
- New command `clen <track> <steps>` sets the active clip's `length_steps`
  (clamped to `1..=MAX_STEPS - loop_start_steps`). `loop_start_steps` is
  preserved.
- **Step LEDs fully off outside the clip length** — extend the in-clip dimming
  in `src/seq/leds.ts` so steps `>= length_steps` paint Black (not dim).
- Loop button paging already works in 16-step pages; no change needed.
- **"Active bars override custom length":** Loop-mode bar selection and the
  LENGTH knob both write `length_steps`; last-write-wins delivers this for
  free. `dbl` (double) updates the displayed length naturally.
- Toast renders the unit: `16 steps`.

## TRANSPOSE — engine (new, non-destructive)

- New field `Clip.transpose: i8`, default `0`, range **−36…+36** semitones
  (labelled `ct` per spec). Big-font signed cell.
- Command `ctr <track> <semitones>` sets the active clip's transpose.
- **Applied only at note emission** (engine.rs ~609): emitted pitch =
  `clamp(note.pitch + transpose, 0, 127)`. Non-destructive — `Note.pitch` is
  untouched, so changing transpose back to 0 restores the original.
- **Live pads stay untransposed:** pads are sounded directly
  (`shadow_send_midi_to_dsp`), not through the clip, so they are unaffected.
- **Step-hold display shows transposed pitch:** the held-step note readout adds
  the clip transpose so it visually matches the live pads (the UI mirrors the
  clip transpose in `seqState` and applies it to the displayed note name).
- **Live recording un-transposes before storing.** A pad plays raw pitch `P`;
  playback re-adds `+transpose` at emit. To make the recorded note replay
  exactly what the pad played, the recording commit path stores
  `clamp(P − transpose, 0, 127)`, so emit yields `(P − transpose) + transpose
  = P`. Uses the clip's transpose at record time. (Path: `rec_pending` →
  commit in engine.rs.)

## Persistence

- Extend the clip serialization line in `engine/crates/seq-core/src/persist.rs`
  (currently `cl {ti} {ci} {length_steps} {loop_start_steps}`) with three
  optional trailing fields: `scale_num scale_den transpose`. A line missing
  them parses to defaults (`1 1 0`) — backward compatible with existing saves.

## UI state mirror

- `seqState` (`src/seq/state.ts`) mirrors the active clip's `scale` (enum
  index), `length_steps`, and `transpose` for the VM and for the transposed
  step-hold display. Values are pushed to the engine via the commands above on
  knob detents and read back from status where applicable.

## Testing

- **Rust (`cargo test`, seq-core):**
  - scale accumulator: faster (`2X`, `4X`), slower (`1/2X`), and fractional
    (`3/4X`, `3/2X`) rates produce the expected number of `step_tick`s over a
    fixed master-tick count; no drift over a full loop.
  - `clen` clamps and sets `length_steps`; `loop_start` preserved.
  - transpose applied at emit, clamped, non-destructive (revert at 0).
  - recording stores `P − transpose`; round-trips to `P` on playback.
  - persist round-trip incl. defaults for legacy lines.
- **Browser:**
  - `logic.mjs`: Clip Params VM — cells, toasts (`1/2X`, `16 steps`,
    `+12 ct`), overlay open/scroll, normalizedValue.
  - `screenshot.mjs`: new baselines for the page and each cell render (scale
    whole vs stacked fraction, big-font length, signed transpose, overlay).
    Regenerate with `--update`.
  - `perf.mjs`: confirm no fill_rect / IPC / render-time regression.
- **Device (`./scripts/test-seq.sh`):** transport, length LEDs off outside
  clip, scale playback rate, transpose at emit, persistence — when `move.local`
  is reachable.
