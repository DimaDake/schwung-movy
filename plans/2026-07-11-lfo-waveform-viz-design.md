# LFO waveform visualization group — Design

Date: 2026-07-11

Reorder the track LFO params and add a **reusable LFO waveform visualization**
that draws the LFO shape across two knob cells (Shape + Phase), analogous to the
existing envelope group. Usable by the track LFO and by synth custom layouts.

## Param reorder (track LFO)

Positions 0–7 become:
- **Line 1:** Rate (0), Sync (1), Mode (2), Target (3)
- **Line 2:** Shape (4), Phase (5), Retrigger (6), Depth (7)

The model's position→param mapping, `buildCells` order, and overlay-openers
update. **Shape stops using an overlay** — it becomes a cycling enum (turn to
morph the waveform; the viz shows the current shape). Target keeps its overlay
(now at pos 3). Depth/Rate/Phase/Retrigger behave as before.

## Reusable viz group (mirrors the envelope group)

New role marker `lfo: 'shape' | 'phase' | 'mode' | 'retrig'` on `KnobSlot` /
`KnobParam` (parallel to `env: a|d|s|r`). New `src/model/lfo-viz.ts`:
`detectLfoViz(params)` scans a page's KnobParams for `lfo` markers and returns
groups of **page-relative indices** `{ shape, phase, mode|null, retrig|null }`.
A group requires **shape + phase**; mode + retrig are optional. Depth is NOT
part of the viz (stays a separate knob).

Synths opt in by adding `lfo` markers to slots in their JSON layout. The track
LFO model emits the viz VM directly (no detection needed there).

## ViewModel carrier

Add `lfoViz?: LfoVizVM[]` to `ViewModel`:
```ts
interface LfoVizVM {
    line:      0 | 1;
    startCol:  number;   // graphic spans startCol..startCol+1
    shape:     number;   // 0..5 (LFO_SHAPES order)
    phase:     number;   // 0..1
    mode:      number;   // 0 = unipolar, 1 = bipolar
    retrigger: number;   // 0/1
}
```
`buildViewModel` resolves each detected group to `(line, startCol)` via the
placed cell layout (identity for config synths without an envelope), requires
**shape & phase adjacent on the same line**, and reads the param *values*
(shape enum index, phase 0..1, mode 0/1, retrig 0/1) — defaults: mode → 1
(centered) when absent, retrigger → 0 when absent.

## Renderer

New `src/renderer/lfo-wave.ts` `drawLfoWave(rowY, group)` + a `drawDottedH`
primitive. `drawKnobRow` gains an optional per-line `lfoViz` group: it draws the
waveform across `startCol..startCol+1` (2 cells = 64px) **in place of those two
knob widgets**, while still drawing the other cells' knob widgets and all four
label cells (SHAPE / PHASE labels + touch values unchanged). Same override
mechanism as `env`/`drawEnvelope`.

`drawLfoWave` semantics:
- **Waveform:** ~2 cycles across the 64px, sampled from the shape and offset
  horizontally by `phase`. Fixed amplitude. Shapes: sine/tri/saw/square exact;
  s&h = deterministic stepped pattern; swishy = deterministic smooth walk (fixed
  patterns so screenshots are stable). Unknown shape index → sine.
- **Mode:** bipolar (1) → dotted baseline centered vertically, wave swings ±;
  unipolar (0) → dotted baseline at the bottom, wave `(v+1)/2` rides above it.
- **Retrigger on:** a bold 2×2 dot at the waveform's start point.

## Files

- New: `src/model/lfo-viz.ts` (detection), `src/renderer/lfo-wave.ts` (draw + samplers).
- Edit: `src/types/param.ts` (+`lfo` role on KnobSlot/KnobParam),
  `src/types/viewmodel.ts` (+`LfoVizVM`, `lfoViz?`),
  `src/renderer/primitives.ts` (+`drawDottedH`),
  `src/model/hierarchy.ts` (propagate `lfo` marker in the config path),
  `src/model/viewmodel.ts` (detect + emit `lfoViz`),
  `src/renderer/label.ts` (drawKnobRow lfoViz param + skip viz cells),
  `src/renderer/knob-view.ts` / `chain-view.ts` (pass per-line lfoViz),
  `src/lfo/model.ts` (reorder, shape cycles, emit `lfoViz`).

## Testing

- logic: `detectLfoViz` (finds group; requires shape+phase; optional mode/retrig;
  ignores incomplete groups). Track LFO: new position order, `lfoViz` VM values,
  shape cycles without overlay, target overlay now at pos 3.
- screenshot: regenerate the 4 LFO baselines for the new layout; drop the now
  obsolete `lfo_shape_overlay`; add viz scenes (bipolar sine, unipolar saw,
  retrigger-on, phase-offset) + one mock-synth scene with `lfo` markers proving
  reuse.
- app-loop: nav unchanged (still passes).

## Non-goals

- Depth does not scale the viz amplitude (separate knob).
- One viz group per line.
- No engine / C changes.
