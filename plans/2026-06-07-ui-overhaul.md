# Movy UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the movy knob-view UI: 16px solid-circle knobs, 1px letter spacing, 5×3 font for enum squares, inline mini-list for long enums, non-inverted header/labels (except touched), and auto-named banks for unsupported instruments.

**Architecture:** All changes stay within the existing `src/renderer/` and `src/model/` split — renderers are pure display functions, model owns state. One new utility (`shorten.ts`), one new font module (`font/index5x3.ts` + `font/glyphs5x3.ts`), and a one-time rasterization script. The 5×3 font is rasterized from `5x3-font.otf` at the repo root via a Node.js script.

**Tech Stack:** TypeScript, esbuild (device bundle), Puppeteer screenshot tests. `opentype.js` needed only for the rasterization script (not bundled into device build).

**Spec:** `movy/docs/superpowers/specs/2026-06-07-ui-overhaul-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/renderer/shorten.ts` | autoShorten, enumSquareLines |
| Create | `scripts/rasterize-5x3.mjs` | one-time: OTF → glyphs5x3.ts |
| Create | `src/font/glyphs5x3.ts` | 5×3 glyph table (generated) |
| Create | `src/font/index5x3.ts` | fontPrint5x3, fontWidth5x3 |
| Modify | `src/font/index.ts` | add letterGap param to fontPrint/fontWidth |
| Modify | `src/renderer/layout.ts` | new layout constants (KW=16, ROW/LBL positions) |
| Modify | `src/types/viewmodel.ts` | add isLongEnum, options, enumIndex to ParamVM |
| Modify | `src/model/viewmodel.ts` | autoShorten for shortName, isLongEnum, fix bank naming |
| Modify | `src/renderer/knob.ts` | Bresenham circle+line, enum square, long-enum list |
| Modify | `src/renderer/header.ts` | remove inverted fill, new bank bar logic |
| Modify | `src/renderer/label.ts` | centered text, conditional inversion, skip long-enum cells |
| Modify | `src/renderer/knob-view.ts` | call drawHeader instead of drawInvertedHeader |
| Modify | `src/renderer/overlay.ts` | call drawHeader(..., true) instead of drawInvertedHeader |

---

## Task 1: Cascade shortening utility

**Files:**
- Create: `src/renderer/shorten.ts`

- [ ] **Step 1: Create shorten.ts**

```typescript
export function autoShorten(label: string, maxChars: number): string {
    const up = label.toUpperCase().replace(/_/g, ' ').trim();
    if (up.length <= maxChars) return up;
    const words = up.split(/\s+/);
    if (words[0].length <= maxChars) return words[0];
    const acronym = words.map(w => w[0]).join('');
    if (acronym.length <= maxChars) return acronym;
    return up.replace(/\s+/g, '').substring(0, maxChars);
}

export function enumSquareLines(value: string): [string, string] {
    const parts = value.toUpperCase().replace(/[_\-]/g, ' ').trim().split(/\s+/);
    if (parts.length >= 2) {
        return [parts[0].substring(0, 3), parts[1].substring(0, 3)];
    }
    const w = parts[0];
    return [w.substring(0, 3), w.substring(3, 6)];
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/renderer/shorten.ts
git commit -m "feat: add cascade shortening utility

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Write 5×3 font rasterization script

**Files:**
- Create: `scripts/rasterize-5x3.mjs`

The script opens `5x3-font.otf` (repo root), rasterizes A–Z, 0–9 and punctuation into 3×5 bitmaps using ray-casting, and writes `src/font/glyphs5x3.ts`.

- [ ] **Step 1: Install opentype.js in movy**

```bash
cd movy && npm install opentype.js --save-dev
```

- [ ] **Step 2: Create scripts/rasterize-5x3.mjs**

```javascript
#!/usr/bin/env node
// Rasterizes chars from 5x3-font.otf → src/font/glyphs5x3.ts
// Glyph format (same as glyphs.ts): [advance, yOff, w, h, ...rowBytes]  bit0=leftmost
import { loadSync } from 'opentype.js';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const font  = loadSync(resolve(__dir, '../5x3-font.otf'));

const CHARS    = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TARGET_H = 5;
const TARGET_W = 3;

function isInsidePath(path, px, py) {
    let inside = false;
    let curX = 0, curY = 0, startX = 0, startY = 0;
    for (const cmd of path.commands) {
        if (cmd.type === 'M') {
            startX = curX = cmd.x; startY = curY = cmd.y;
        } else if (cmd.type === 'L') {
            inside ^= crossesRay(curX, curY, cmd.x, cmd.y, px, py);
            curX = cmd.x; curY = cmd.y;
        } else if (cmd.type === 'Q') {
            inside ^= quadCrossesRay(curX, curY, cmd.x1, cmd.y1, cmd.x, cmd.y, px, py);
            curX = cmd.x; curY = cmd.y;
        } else if (cmd.type === 'C') {
            const mx = (cmd.x1+cmd.x2)/2, my = (cmd.y1+cmd.y2)/2;
            inside ^= quadCrossesRay(curX, curY, cmd.x1, cmd.y1, mx, my, px, py);
            inside ^= quadCrossesRay(mx, my, cmd.x2, cmd.y2, cmd.x, cmd.y, px, py);
            curX = cmd.x; curY = cmd.y;
        } else if (cmd.type === 'Z') {
            inside ^= crossesRay(curX, curY, startX, startY, px, py);
            curX = startX; curY = startY;
        }
    }
    return inside;
}

function crossesRay(x0, y0, x1, y1, px, py) {
    if ((y0 <= py) === (y1 <= py)) return false;
    return x0 + (py - y0) / (y1 - y0) * (x1 - x0) > px;
}

function quadCrossesRay(x0, y0, x1, y1, x2, y2, px, py) {
    const a = y0 - 2*y1 + y2, b = 2*(y1 - y0), c = y0 - py;
    const roots = [];
    if (Math.abs(a) < 1e-10) {
        if (Math.abs(b) > 1e-10) roots.push(-c / b);
    } else {
        const disc = b*b - 4*a*c;
        if (disc >= 0) {
            const sq = Math.sqrt(disc);
            roots.push((-b - sq) / (2*a), (-b + sq) / (2*a));
        }
    }
    let crossings = 0;
    for (const t of roots) {
        if (t >= 0 && t < 1) {
            const bx = (1-t)*(1-t)*x0 + 2*(1-t)*t*x1 + t*t*x2;
            if (bx > px) crossings++;
        }
    }
    return crossings % 2 === 1;
}

function rasterizeChar(char) {
    const g = font.charToGlyph(char);
    if (!g || !g.path || g.path.commands.length === 0) {
        return { entry: [4, 0, 0, 0], preview: '   '.repeat(TARGET_H) };
    }
    const bb = g.getBoundingBox();
    const rangeX = bb.x2 - bb.x1 || 1;
    const rangeY = bb.y2 - bb.y1 || 1;
    const scaleX = (TARGET_W - 0.0001) / rangeX;
    const scaleY = (TARGET_H - 0.0001) / rangeY;
    const scale  = Math.min(scaleX, scaleY);

    const rows = [];
    let preview = '';
    for (let row = 0; row < TARGET_H; row++) {
        let bits = 0;
        for (let col = 0; col < TARGET_W; col++) {
            const fx = bb.x1 + (col + 0.5) / scale;
            const fy = bb.y2 - (row + 0.5) / scale;  // flip Y axis
            if (isInsidePath(g.path, fx, fy)) { bits |= (1 << col); preview += '#'; }
            else preview += '.';
        }
        preview += '\n';
        rows.push(bits);
    }
    const advPx = Math.max(TARGET_W + 1, Math.round(g.advanceWidth * scale));
    return { entry: [advPx, 0, TARGET_W, TARGET_H, ...rows], preview };
}

const entries = [];
for (const ch of CHARS) {
    const { entry, preview } = rasterizeChar(ch);
    entries.push({ ch, entry });
    process.stdout.write(`\n'${ch === ' ' ? 'SPC' : ch}' (${ch.charCodeAt(0)}):\n${preview}`);
}

const lines = entries.map(({ ch, entry }) =>
    `  ${JSON.stringify(entry)},// '${ch === "'" ? "\\'" : ch}'`
).join('\n');

const out = `// 5×3 pixel font — rasterised from 5x3-font.otf
// Glyph format: [advance, yOff, w, h, ...rowBytes]  bit0=leftmost pixel
// Chars: ' !"\\\'()+,-./:0123456789A-Z
export const G5: number[][] = [\n${lines}\n];\n`;

const outPath = resolve(__dir, '../src/font/glyphs5x3.ts');
writeFileSync(outPath, out, 'utf8');
console.log(`\nWrote ${entries.length} glyphs to ${outPath}`);
```

- [ ] **Step 3: Commit**

```bash
cd movy && git add scripts/rasterize-5x3.mjs package.json package-lock.json
git commit -m "feat: add 5x3 font rasterization script

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Run rasterization script, verify, fix if needed

**Files:**
- Create (generated): `src/font/glyphs5x3.ts`

- [ ] **Step 1: Run the script**

```bash
cd movy && node scripts/rasterize-5x3.mjs
```

The console will print a 3×5 ASCII preview of every character. Inspect the output:
- Letters should look like recognizable pixel-art letters
- Numbers should be recognizable
- If a character looks wrong (all dots or garbled), it means the scale or Y-flip needs tweaking

Common issues:
- All empty (`.....`): the font uses a different coordinate system; try removing the `Math.min(scaleX, scaleY)` and using a fixed scale based on font's `unitsPerEm` divided by 5.
- Mirror/flipped: try `fy = bb.y1 + (row + 0.5) / scale` (no flip).

- [ ] **Step 2: Verify output file exists**

```bash
ls -la movy/src/font/glyphs5x3.ts && head -20 movy/src/font/glyphs5x3.ts
```

Expected: file with `export const G5: number[][] = [` and numeric arrays.

- [ ] **Step 3: Manually correct any bad glyphs (if needed)**

Open `src/font/glyphs5x3.ts`. For any glyph that looks wrong in the console preview, hand-edit its row bytes. The bit encoding is `bit0=leftmost pixel`:

Example 'A' at 3×5:
```
.#.  → 010 → bit1 set → 2
###  → 111 → bits 0,1,2 set → 7
#.#  → 101 → bits 0,2 set → 5
#.#  → 5
#.#  → 5
```
Entry: `[4, 0, 3, 5, 2, 7, 5, 5, 5]`

- [ ] **Step 4: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors (glyphs5x3.ts is just a data file, typechecks trivially).

- [ ] **Step 5: Commit**

```bash
cd movy && git add src/font/glyphs5x3.ts
git commit -m "feat: add rasterised 5x3 glyph table

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 5×3 font API

**Files:**
- Create: `src/font/index5x3.ts`

The 5×3 font chars start at space (0x20) but only cover the subset defined in the G5 array. The CHARS constant in the rasterize script defines the order.

- [ ] **Step 1: Create src/font/index5x3.ts**

The char-to-index mapping must match the order of chars in the rasterize script's `CHARS` constant: `' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'`.

```typescript
import { G5 } from './glyphs5x3.js';

const CHARS5 = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function glyphIndex(cp: number): number {
    const i = CHARS5.indexOf(String.fromCharCode(cp));
    return i >= 0 ? i : -1;
}

export const FONT5_HEIGHT = 5;

export function fontWidth5x3(str: string): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const idx = glyphIndex(str.charCodeAt(i));
        w += idx >= 0 ? G5[idx][0] : 4;
        if (i < str.length - 1) w -= 1; // 1px inter-glyph gap
    }
    return w;
}

export function fontPrint5x3(x: number, y: number, str: string, color: number): void {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
        const idx = glyphIndex(str.charCodeAt(i));
        if (idx < 0) { cx += 4; continue; }
        const g = G5[idx];
        const adv = g[0], yOff = g[1], w = g[2], h = g[3];
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
        cx += adv;
        if (i < str.length - 1) cx -= 1;
    }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/font/index5x3.ts
git commit -m "feat: add 5x3 font rendering API

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Add letter spacing to the main font

**Files:**
- Modify: `src/font/index.ts`

The current font has 1px of padding on each side of most glyphs, making the visual gap between chars 2px. Adding `letterGap = -1` removes 1px of advance between chars, giving a 1px visual gap.

- [ ] **Step 1: Replace src/font/index.ts**

```typescript
import { G } from './glyphs.js';

export const FONT_HEIGHT = 5;

export function fontWidth(str: string, letterGap = -1): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        w += cp < 0x20 || cp > 0x7E ? 5 : G[cp - 0x20][0];
        if (i < str.length - 1) w += letterGap;
    }
    return w;
}

export function fontPrint(x: number, y: number, str: string, color: number, letterGap = -1): void {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp < 0x20 || cp > 0x7E) { cx += 5; continue; }
        const g = G[cp - 0x20];
        const adv = g[0], yOff = g[1], w = g[2], h = g[3];
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
        cx += adv;
        if (i < str.length - 1) cx += letterGap;
    }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Build browser bundle and do a quick sanity check**

```bash
cd movy && npm run build:browser
```

Expected: success, no errors.

- [ ] **Step 4: Commit**

```bash
cd movy && git add src/font/index.ts
git commit -m "feat: add letterGap param to fontPrint/fontWidth (default -1px)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Update layout constants

**Files:**
- Modify: `src/renderer/layout.ts`

- [ ] **Step 1: Replace src/renderer/layout.ts**

```typescript
export const W        = 128;
export const HEADER_H = 7;
export const BAR_Y    = 8;
export const BAR_H    = 2;   // selected bar height; unselected uses 1px at same top
export const ROW0_Y   = 10;
export const LBL0_Y   = 26;
export const ROW1_Y   = 33;
export const LBL1_Y   = 49;
export const CELL_W   = 32;
export const LBL_H    = 7;
export const KW       = 16;
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/renderer/layout.ts
git commit -m "feat: update layout constants for 16px knobs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Add isLongEnum, options, enumIndex to ParamVM

**Files:**
- Modify: `src/types/viewmodel.ts`

- [ ] **Step 1: Replace src/types/viewmodel.ts**

```typescript
export interface ParamVM {
    shortName:       string;
    fullName:        string;
    type:            string;
    normalizedValue: number;
    displayValue:    string;
    touched:         boolean;
    isLongEnum:      boolean;
    options:         string[] | null;
    enumIndex:       number;
}

export interface ToastState {
    fullName: string;
    value:    string;
}

export interface OverlayState {
    slot:     number;
    options:  string[];
    selected: number;
}

export interface ViewModel {
    moduleName:  string;
    bankName:    string;
    bankIndex:   number;
    bankCount:   number;
    rows:        (ParamVM | null)[][];
    touchedSlot: number | null;
    toast:       ToastState | null;
    overlay:     OverlayState | null;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: errors in viewmodel.ts and knob-view.ts that ParamVM is missing the new fields — this is expected; we fix them next.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/types/viewmodel.ts
git commit -m "feat: add isLongEnum/options/enumIndex to ParamVM type

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Update ViewModel builder

**Files:**
- Modify: `src/model/viewmodel.ts`

Changes: autoShorten for shortName (5 chars), isLongEnum flag, options/enumIndex fields, fix bank naming ('Main' / 'Page N').

- [ ] **Step 1: Replace src/model/viewmodel.ts**

```typescript
import type { ViewModel } from '../types/viewmodel.js';
import type { ModelState } from './state.js';
import { formatValue } from './store.js';
import { KNOBS_PER_PAGE, KNOBS_PER_ROW } from './constants.js';
import { autoShorten } from '../renderer/shorten.js';

export function buildViewModel(s: ModelState): ViewModel {
    const nBanks = Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE));
    let bankName = '';
    if (s.moduleConfig && s.moduleConfig.banks[s.knobPage]) {
        bankName = s.moduleConfig.banks[s.knobPage].name;
    } else if (nBanks > 1) {
        bankName = s.knobPage === 0 ? 'Main' : 'Page ' + s.knobPage;
    }

    const rows: ViewModel['rows'] = [[], []];
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < KNOBS_PER_ROW; col++) {
            const physK = row * KNOBS_PER_ROW + col;
            const gi    = s.knobPage * KNOBS_PER_PAGE + physK;
            const p     = s.knobParams[gi];
            if (!p) { rows[row].push(null); continue; }
            const v  = s.knobValues[gi];
            const nv = (p.min === p.max || v === null || v === undefined)
                ? 0
                : Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
            const enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
            rows[row].push({
                shortName:       p.shortLabel ? p.shortLabel.toUpperCase() : autoShorten(p.label, 5),
                fullName:        p.label,
                type:            p.type,
                normalizedValue: nv,
                displayValue:    formatValue(p, v),
                touched:         s.touchedSlot === physK,
                isLongEnum:      p.type === 'enum' && (p.options?.length ?? 0) > 6,
                options:         p.options,
                enumIndex:       enumIdx,
            });
        }
    }

    let toast: ViewModel['toast'] = null;
    if (s.touchedSlot >= 0) {
        const gi = s.knobPage * KNOBS_PER_PAGE + s.touchedSlot;
        const p  = s.knobParams[gi];
        if (p) toast = { fullName: p.label, value: formatValue(p, s.knobValues[gi]) };
    }

    return {
        moduleName:  s.activeModuleName,
        bankName,
        bankIndex:   s.knobPage,
        bankCount:   nBanks,
        rows,
        touchedSlot: s.touchedSlot >= 0 ? s.touchedSlot : null,
        toast,
        overlay:     s.enumOverlay
            ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
            : null,
    };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/model/viewmodel.ts
git commit -m "feat: update ViewModel builder — autoShorten labels, isLongEnum, bank naming

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: New knob rendering (solid circle, enum square, long-enum list)

**Files:**
- Modify: `src/renderer/knob.ts`

Three rendering modes:
1. Regular (float/int): Bresenham circle + position line
2. Short enum (≤6 options): solid-border square + 5×3 text
3. Long enum (>6 options): 3-row inline list spanning knob+label area combined

`drawLongEnumCell` handles both the knob and label areas for long enums, so label.ts must skip `drawLabelCell` when `pvm.isLongEnum`.

- [ ] **Step 1: Replace src/renderer/knob.ts**

```typescript
import type { ParamVM } from '../types/viewmodel.js';
import { CELL_W, KW, LBL_H } from './layout.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { autoShorten, enumSquareLines } from './shorten.js';

function drawCircleBorder(cx: number, cy: number, r: number): void {
    let x = r, y = 0, err = 0;
    while (x >= y) {
        fill_rect(cx + x, cy + y, 1, 1, 1); fill_rect(cx + y, cy + x, 1, 1, 1);
        fill_rect(cx - y, cy + x, 1, 1, 1); fill_rect(cx - x, cy + y, 1, 1, 1);
        fill_rect(cx - x, cy - y, 1, 1, 1); fill_rect(cx - y, cy - x, 1, 1, 1);
        fill_rect(cx + y, cy - x, 1, 1, 1); fill_rect(cx + x, cy - y, 1, 1, 1);
        y++;
        if (err <= 0) { err += 2 * y + 1; }
        if (err > 0)  { x--; err -= 2 * x + 1; }
    }
}

function drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
        fill_rect(x0, y0, 1, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

function drawRegularKnob(kx: number, ky: number, normVal: number): void {
    const cx = kx + 7, cy = ky + 7, r = 7;
    drawCircleBorder(cx, cy, r);
    const angleDeg = 210 + normVal * 300;
    const rad = angleDeg * Math.PI / 180;
    const ex = Math.round(cx + r * Math.sin(rad));
    const ey = Math.round(cy - r * Math.cos(rad));
    drawLine(cx, cy, ex, ey);
}

function drawEnumSquare(kx: number, ky: number, options: string[] | null, enumIndex: number): void {
    // Border
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
    // 5x3 text inside (14×14 usable area)
    const raw = options ? (options[enumIndex] ?? String(enumIndex)) : String(enumIndex);
    const [line1, line2] = enumSquareLines(raw);
    const inner = KW - 2;  // 14
    const totalH = 11;     // 5 + 1 + 5
    const startY = ky + 1 + Math.floor((inner - totalH) / 2);
    const l1w = fontWidth5x3(line1), l2w = fontWidth5x3(line2);
    fontPrint5x3(kx + 1 + Math.floor((inner - l1w) / 2), startY,     line1, 1);
    fontPrint5x3(kx + 1 + Math.floor((inner - l2w) / 2), startY + 6, line2, 1);
}

export function drawLongEnumCell(col: number, rowY: number, lblY: number, pvm: ParamVM): void {
    const kx     = col * CELL_W;
    const cellH  = lblY + LBL_H - rowY;  // combined knob + label height (~23px)
    const ROW_H  = 7;
    const numRows = 3;
    const startY = rowY + Math.floor((cellH - numRows * ROW_H) / 2);
    const opts   = pvm.options ?? [];
    const sel    = pvm.enumIndex;
    const maxW   = CELL_W - 4;

    for (let i = -1; i <= 1; i++) {
        const idx = sel + i;
        const y   = startY + (i + 1) * ROW_H;
        if (idx < 0 || idx >= opts.length) continue;
        const text = autoShorten(opts[idx], 7);
        const tw   = fontWidth(text);
        const tx   = kx + 2 + Math.max(0, Math.floor((maxW - tw) / 2));
        if (i === 0) {
            fill_rect(kx, y, CELL_W, ROW_H, 1);
            fontPrint(tx, y + 1, text, 0);
        } else {
            fontPrint(tx, y + 1, text, 1);
        }
    }
}

export function drawKnobWidget(col: number, rowY: number, pvm: ParamVM): void {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY;
    if (pvm.type === 'enum') {
        drawEnumSquare(kx, ky, pvm.options, pvm.enumIndex);
    } else {
        drawRegularKnob(kx, ky, pvm.normalizedValue);
    }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/renderer/knob.ts
git commit -m "feat: new knob rendering — solid circle, enum square, long-enum list

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Header and bank bar

**Files:**
- Modify: `src/renderer/header.ts`

Replace `drawInvertedHeader` with `drawHeader(left, right, inverted)`. Update bank bar to 2px/1px at same top Y.

- [ ] **Step 1: Replace src/renderer/header.ts**

```typescript
import { fontPrint, fontWidth } from '../font/index.js';
import { W, HEADER_H, BAR_Y } from './layout.js';

export function drawHeader(left: string, right: string | null, inverted = false): void {
    if (inverted) fill_rect(0, 0, W, HEADER_H, 1);
    const color = inverted ? 0 : 1;
    fontPrint(2, 1, left, color);
    if (right) fontPrint(W - fontWidth(right) - 2, 1, right, color);
}

export function drawBankBar(bankIndex: number, bankCount: number): void {
    if (bankCount <= 1) return;
    const segW = Math.floor((W - (bankCount - 1)) / bankCount);
    for (let b = 0; b < bankCount; b++) {
        const sx = b * (segW + 1);
        const sw = b === bankCount - 1 ? W - sx : segW;
        const h  = b === bankIndex ? 2 : 1;
        fill_rect(sx, BAR_Y, sw, h, 1);
    }
}
```

- [ ] **Step 2: Update overlay.ts to use drawHeader**

Open `src/renderer/overlay.ts`. Change:
```typescript
import { drawInvertedHeader } from './header.js';
```
to:
```typescript
import { drawHeader } from './header.js';
```

And change the call on line 15:
```typescript
drawInvertedHeader(fullName, valueStr);
```
to:
```typescript
drawHeader(fullName, valueStr, true);
```

- [ ] **Step 3: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors (knob-view.ts still needs updating but should still compile since old import is gone — check errors and note them).

- [ ] **Step 4: Commit**

```bash
cd movy && git add src/renderer/header.ts src/renderer/overlay.ts
git commit -m "feat: non-inverted header, 2px/1px bank bar at same top edge

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Label rendering — centered, conditional inversion, skip long-enum

**Files:**
- Modify: `src/renderer/label.ts`

- [ ] **Step 1: Replace src/renderer/label.ts**

```typescript
import type { ParamVM } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawKnobWidget, drawLongEnumCell } from './knob.js';
import { CELL_W, LBL_H } from './layout.js';

export function drawLabelCell(col: number, lblY: number, pvm: ParamVM): void {
    const knobCenterX = col * CELL_W + Math.floor(CELL_W / 2);
    const text = pvm.touched ? pvm.displayValue : pvm.shortName;
    const tw   = fontWidth(text);
    const tx   = knobCenterX - Math.floor(tw / 2);
    if (pvm.touched) {
        fill_rect(col * CELL_W, lblY, CELL_W, LBL_H, 1);
        fontPrint(tx, lblY + 1, text, 0);
    } else {
        fontPrint(tx, lblY + 1, text, 1);
    }
}

export function drawKnobRow(params: (ParamVM | null)[], rowY: number, lblY: number): void {
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        if (pvm.isLongEnum) {
            drawLongEnumCell(col, rowY, lblY, pvm);
        } else {
            drawKnobWidget(col, rowY, pvm);
            drawLabelCell(col, lblY, pvm);
        }
    }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd movy && git add src/renderer/label.ts
git commit -m "feat: centered labels, conditional inversion, skip long-enum label cell

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Knob-view wiring

**Files:**
- Modify: `src/renderer/knob-view.ts`

Replace `drawInvertedHeader` with `drawHeader`.

- [ ] **Step 1: Replace src/renderer/knob-view.ts**

```typescript
import type { ViewModel } from '../types/viewmodel.js';
import { fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y } from './layout.js';

export function renderKnobsView(vm: ViewModel): void {
    if (vm.overlay) { drawEnumOverlay(vm); return; }
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.toast.value, true);
    } else {
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW = W - rightW - 4;
        let dispName   = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        drawHeader(dispName, vm.bankName || null, false);
    }

    drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        const { fontPrint } = await import('../font/index.js').catch(() => ({ fontPrint: () => {} }));
        return;
    }

    drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
    drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
}
```

**NOTE:** The `no params` text line above is wrong in the template. Replace it with:

```typescript
    if (!hasParams) {
        // fontPrint is already imported via header.ts chain; import it directly:
        return;
    }
```

Actually, use this correct complete version:

```typescript
import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y } from './layout.js';

export function renderKnobsView(vm: ViewModel): void {
    if (vm.overlay) { drawEnumOverlay(vm); return; }
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.toast.value, true);
    } else {
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW = W - rightW - 4;
        let dispName   = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        drawHeader(dispName, vm.bankName || null, false);
    }

    drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
        return;
    }

    drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
    drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
}
```

- [ ] **Step 2: Typecheck**

```bash
cd movy && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Full build**

```bash
cd movy && npm run build
```

Expected: success, no errors or warnings.

- [ ] **Step 4: Commit**

```bash
cd movy && git add src/renderer/knob-view.ts
git commit -m "feat: wire knob-view to new drawHeader

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 13: Update screenshot baselines and run full tests

All rendering has changed, so baselines must be regenerated. Then run the diff test to confirm 0 failures.

- [ ] **Step 1: Build browser bundle**

```bash
cd movy && npm run build:browser
```

Expected: success.

- [ ] **Step 2: Regenerate all baselines**

```bash
cd movy && node browser-test/screenshot.mjs --update
```

This will open a headless browser, render all test scenarios, and write new PNG files to `browser-test/screenshots/baseline/`. Expected: all baselines updated with 0 errors.

- [ ] **Step 3: Visually inspect new baselines**

Open the baseline PNGs and verify:
- Knobs are circles with a position-indicator line (not arc dots)
- Enum params show a bordered square with 5×3 text in 2 lines
- Plaits 'engine' param (long enum, 24 options) shows a 3-row inline list with current value inverted
- Header text is white on black (not inverted rectangle)
- Labels are white text on black except when touched (inverted)
- Bank bar segments are all at the same top y, selected = 2px, unselected = 1px
- Names are centered horizontally under their knob

```bash
open movy/browser-test/screenshots/baseline/*.png
```

- [ ] **Step 4: Run screenshot regression tests**

```bash
cd movy && node browser-test/screenshot.mjs
```

Expected: `0 failures` (baselines were just generated so diffs should be 0).

- [ ] **Step 5: Device test (if reachable)**

```bash
cd movy && ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

- [ ] **Step 6: Push**

```bash
cd movy && git push
```

---

## Self-review checklist

- [x] All spec sections have corresponding tasks
- [x] No TBD/TODO/placeholder steps
- [x] Types defined in Task 7 are used consistently in Tasks 8–12
- [x] `drawLongEnumCell` defined in knob.ts (Task 9) and imported in label.ts (Task 11)
- [x] `drawHeader` defined in header.ts (Task 10) and used in knob-view.ts (Task 12) and overlay.ts (Task 10)
- [x] `autoShorten` defined in shorten.ts (Task 1) and imported in viewmodel.ts (Task 8) and knob.ts (Task 9)
- [x] `enumSquareLines` defined in shorten.ts (Task 1) and imported in knob.ts (Task 9)
- [x] `fontPrint5x3`/`fontWidth5x3` defined in index5x3.ts (Task 4) and imported in knob.ts (Task 9)
- [x] Bank naming ('Main'/'Page N') handled in viewmodel.ts (Task 8)
- [x] Screenshot baselines regenerated in Task 13
