# Movy UI Overhaul — Design Spec
**Date:** 2026-06-07

## Overview

A comprehensive redesign of the movy knob-view UI: larger solid-circle knobs, tighter typography, a new compact 5×3 pixel font for enum squares, a mini inline list for long enums, non-inverted rendering everywhere except touched knobs, and auto-generated parameter banks for unsupported instruments.

---

## 1. Layout

Display: 128×64 pixels.

```
y= 0..6   Header (7px): plain white text on black — NO inverted bar
y= 7      1px gap
y= 8..9   Page indicator (2px selected / 1px unselected, all at same top y=8)
y=10..25  Row 0 knobs  (16px tall)
y=26..32  Row 0 labels (7px)
y=33..48  Row 1 knobs  (16px tall)
y=49..55  Row 1 labels (7px)
```

Layout constants (`src/renderer/layout.ts`):
```
HEADER_H = 7
BAR_Y    = 8
BAR_H    = 2   // selected height; unselected draws 1px at same y
ROW0_Y   = 10
LBL0_Y   = 26
ROW1_Y   = 33
LBL1_Y   = 49
KW       = 16  // knob widget size (was 10)
CELL_W   = 32  // unchanged
```

---

## 2. Knob Rendering

### 2a. Regular knob (float / int)

- **Circle:** 16×16 px solid pixel-art circle drawn with Bresenham's algorithm (border only, not filled). Centered in the 32px cell column.
- **Position indicator:** Straight line from center `(7.5, 7.5)` to the circumference at angle `210° + normVal × 300°` (same angular range as current arc). Drawn with Bresenham's line algorithm.

### 2b. Enum knob (short enum, ≤6 options)

- **Shape:** 16×16 solid-border square (1px border, no fill).
- **Content:** Enum value abbreviated to **2 lines × max 3 chars** using the 5×3 pixel font. Lines centered inside the square (14×14 usable area).
- **Shortening:** cascade algorithm — see §4.

### 2c. Long enum knob (enum with >6 options, e.g. Plaits engine)

- **Spans full cell height:** knob area (16px) + label area (7px) = 23px combined. No separate label rendered for this cell.
- **Shows 3 rows** of 7px each (1px top pad + 5px text + 1px bottom pad):
  - Row above: previous option value (white text on black)
  - Row middle: current option value (**inverted**: white rect + black text)
  - Row below: next option value (white text on black)
- Text truncated to fit 28px wide (cell width minus 2px margin each side) using cascade shortening.

---

## 3. Typography

### 3a. Letter spacing

`fontPrint` and `fontWidth` gain an optional `spacing: number` parameter (default `1`). This value is added to each glyph advance: `cx += adv + spacing`. Setting `spacing=1` adds 1px between every glyph. The caller controls it; `spacing=0` means glyphs touch with no gap.

The implementation step must first measure the actual current inter-glyph gap (by inspecting glyph advance vs. glyph width for representative chars) and pick a `spacing` default that achieves exactly 1px rendered gap. This is applied globally.

### 3b. Short name length

`viewmodel.ts` targets **5 chars** (was 4) when auto-generating `shortName`. Uses `autoShorten(label, 5)`.

### 3c. Label cell

- Text **horizontally centered to the knob center** (not left-aligned to cell).
  - `textX = col * CELL_W + CELL_W/2 - fontWidth(text) / 2`
- **Normal:** white text on black, no rectangle fill.
- **Touched:** inverted rectangle (white fill, CELL_W wide) + black text.

---

## 4. Cascade Shortening (`src/renderer/shorten.ts`)

```
autoShorten(label: string, maxChars: number): string
```

1. Uppercase the label. If it fits in `maxChars` → return it.
2. Split into words. If first word alone fits → return first word.
3. Truncate first word to `maxChars`.
4. Acronym of all words (first letter each). If fits → return.
5. Fallback: first `maxChars` chars of the label.

**Enum square shortening** (5×3 font, 2 lines × 3 chars):

```
enumSquareLines(value: string): [string, string]
```

1. Split value into words.
2. Line 1: first word truncated to 3 chars (uppercase).
3. Line 2: second word truncated to 3 chars, or chars 3–5 of single word.
4. Fallback: chars 0–2 / chars 3–5.

---

## 5. 5×3 Pixel Font

- **Source:** `5x3-font.otf` (repo root).
- **Rasterization:** one-time script `scripts/rasterize-5x3.mjs` (uses `opentype.js` — install via `npm install opentype.js` in movy if not present) → outputs `src/font/glyphs5x3.ts` in same format as `glyphs.ts`.
- **Characters:** A–Z, 0–9, common punctuation (same set as existing font).
- **Metrics:** 3px wide per glyph, 5px tall, 4px advance (3 + 1px gap).
- **API:** `fontPrint5x3(x, y, str, color)` and `fontWidth5x3(str)` in `src/font/index5x3.ts`.

---

## 6. Page Indicator

`drawBankBar` in `src/renderer/header.ts`:

- All segments drawn at `y = BAR_Y` (same top edge).
- **Selected segment:** 2px tall (`fill_rect(sx, BAR_Y, sw, 2, 1)`).
- **Unselected segments:** 1px tall (`fill_rect(sx, BAR_Y, sw, 1, 1)`).
- Width calculation unchanged (equal-split with 1px gaps).

---

## 7. Header

`drawInvertedHeader` renamed to `drawHeader`:

- Removes `fill_rect(0, 0, W, HEADER_H, 1)` — no more inverted bar.
- `fontPrint(2, 1, left, 1)` — white text on black.
- `fontPrint(W - fontWidth(right) - 2, 1, right, 1)` — same for right.

**Toast (touched knob):** header renders with inverted rectangle:
- `fill_rect(0, 0, W, HEADER_H, 1)` + black text (color 0). This is the only inverted-header state.

---

## 8. Inversion Rules

| Element | Normal | Touched / Active |
|---|---|---|
| Header background | none (black) | white rectangle |
| Header text | white (1) | black (0) |
| Label cell background | none (black) | white rectangle |
| Label text | white (1) | black (0) |
| Enum overlay current item | white rectangle + black text | n/a |
| Enum overlay other items | white text on black | n/a |
| Long enum current row | white rectangle + black text | n/a |

No other element uses inverted rendering.

---

## 9. Parameter Banks for All Instruments

When `loadModuleConfig(moduleId)` returns `null`:

**`buildAutoConfig(params: KnobParam[]): ModuleConfig`** in `src/model/autoconfig.ts`:

- 8 params per bank (2 rows × 4 cols), filled in order.
- Bank 0 name: `"Main"`.
- Bank 1 name: `"Page 1"`, Bank 2: `"Page 2"`, etc.
- `short` field: `autoShorten(param.label, 5)`.
- `full` field: `param.label`.
- `type`: from `KnobParam.type`.
- Enum options: passed through unchanged from `KnobParam.options`.

Called from `src/model/index.ts` when config is null and `knobParams.length > 0`.

---

## 10. Files Changed

| File | Change |
|---|---|
| `src/renderer/layout.ts` | New constants (KW=16, ROW/LBL positions) |
| `src/renderer/knob.ts` | Bresenham circle + line; enum square 5×3; long enum list |
| `src/renderer/header.ts` | Remove inverted fill; new bank bar logic |
| `src/renderer/label.ts` | Centered text; conditional inversion; skip long-enum cells |
| `src/renderer/knob-view.ts` | Use new drawHeader; pass touched info |
| `src/renderer/shorten.ts` | New file: autoShorten, enumSquareLines |
| `src/font/glyphs5x3.ts` | New file: 5×3 glyph table (generated) |
| `src/font/index5x3.ts` | New file: fontPrint5x3, fontWidth5x3 |
| `src/font/index.ts` | Add spacing param to fontPrint/fontWidth |
| `src/model/viewmodel.ts` | shortName uses autoShorten(5); isLongEnum flag |
| `src/model/autoconfig.ts` | New file: buildAutoConfig |
| `src/model/index.ts` | Call buildAutoConfig when config is null |
| `src/types/viewmodel.ts` | Add isLongEnum to ParamVM |
| `scripts/rasterize-5x3.mjs` | New file: OTF → glyphs5x3.ts |
