# Preset Knob Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the preset knob as a big 1-based integer in a new Nokia 13px bitmap font with no square frame, as a reusable `'preset'` render style.

**Architecture:** Add `'preset'` to the `renderStyle` union so it flows through the existing knob pipeline (`KnobSlot.render` → `KnobParam.renderStyle` → `ParamVM.renderStyle` → `drawKnobWidget`). The auto-detected preset param adopts it; module JSON banks can opt in via `"render": "preset"`. A new big font is rasterized from the repo-root OTF; the duplicated glyph-blit loop is extracted to a shared module.

**Tech Stack:** TypeScript → esbuild (`dist/esm`), Python+Pillow (font rasterizer), node test harnesses (logic.mjs, framebuffer screenshot.mjs).

Spec: `docs/superpowers/specs/2026-06-15-preset-knob-layout-design.md`

---

## File Structure

- Create `src/font/glyphs-big.ts` — generated Nokia 13px glyph table (`export const G`).
- Create `src/font/blit.ts` — shared `glyphRunWidth` / `drawGlyphRun` over a glyph table + lookup.
- Create `src/font/big.ts` — `fontPrintBig` / `fontWidthBig` / `BIG_FONT_HEIGHT`.
- Modify `src/font/index.ts`, `src/font/index5x3.ts` — use `blit.ts` (no pixel change).
- Modify `src/types/param.ts`, `src/types/viewmodel.ts` — add `'preset'` to the unions.
- Modify `src/model/hierarchy.ts:185` — preset param `renderStyle: 'preset'`.
- Modify `src/renderer/knob.ts` — `drawPresetValue` + dispatch `'preset'` first.
- Modify `build/browser.mjs` — add `src/font/big.ts` entry point (for the logic test).
- Modify `browser-test/logic.mjs` — assert big-font metric + preset `renderStyle`.
- Update `browser-test/screenshots/baseline/obxd_preset_page.png` (intended visual change).

---

## Task 1: Rasterize the Nokia big font

**Files:**
- Create: `src/font/glyphs-big.ts` (generated)

- [ ] **Step 1: Generate the glyph table at size 13**

Run (from `movy/`):
```bash
python3 scripts/generate_font.py --font ../nokia-s60v1-13px-bold.otf --size 13 --out src/font/glyphs-big.ts
```
Expected output line:
```
  font=../nokia-s60v1-13px-bold.otf  size=13pt  'A': 9x11px  FONT_HEIGHT=11
```

- [ ] **Step 2: Verify the metric**

Run:
```bash
grep -E "// '0'|// '8'" src/font/glyphs-big.ts
```
Expected: each digit line begins `[9, 0, 9, 11, ...` (advance 9, width 9, height 11). If `'A'` height is not 11, the size is wrong — re-run Step 1 with the size that yields height 11 (size 13 for this font).

- [ ] **Step 3: Commit**

```bash
git add src/font/glyphs-big.ts
git commit -m "feat(font): rasterize Nokia 13px big font (cap-height 11, digits 9x11)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Extract the shared glyph blitter

**Files:**
- Create: `src/font/blit.ts`
- Modify: `src/font/index.ts`, `src/font/index5x3.ts`

- [ ] **Step 1: Create `src/font/blit.ts`**

```ts
/* Shared bitmap-font blitter. A glyph is [advance, yOff, w, h, ...rowBits]
 * with bit0 = leftmost pixel. The font modules (index, index5x3, big) differ
 * only in glyph table, char lookup, fallback advance, and inter-glyph gap, so
 * the measure/blit loop lives here once. Fallback chars advance by
 * `fallbackAdv` and (matching the original loops) carry no inter-glyph gap. */
export type Glyph = number[];
export type GlyphLookup = (cp: number) => Glyph | null;

export function glyphRunWidth(str: string, glyphFor: GlyphLookup, fallbackAdv: number, gap: number): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const g = glyphFor(str.charCodeAt(i));
        w += g ? g[0] : fallbackAdv;
        if (i < str.length - 1) w += gap;
    }
    return w;
}

export function drawGlyphRun(
    x: number, y: number, str: string, color: number,
    glyphFor: GlyphLookup, fallbackAdv: number, gap: number,
): void {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
        const g = glyphFor(str.charCodeAt(i));
        if (!g) { cx += fallbackAdv; continue; }
        const yOff = g[1], w = g[2], h = g[3];
        for (let row = 0; row < h; row++) {
            const bits = g[4 + row];
            let col = 0;
            while (col < w) {
                if (bits & (1 << col)) {
                    const s = col;
                    while (col < w && (bits & (1 << col))) col++;
                    fill_rect(cx + s, y + yOff + row, col - s, 1, color);
                } else { col++; }
            }
        }
        cx += g[0];
        if (i < str.length - 1) cx += gap;
    }
}
```

- [ ] **Step 2: Refactor `src/font/index.ts` to use it (replace entire file)**

```ts
import { G } from './glyphs.js';
import { drawGlyphRun, glyphRunWidth, type Glyph } from './blit.js';

export const FONT_HEIGHT = 5;

const glyphFor = (cp: number): Glyph | null =>
    cp < 0x20 || cp > 0x7E ? null : G[cp - 0x20];

export function fontWidth(str: string, letterGap = -1): number {
    return glyphRunWidth(str, glyphFor, 5, letterGap);
}

export function fontPrint(x: number, y: number, str: string, color: number, letterGap = -1): void {
    drawGlyphRun(x, y, str, color, glyphFor, 5, letterGap);
}
```

- [ ] **Step 3: Refactor `src/font/index5x3.ts` to use it (replace entire file)**

```ts
import { G5 } from './glyphs5x3.js';
import { drawGlyphRun, glyphRunWidth, type Glyph } from './blit.js';

const CHARS5 = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const glyphFor = (cp: number): Glyph | null => {
    const idx = CHARS5.indexOf(String.fromCharCode(cp));
    return idx >= 0 ? G5[idx] : null;
};

export const FONT5_HEIGHT = 5;

export function fontWidth5x3(str: string): number {
    return glyphRunWidth(str, glyphFor, 4, 0);
}

export function fontPrint5x3(x: number, y: number, str: string, color: number): void {
    drawGlyphRun(x, y, str, color, glyphFor, 4, 0);
}
```

- [ ] **Step 4: Build, typecheck, and verify screenshots are byte-identical (the refactor must not change any pixels)**

Run:
```bash
npm run typecheck && npm run build:browser && node browser-test/screenshot.mjs
```
Expected: typecheck clean; `22 passed, 0 failed`. (Any FAIL means the refactor changed rendering — fix before continuing; do NOT run `--update`.)

- [ ] **Step 5: Commit**

```bash
git add src/font/blit.ts src/font/index.ts src/font/index5x3.ts
git commit -m "refactor(font): share glyph blit loop across font modules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Big font module

**Files:**
- Create: `src/font/big.ts`
- Modify: `build/browser.mjs`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Create `src/font/big.ts`**

```ts
import { G as GB } from './glyphs-big.js';
import { drawGlyphRun, glyphRunWidth, type Glyph } from './blit.js';

/* Nokia 13px bitmap font (cap-height 11). Used for the big preset value. */
export const BIG_FONT_HEIGHT = 11;
const BIG_GAP = 1;   // 1px between glyphs (the OTF advances leave no side bearing)

const glyphFor = (cp: number): Glyph | null =>
    cp < 0x20 || cp > 0x7E ? null : GB[cp - 0x20];

export function fontWidthBig(str: string): number {
    return glyphRunWidth(str, glyphFor, 7, BIG_GAP);
}

export function fontPrintBig(x: number, y: number, str: string, color: number): void {
    drawGlyphRun(x, y, str, color, glyphFor, 7, BIG_GAP);
}
```

- [ ] **Step 2: Add `big.ts` as a browser entry point** — in `build/browser.mjs`, add to `entryPoints` (after `src/chain/config.ts`):

```js
        resolve(root, 'src/font/big.ts'),
```

- [ ] **Step 3: Write the failing metric test** — append to `browser-test/logic.mjs` before its final summary (the `_log` of results), as a new block:

```js
/* ── big font (preset value) ───────────────────────────────────────────── */
_log('\nTest: big preset font metrics');
{
    const { fontWidthBig, BIG_FONT_HEIGHT } = await import('../dist/esm/font/big.js');
    eq('big font cap-height = 11', BIG_FONT_HEIGHT, 11);
    // Up to 3 preset digits must fit the 32px knob cell (else small-font fallback).
    eq('3 digits fit the cell', fontWidthBig('888') <= 32, true);
}
```

- [ ] **Step 4: Run to verify it fails**

Run: `node browser-test/logic.mjs 2>&1 | grep -E "big font|3 digits|MODULE_NOT_FOUND"`
Expected: FAIL — `dist/esm/font/big.js` not found (entry not built yet) or, after the next build, the assertions appear.

- [ ] **Step 5: Build and run to verify it passes**

Run:
```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "big font|3 digits"
```
Expected: `big font cap-height = 11 ✓` and `3 digits fit the cell ✓`.

- [ ] **Step 6: Commit**

```bash
git add src/font/big.ts build/browser.mjs browser-test/logic.mjs
git commit -m "feat(font): big font module (fontPrintBig) for preset value

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add the `'preset'` render style and adopt it for the preset param

**Files:**
- Modify: `src/types/param.ts`, `src/types/viewmodel.ts`, `src/model/hierarchy.ts:185`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs` (after the big-font block):

```js
/* ── preset knob render style ──────────────────────────────────────────── */
_log('\nTest: preset param uses the preset render style');
{
    // obxd_like has 8 root knobs (= KNOBS_PER_PAGE), so the preset gets its own
    // page 0; rows[0][0] is the preset param.
    const vm = bootModel(MOCK_SYNTHS.obxd_like).getViewModel();
    eq('preset knob renderStyle = preset', vm.rows[0][0]?.renderStyle, 'preset');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "renderStyle = preset"`
Expected: FAIL — `expected "preset", got "arc"`.

- [ ] **Step 3: Add `'preset'` to the unions** — in `src/types/param.ts`, change two lines:

```ts
    render?:        'arc' | 'hbar' | 'vbar' | 'preset';
```
(in `KnobSlot`), and
```ts
    renderStyle:    'arc' | 'hbar' | 'vbar' | 'preset';
```
(in `KnobParam`).

In `src/types/viewmodel.ts`, change the `ParamVM` field:
```ts
    renderStyle:     'arc' | 'hbar' | 'vbar' | 'preset';
```

- [ ] **Step 4: Make the auto-detected preset param adopt it** — in `src/model/hierarchy.ts`, in the `presetParam` object literal (around line 185), change `renderStyle: 'arc',` to:

```ts
                renderStyle: 'preset',
```

- [ ] **Step 5: Typecheck, build, run to verify it passes**

Run:
```bash
npm run typecheck && npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "renderStyle = preset"
```
Expected: `preset knob renderStyle = preset ✓`; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/types/param.ts src/types/viewmodel.ts src/model/hierarchy.ts browser-test/logic.mjs
git commit -m "feat(seq): add 'preset' render style; preset param adopts it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Render the big preset value (no frame) + update baseline

**Files:**
- Modify: `src/renderer/knob.ts`
- Update: `browser-test/screenshots/baseline/obxd_preset_page.png`

- [ ] **Step 1: Add imports to `src/renderer/knob.ts`** — below the existing imports (currently `layout`, `index5x3`, `shorten`):

```ts
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { fontPrintBig, fontWidthBig, BIG_FONT_HEIGHT } from '../font/big.js';
```

- [ ] **Step 2: Add `drawPresetValue`** — add this function in `src/renderer/knob.ts` (e.g. just above `drawKnobWidget`):

```ts
/* Preset knob: the 1-based preset number rendered big in the Nokia font, no
 * frame, centered across the full cell (using the side margins beyond the
 * 16px box). Falls back to the small font if the number is too wide (>=4
 * digits) so it always fits. */
function drawPresetValue(cellX: number, ky: number, pvm: ParamVM): void {
    const num = pvm.type === 'enum'
        ? pvm.enumIndex + 1
        : Math.round(Number(pvm.displayValue));
    const text = Number.isFinite(num) ? String(num) : '—';
    const bw = fontWidthBig(text);
    if (bw <= CELL_W) {
        fontPrintBig(cellX + Math.floor((CELL_W - bw) / 2),
                     ky + Math.floor((KW - BIG_FONT_HEIGHT) / 2), text, 1);
    } else {
        const sw = fontWidth(text);
        fontPrint(cellX + Math.floor((CELL_W - sw) / 2),
                  ky + Math.floor((KW - FONT_HEIGHT) / 2), text, 1);
    }
}
```

- [ ] **Step 3: Dispatch `'preset'` first in `drawKnobWidget`** — change the start of the `if` chain so it reads:

```ts
export function drawKnobWidget(col: number, rowY: number, pvm: ParamVM): void {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY;
    if (pvm.renderStyle === 'preset') {
        drawPresetValue(col * CELL_W, ky, pvm);
    } else if (pvm.type === 'file') {
        drawEnumSquare(kx, ky, [pvm.displayValue], 0);
    } else if (pvm.type === 'enum') {
        drawEnumSquare(kx, ky, pvm.options, pvm.enumIndex);
    } else if (pvm.renderStyle === 'hbar') {
        drawHorzBar(kx, ky, pvm.normalizedValue);
    } else if (pvm.renderStyle === 'vbar') {
        drawVertBar(kx, ky, pvm.normalizedValue);
    } else {
        drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build:browser`
Expected: clean.

- [ ] **Step 5: Inspect the changed render, then update the baseline**

Run (shows the diff count for the preset page; it WILL differ — the preset now renders a big "1" with no frame):
```bash
node browser-test/screenshot.mjs 2>&1 | grep -E "obxd_preset_page|passed,"
```
Expected: `obxd_preset_page ... FAIL (... px differ)` (intended). Then update only the baselines that changed and re-run:
```bash
node browser-test/screenshot.mjs --update >/dev/null 2>&1
node browser-test/screenshot.mjs 2>&1 | tail -1
```
Expected after update: `22 passed, 0 failed`.

Sanity-check the updated baseline visually if possible (open `browser-test/screenshots/baseline/obxd_preset_page.png`): a large centered `1`, no square frame. Only `obxd_preset_page.png` should change in git status — confirm:
```bash
git status --short browser-test/screenshots/baseline/
```
Expected: only `obxd_preset_page.png` modified.

- [ ] **Step 6: Run the full local suite**

Run:
```bash
npm test
```
Expected: logic, app-loop, `22 passed, 0 failed` screenshots, and perf all pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/knob.ts browser-test/screenshots/baseline/obxd_preset_page.png
git commit -m "feat(ui): render preset knob as a big frameless integer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** font generation + verified metric (Task 1); `big.ts` + `BIG_FONT_HEIGHT` (Task 3); shared `blit.ts` refactor (Task 2); `'preset'` renderStyle in all three unions + hierarchy adoption + `KnobSlot.render` override (Task 4); `drawPresetValue` big frameless 1-based integer with small-font fallback + dispatch-first (Task 5); screenshot baseline update + logic tests (Tasks 3–5). The spec's optional separate "inline preset screenshot" is intentionally omitted: the inline and dedicated-page presets both go through `drawPresetValue` with identical cell geometry, so `obxd_preset_page` already exercises the pixels.
- **Type consistency:** `renderStyle` union value `'preset'` is identical across `param.ts` (KnobSlot.render, KnobParam.renderStyle), `viewmodel.ts` (ParamVM.renderStyle); `fontPrintBig`/`fontWidthBig`/`BIG_FONT_HEIGHT`, `drawGlyphRun`/`glyphRunWidth`/`Glyph`, and `drawPresetValue(cellX, ky, pvm)` are used consistently.
- **No placeholders:** every code/command step is concrete.
