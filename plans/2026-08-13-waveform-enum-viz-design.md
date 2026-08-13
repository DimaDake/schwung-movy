# Waveform enum visualization (single knob) — design

**Status:** approved for planning
**Date:** 2026-08-13

## Context

Movy already draws a waveform graphic for LFOs, but it spans **two** knob cells
(Shape + one partner) and only triggers inside a detected LFO group
(`model/lfo-viz.ts`, `renderer/lfo-wave.ts`). Plenty of modules expose a plain
oscillator/modulator waveform enum on a **single** knob — `303:waveform`,
`forge:cv_wave`, `chordism:wave_1..4` — and those render today as a framed
square containing abbreviated text ("SQUA/RE"). A silhouette communicates the
shape faster than the abbreviation does.

This adds a **single-cell** waveform render style for those enums, plus matching
glyphs in the full-screen enum overlay.

## Scope (measured against the 78-module dump)

Scanned every module in `docs/module-dump/` through the real model, per page,
excluding params the LFO viz already claims. 58 shape enums exist; 37 are
LFO-owned; 21 are free.

The qualifying rule is **strict**: an enum earns the viz only when *every*
option maps to a glyph **and** no two options share one. That excludes the cases
where a silhouette would lie:

| Excluded | Why |
|---|---|
| `helm:osc_1/osc_2/sub_waveform` | `3/4/8 Step` and `3/5/9 Pyramid` collapse to 2 glyphs. `lfo-shapes.ts:36` already documents that step counts are unreadable at 64px; a 32px cell is worse. |
| `osirus:osc1/osc2_wave_select` | 62 of 64 options are "Wave N" wavetables — one identical squiggle. |
| `chordism:vib_stray`, `freak:random_mode`, `hush1:vca_mode` | Not waveform pickers (LFO/Random, Gate/Envelope). The strict rule rejects them for free. |

**Qualifying: 12 params across 8 modules.**

Work today with no new art (4):

| Module | Param | Options |
|---|---|---|
| `303` | `waveform` | Saw, Square |
| `forge` | `cv_wave` | Sine, Tri, Saw, Square, Noise |
| `osirus` | `sub_osc_shape` | Square, Triangle |
| `spectra` | `motion_shape` | Sine, Triangle, Square, S&H |

Unlocked by the new glyphs/aliases below (8):

| Module | Param | Needs |
|---|---|---|
| `chordism` | `wave_1`…`wave_4` | `Off`, `Pulse Tr`, `Wavetable` |
| `aphex` | `v1_wave` | `PW-Square` |
| `aphex` | `v2_wave` | `Ring`, and `Pulse` split from `Square` |
| `war_bells` | `mot_shape` | aliases only: `Ramp`→saw-up, `Rand`→s&h |
| `signal` | `mod_shape` | `Random` remapped 4→5 so it stops colliding with `S&H` |

## Design

### Glyph set — `model/lfo-shapes.ts` + `renderer/lfo-wave.ts`

New shape ids **13–19** as `case` arms in `shapeSample()`, so LFO shape lists
get them for free: `pulse` (25% duty), `pw-square` (narrow), `ring`,
`wavetable`, `warp`, `sink`, `off` (flat line at zero).

New `NAMED` entries and the two pure aliases (`ramp`, `rand`).

**One behaviour change to existing rendering:** `random` moves 4 → 5
(smooth-random). Today `Random` and `S&H` both draw as the stepped shape; a list
containing both means the smooth one. Prototyped and confirmed legible. This
moves existing LFO screenshot baselines.

### Detection — `model/enum-class.ts` + new `model/wave-viz.ts`

`EnumClass` gains `uniqueShape: boolean` — every option maps *and* all ids are
distinct. Computed inside the existing `enumClassOf` cache, so the distinctness
scan runs once per module load, never per frame (this is exactly the per-frame
cost `enum-class.ts` was written to eliminate; Osirus's 64-entry list is scanned
once).

New small `model/wave-viz.ts`: given a page's params and the planned layout,
return the indices that get the wave style — enum, `uniqueShape`, not already
claimed by an envelope/LFO/filter line, and no explicit `render:` override from
the module's movy config (config stays authoritative, as everywhere else).

**No `page-layout.ts` changes.** Envelope/LFO/filter groups rearrange cells and
claim whole lines; a single-knob waveform is a per-cell render style, so it
needs none of that machinery.

### Cell rendering — `renderer/knob.ts`

`renderStyle: 'wave'` on the `ParamVM`, carrying the resolved shape id.
`drawWaveSquare(kx, ky, shapeId)` keeps `drawEnumSquare`'s 1px frame — the frame
is what marks the cell as an option list rather than a continuous arc, and
distinguishes it from the frameless 2-cell LFO graphic — and fills the ~14px
interior with the silhouette instead of the two text lines.

Interaction is unchanged: turning steps options, long-press opens the overlay.

### Overlay rendering — `renderer/overlay.ts`

When the overlay's param has `uniqueShape`, each visible row draws a **13×5**
glyph at `ovX+2` and the name shifts to `ovX+16`; otherwise the overlay is
byte-identical to today. Only 6 rows are ever visible (`ovH` 47 / `ROW_H` 7), so
cost is bounded regardless of list length. Shape ids resolve once on open.

Settled by prototyping against the real 128×64 framebuffer:

- **13×5 at 1 cycle.** At 2 cycles, sine and triangle became the same squiggle
  at 5px. At 1 cycle the rounded shoulders vs straight ramps separate them.
- **7px-tall glyphs fail** — they bleed into neighbouring rows and get clipped
  by the selection bar.
- **The selected row draws its glyph in colour 0**, inverting with the text.
  Drawing white-on-white and then inverting the gutter erases the glyph.
- Text keeps 78px, so `WAVETABLE` fits.

### Shared drawing — `renderer/lfo-wave.ts`

One new `drawWave(x, y, w, h, shapeId, cycles, colour)` serves both the cell
glyph and the overlay row, so there is a single plain-silhouette path.
Each column is one pixel plus a **vertical connector** spanning the gap to the
previous column — square and pulse edges must be straight risers. The
Bresenham diagonals `drawLfoWave` uses read as slanted steps at 5px.

`drawLfoWave` keeps its own richer renderer (phase, deform, amplitude,
baseline, retrigger dot) and is not modified.

## Testing

- `screenshot.mjs` — new scenes for the cell style (`303`, `forge`, `chordism`)
  and the overlay with glyphs (`chordism` incl. the `Off` flat line, `signal`
  for the S&H/Random split, `aphex` for `Pulse` vs `Square` risers).
  Existing LFO baselines move because of the `random` 4→5 remap; regenerate
  with `--update` and eyeball the diff.
- `logic.mjs` — `uniqueShape` is true for exactly the 12 qualifying params and
  false for `helm`, `osirus:osc*_wave_select`, `hush1:vca_mode`. This is the
  assertion with teeth: it fails if the strict rule is loosened.
- `dump-replay.mjs` — the render-style change lands in the per-module snapshot
  across all 78 modules; run `--update` after reviewing.
- `perf.mjs` — guard the overlay's fill_rect count (6 glyphs × ~13 columns).
- Device: `./scripts/test.sh` once local suites pass.

## Docs

`MANUAL.md` — the waveform cell and the overlay glyphs, with screenshots from
the new baselines via `scripts/make-doc-assets.mjs`. Not a `README.md` headline
feature.

## Out of scope

- Making `drawLfoWave` use vertical risers (at 62px the diagonal is invisible).
- Any attempt to render Helm's step counts or Osirus's wavetables.
