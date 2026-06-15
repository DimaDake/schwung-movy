# Preset knob layout — design

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Problem

The preset selector knob renders identically to an enum knob: a 16×16 square
frame with the value drawn inside in the small 5×3 font (`drawEnumSquare` in
`renderer/knob.ts`). We want the preset knob to stand out — a **bigger value in
a new font, with no square frame**.

## Goal

Give the preset knob a distinct in-cell layout: the preset number rendered as a
**big integer** (new Nokia bitmap font), centered, **no frame**. Make this an
opt-in render style so module configs can also apply it to a custom-layout knob.

## Non-goals

- No change to preset *selection* behavior or the full-screen enum overlay
  (touch-to-open list) — only the in-cell widget render changes.
- No change to other knob styles (arc/hbar/vbar/enum/file).
- Preset *names* are not rendered big; the value shown is an integer.

## Decisions (from clarification)

- The big value is **just an integer** — the **1-based** preset number (as
  today's numbering).
- Applies in **both** placements (dedicated Preset page and the inline preset
  knob in a full Main bank) **and** is available to module configs as a
  custom-layout override.
- Overflow: integers are short. Use the full 32px cell (the side margins beyond
  the 16px box). If it still doesn't fit (≥4 digits), fall back to the small
  font.
- The shared font blit loop may be refactored.

## Approach

Add **`'preset'` as a new `renderStyle`**, alongside `arc`/`hbar`/`vbar`. It
flows through the existing pipeline unchanged:
`KnobSlot.render` (config) → `KnobParam.renderStyle` (hierarchy) →
`ParamVM.renderStyle` (viewmodel) → `drawKnobWidget` (renderer). Module JSON
banks get the override for free via `"render": "preset"`.

The auto-detected preset param keeps `type:'enum'` (selection + overlay still
work) but its `renderStyle` becomes `'preset'`, so only the widget render
changes.

Rejected: a new `type:'preset'` — invasive (touches value formatting, enum
overlay, every `type` switch) for no benefit, since only rendering changes.

## Components

### 1. New font from `nokia-s60v1-13px-bold.otf`

- Rasterize with the existing `scripts/generate_font.py` (Pillow present),
  pointed at the repo-root OTF (`../nokia-s60v1-13px-bold.otf`), into a new
  `src/font/glyphs-big.ts` (same `[advance, yOff, w, h, ...rowBytes]` format,
  full printable ASCII 0x20–0x7E so it covers letters + digits and is reusable).
- **Verified metrics** (ran the rasterizer across sizes): **size 13** gives
  cap-height **11** (`'A'` 9×11) and **digits 9×11**. (The requested w:7 was an
  estimate; actual digit width is 9.) Three digits ≈ 27px fit the 32px cell.
- New module `src/font/big.ts` exporting `fontPrintBig`, `fontWidthBig`,
  `BIG_FONT_HEIGHT` (= 11).
- **Refactor:** extract the glyph blit loop (currently duplicated in `index.ts`
  and `index5x3.ts`) into `src/font/blit.ts` as a shared
  `drawGlyphRun(x, y, str, color, table, lookup, fallbackAdv, gap)`; all three
  font modules call it. Screenshot tests confirm `index.ts`/`index5x3.ts`
  render identically after the refactor.

### 2. `drawPresetValue` (in `renderer/knob.ts`)

- Renders the preset value as a big integer with `fontPrintBig`, no frame,
  centered in the full `CELL_W` (32px) cell, vertically centered in the knob row
  (`ROW0_Y`-relative, the 16px-tall widget band).
- Value: enum-typed preset → `enumIndex + 1` (1-based); an int-typed preset knob
  → the rounded current value.
- If `fontWidthBig(text) > CELL_W`, fall back to the existing small `fontPrint`
  so the value always fits.

### 3. Dispatch (`drawKnobWidget`)

Check `pvm.renderStyle === 'preset'` **first**, before the `type === 'file'` /
`type === 'enum'` branches, so a preset param (enum-typed, `renderStyle:'preset'`)
renders as the big integer rather than the enum square.

### 4. Wiring

- `src/types/param.ts`: add `'preset'` to `KnobSlot.render` and
  `KnobParam.renderStyle`.
- `src/types/viewmodel.ts`: add `'preset'` to `ParamVM.renderStyle`.
- `src/model/hierarchy.ts`: the auto-detected preset param sets
  `renderStyle: 'preset'` (was `'arc'`). `inferRenderStyle` is untouched.
- `src/model/store.ts`: the `arcScale` check (`renderStyle === 'arc'`) is
  unaffected — a `'preset'` knob uses scale 1 like enum/bar styles.

## Testing

- **Font metric** verified at generation time (script prints `'A'` dims; size 13
  → 9×11).
- **Screenshot**: add/regenerate baselines for the dedicated Preset page
  (`obxd_preset_page`) and add an inline preset-knob case; the node framebuffer
  harness makes this cheap and exact.
- **Logic**: assert the auto-detected preset param carries
  `renderStyle === 'preset'` (and a module config `render:'preset'` propagates to
  `ParamVM.renderStyle`).
- `npm test` (logic, app-loop, screenshot, perf) green; `typecheck` clean.

## Risks / notes

- The blit refactor touches the two existing fonts; screenshot regression (now
  pure-node, ~0.15s) is the guard — run `--update` only if an intended pixel
  change is confirmed.
- ≥4-digit preset numbers fall back to the small font (acceptable; presets are
  typically 1–128).
- `glyphs-big.ts` is full ASCII (~95 glyphs at 11 rows) — larger than the 5×3
  table but still small; it bundles into `ui.js` like the others.
