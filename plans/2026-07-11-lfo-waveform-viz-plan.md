# LFO waveform visualization group — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the track LFO params and add a reusable LFO waveform visualization drawn across the Shape+Phase knob cells (analogous to the envelope group), usable by the track LFO and by synth custom layouts.

**Architecture:** A new `lfo` role marker on knob slots/params (parallel to `env`), detected by `detectLfoViz` and carried on the ViewModel as `lfoViz`. `drawKnobParams` draws the waveform across the two viz cells in place of their knob widgets. The track LFO model reorders its params, makes Shape a cycling enum, and emits `lfoViz` directly.

**Tech Stack:** TypeScript → `dist/esm` (esbuild), node browser tests, 128×64 1-bit framebuffer renderer.

## Global Constraints

- Design doc: `movy/plans/2026-07-11-lfo-waveform-viz-design.md`.
- Run all commands from `movy/`. Build before `.mjs` tests: `npm run build:browser`.
- New importable `dist/esm` modules must be added to `build/browser.mjs` entryPoints.
- New rendering → screenshot test; new logic → logic test. No code duplication (reuse `primitives`, `paramCell`, `countDetents`).
- Track LFO param order — line 1: Rate(0), Sync(1), Mode(2), Target(3); line 2: Shape(4), Phase(5), Retrigger(6), Depth(7).
- Mode: 0 = unipolar (baseline bottom, wave rides above), 1 = bipolar (baseline centered, wave swings ±). Retrigger on → bold dot at wave start. Depth NOT in the viz. ~2 cycles. Shape is a cycling enum (no overlay).
- Typecheck must pass: `npm run typecheck`. Commit trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`; `git add <specific files>`.

---

### Task 1: `lfo` role marker + `detectLfoViz` + ViewModel carrier

**Files:**
- Modify: `src/types/param.ts` (KnobSlot + KnobParam gain `lfo?`)
- Modify: `src/types/viewmodel.ts` (add `LfoVizVM`, `lfoViz?` on `ViewModel`)
- Modify: `src/model/hierarchy.ts` (propagate `lfo` in the config path)
- Create: `src/model/lfo-viz.ts` (`detectLfoViz`)
- Modify: `build/browser.mjs` (entry point)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Produces: `type LfoRole = 'shape'|'phase'|'mode'|'retrig'` (inline union on `KnobSlot.lfo`/`KnobParam.lfo`); `interface LfoVizVM { line:0|1; startCol:number; shape:number; phase:number; mode:number; retrigger:number }`; `detectLfoViz(params: (KnobParam|null)[]): { shape:number; phase:number; mode:number|null; retrig:number|null }[]` (page-relative indices; empty unless both shape & phase present).

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`.

Import (top):
```js
import { detectLfoViz } from '../dist/esm/model/lfo-viz.js';
```
Test block (before the summary):
```js
_log('\nTest: detectLfoViz');
{
    const P = (lfo) => ({ key: lfo ?? 'x', lfo, type: 'float', min: 0, max: 1, step: 1, options: null, renderStyle: 'arc', shortLabel: null, label: '', automatable: false });
    const g1 = detectLfoViz([P('shape'), P('phase'), P('mode'), P('retrig'), null, null, null, null]);
    eq('one group', g1.length, 1);
    eq('shape idx', g1[0].shape, 0);
    eq('phase idx', g1[0].phase, 1);
    eq('mode idx', g1[0].mode, 2);
    eq('retrig idx', g1[0].retrig, 3);
    const g2 = detectLfoViz([P('shape'), P('phase'), null, null, null, null, null, null]);
    eq('mode/retrig optional', JSON.stringify([g2[0].mode, g2[0].retrig]), JSON.stringify([null, null]));
    const g3 = detectLfoViz([P('shape'), P(null), null, null, null, null, null, null]);
    eq('needs phase', g3.length, 0);
    const g4 = detectLfoViz([P(null), P(null)]);
    eq('no markers → none', g4.length, 0);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `Cannot find module '.../dist/esm/model/lfo-viz.js'`.

- [ ] **Step 3: Implement**

In `src/types/param.ts`, add `lfo?` to both `KnobSlot` and `KnobParam` (next to the existing `env?` field on each):
```ts
    lfo?:           'shape' | 'phase' | 'mode' | 'retrig';
```

In `src/types/viewmodel.ts`, add the VM type after `EnvelopeVM` and the field on `ViewModel` (next to `envelopeLines`):
```ts
export interface LfoVizVM {
    line:      0 | 1;
    startCol:  number;   // graphic spans startCol..startCol+1
    shape:     number;   // 0..5 (LFO_SHAPES order)
    phase:     number;   // 0..1
    mode:      number;   // 0 = unipolar, 1 = bipolar
    retrigger: number;   // 0/1
}
```
```ts
    /* LFO waveform groups on this page (Shape+Phase cells drawn as a wave). */
    lfoViz?:         LfoVizVM[];
```

Create `src/model/lfo-viz.ts`:
```ts
/* Detects an LFO waveform-visualization group on a page: two adjacent knob
 * cells (Shape + Phase) that render as a single waveform graphic instead of two
 * knobs — the LFO analogue of the envelope group (see envelope.ts). Mode and
 * Retrigger are optional and read from anywhere on the page. Pure: indices only,
 * no rendering. */

import type { KnobParam } from '../types/param.js';

export interface LfoVizGroup {
    shape:  number;         // page-relative param indices
    phase:  number;
    mode:   number | null;
    retrig: number | null;
}

export function detectLfoViz(params: (KnobParam | null)[]): LfoVizGroup[] {
    let shape = -1, phase = -1, mode = -1, retrig = -1;
    params.forEach((p, i) => {
        if (!p || !p.lfo) return;
        if (p.lfo === 'shape'  && shape  < 0) shape  = i;
        else if (p.lfo === 'phase'  && phase  < 0) phase  = i;
        else if (p.lfo === 'mode'   && mode   < 0) mode   = i;
        else if (p.lfo === 'retrig' && retrig < 0) retrig = i;
    });
    if (shape < 0 || phase < 0) return [];
    return [{ shape, phase, mode: mode < 0 ? null : mode, retrig: retrig < 0 ? null : retrig }];
}
```

In `src/model/hierarchy.ts` config path, propagate the marker. Find the `KnobParam` object built in the `s.moduleConfig` banks loop (the one with `env: slot.env,`) and add:
```ts
                        env:        slot.env,
                        lfo:        slot.lfo,
```

In `build/browser.mjs`, add the entry point (near `src/model/envelope.ts`):
```js
        resolve(root, 'src/model/lfo-viz.ts'),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — "detectLfoViz" block ✓; `0 failures`. Run `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/types/param.ts src/types/viewmodel.ts src/model/lfo-viz.ts src/model/hierarchy.ts build/browser.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(lfo-viz): lfo role marker, detectLfoViz, LfoVizVM carrier

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: waveform renderer (`drawLfoWave`) + row integration

**Files:**
- Modify: `src/renderer/primitives.ts` (add `drawDottedH`)
- Create: `src/renderer/lfo-wave.ts` (`shapeSample`, `drawLfoWave`)
- Modify: `src/renderer/label.ts` (`drawKnobRow` lfoViz param; `drawKnobParams` reads `vm.lfoViz`)
- Modify: `build/browser.mjs` (entry point)
- Test: `browser-test/logic.mjs` (pure `shapeSample`)

**Interfaces:**
- Consumes: `LfoVizVM` (Task 1), `drawLine`/`drawDot` (primitives), `CELL_W` (layout).
- Produces: `shapeSample(shape:number, t:number): number` (bipolar −1..1, `t` any real, one cycle = 1); `drawLfoWave(rowY:number, g:LfoVizVM): void`; `drawDottedH(x0:number, x1:number, y:number): void`. `drawKnobParams` now draws the wave across a line's viz cells instead of their knob widgets.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`.

Import (top):
```js
import { shapeSample } from '../dist/esm/renderer/lfo-wave.js';
```
Test block:
```js
_log('\nTest: LFO shapeSample');
{
    const near = (a, b) => Math.abs(a - b) < 0.001;
    eq('sine @0', near(shapeSample(0, 0), 0), true);
    eq('sine @0.25', near(shapeSample(0, 0.25), 1), true);
    eq('tri @0.25 peak', near(shapeSample(1, 0.25), 1), true);
    eq('saw @0', near(shapeSample(2, 0), -1), true);
    eq('saw @~1', near(shapeSample(2, 0.999), 1 - 0.002), true);
    eq('square low half', shapeSample(3, 0.1), 1);
    eq('square high half', shapeSample(3, 0.6), -1);
    eq('wraps by 1', near(shapeSample(0, 1.25), shapeSample(0, 0.25)), true);
    eq('unknown → sine', near(shapeSample(9, 0.25), 1), true);
    eq('bipolar range', shapeSample(4, 0.3) >= -1 && shapeSample(4, 0.3) <= 1, true);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `Cannot find module '.../dist/esm/renderer/lfo-wave.js'`.

- [ ] **Step 3: Implement**

In `src/renderer/primitives.ts`, append:
```ts
/* Dotted horizontal from x0 to x1 (inclusive), lit on every other column. */
export function drawDottedH(x0: number, x1: number, y: number): void {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    for (let x = lo; x <= hi; x += 2) fill_rect(x, y, 1, 1, 1);
}
```

Create `src/renderer/lfo-wave.ts`:
```ts
/* Draws an LFO waveform across two knob cells (Shape+Phase) in place of the two
 * knob widgets — the LFO analogue of drawEnvelope. Reads shape/phase/mode/
 * retrigger from the LfoVizVM. Reusable by the track LFO and synth layouts. */

import type { LfoVizVM } from '../types/viewmodel.js';
import { drawLine, drawDot, drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';

const CYCLES = 2;

/* Bipolar (−1..1) sample of an LFO shape at phase `t` (one cycle = 1). s&h and
 * swishy use fixed deterministic patterns so screenshots are stable. */
export function shapeSample(shape: number, t: number): number {
    const ph = t - Math.floor(t);
    switch (shape) {
        case 0: return Math.sin(ph * 2 * Math.PI);                 // sine
        case 1:                                                     // tri
            if (ph < 0.25) return ph * 4;
            if (ph < 0.75) return 1 - (ph - 0.25) * 4;
            return -1 + (ph - 0.75) * 4;
        case 2: return ph * 2 - 1;                                 // saw
        case 3: return ph < 0.5 ? 1 : -1;                          // square
        case 4: {                                                  // s&h (stepped)
            const steps = [0.3, -0.7, 0.85, -0.35];
            return steps[Math.floor(ph * steps.length) % steps.length];
        }
        case 5: {                                                  // swishy (smooth walk)
            const pts = [0, 0.7, -0.4, 0.55, -0.8, 0.2, 0];
            const x = ph * (pts.length - 1);
            const i = Math.floor(x), f = x - i;
            return pts[i] + (pts[Math.min(i + 1, pts.length - 1)] - pts[i]) * f;
        }
        default: return Math.sin(ph * 2 * Math.PI);
    }
}

export function drawLfoWave(rowY: number, g: LfoVizVM): void {
    const x0 = g.startCol * CELL_W + 1;
    const spanW = 2 * CELL_W - 2;                          // 62px
    const topY = rowY + 1, botY = rowY + 14;
    const bipolar = g.mode === 1;
    const baseY = bipolar ? Math.round((topY + botY) / 2) : botY;
    const amp = bipolar ? (botY - topY) / 2 : (botY - topY);

    drawDottedH(x0, x0 + spanW, baseY);                    // baseline conveys mode

    const yAt = (px: number): number => {
        const u = (px - x0) / spanW;                        // 0..1 across span
        const v = shapeSample(g.shape, u * CYCLES + g.phase);
        return bipolar
            ? Math.round(baseY - v * amp)
            : Math.round(botY - ((v + 1) / 2) * amp);
    };

    let prevX = x0, prevY = yAt(x0);
    for (let px = x0 + 1; px <= x0 + spanW; px++) {
        const y = yAt(px);
        drawLine(prevX, prevY, px, y);
        prevX = px; prevY = y;
    }

    if (g.retrigger) drawDot(x0, Math.max(topY, Math.min(botY - 1, yAt(x0) - 1)));
}
```

In `src/renderer/label.ts`: import the wave + type, add the `lfoViz` param to `drawKnobRow`, and have `drawKnobParams` pass per-line groups.

Add imports:
```ts
import type { ParamVM, ViewModel, LfoVizVM } from '../types/viewmodel.js';
import { drawLfoWave } from './lfo-wave.js';
```
Replace `drawKnobRow`:
```ts
export function drawKnobRow(
    params: (ParamVM | null)[], rowY: number, lblY: number,
    held = false, poolFull = false, env = false, lfoViz: LfoVizVM | null = null,
): void {
    if (env) drawEnvelope(rowY, params);
    else if (lfoViz) drawLfoWave(rowY, lfoViz);
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        if (hiddenDuringHold(pvm, held, poolFull)) continue;
        const inViz = !!lfoViz && col >= lfoViz.startCol && col < lfoViz.startCol + 2;
        if (!env && !inViz) drawKnobWidget(col, rowY, pvm);
        drawLabelCell(col, lblY, pvm);
    }
}
```
Replace the `else` branch of `drawKnobParams`:
```ts
    } else {
        const viz0 = vm.lfoViz?.find(g => g.line === 0) ?? null;
        const viz1 = vm.lfoViz?.find(g => g.line === 1) ?? null;
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y, vm.automationHeld, vm.automationPoolFull, !!vm.envelopeLines?.[0], viz0);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y, vm.automationHeld, vm.automationPoolFull, !!vm.envelopeLines?.[1], viz1);
    }
```

In `build/browser.mjs`, add the entry point (near `src/renderer/chain-view.ts`):
```js
        resolve(root, 'src/renderer/lfo-wave.ts'),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs` → "LFO shapeSample" ✓, `0 failures`. `npm run typecheck` → exit 0. (`knob-view.ts`/`chain-view.ts` are unchanged — they already call `drawKnobParams(vm)`.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/primitives.ts src/renderer/lfo-wave.ts src/renderer/label.ts build/browser.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(lfo-viz): drawLfoWave renderer + row integration

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: emit `lfoViz` from the generic synth path (`buildViewModel`)

**Files:**
- Modify: `src/model/viewmodel.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `detectLfoViz` (Task 1), `LfoVizVM` (Task 1), the existing `planPageLayout` cell map.
- Produces: `buildViewModel` sets `vm.lfoViz` when the page has an `lfo`-marked shape+phase adjacent pair.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:
```js
_log('\nTest: buildViewModel emits lfoViz (synth reuse)');
{
    const { buildViewModel } = await import('../dist/esm/model/viewmodel.js');
    // Minimal ModelState: shape+phase adjacent on line 2, mode on line 1.
    const kp = (over) => ({ key: over.key, label: over.key, shortLabel: null, type: over.type ?? 'float',
        min: over.min ?? 0, max: over.max ?? 1, step: 1, options: over.options ?? null,
        renderStyle: 'arc', automatable: false, lfo: over.lfo });
    const s = {
        activeSlot: 0, componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        knobParams: [
            kp({ key: 'a' }), kp({ key: 'b' }), kp({ key: 'mode', type: 'enum', options: ['U','B'], max: 1, lfo: 'mode' }), kp({ key: 'd' }),
            kp({ key: 'shp', type: 'enum', options: ['a','b','c','d','e','f'], max: 5, lfo: 'shape' }),
            kp({ key: 'phs', lfo: 'phase' }), kp({ key: 'rt', type: 'int', max: 1, lfo: 'retrig' }), kp({ key: 'amt' }),
        ],
        knobValues: [0, 0, 1, 0, 2, 0.25, 1, 0],
        enumFmt: [], fileValues: [null,null,null,null,null,null,null,null], touchedSlots: [],
        enumOverlay: null, fileOverlay: null, activeModuleName: 'X', moduleId: 'x', drumPadCount: 0,
        drumCurrentPad: 0, drumCurrentPhysPad: 0, noRefreshKeys: new Set(),
    };
    const vm = buildViewModel(s);
    eq('lfoViz present', Array.isArray(vm.lfoViz) && vm.lfoViz.length === 1, true);
    eq('viz line 1', vm.lfoViz[0].line, 1);
    eq('viz startCol 0', vm.lfoViz[0].startCol, 0);
    eq('viz shape from value', vm.lfoViz[0].shape, 2);
    eq('viz phase from value', vm.lfoViz[0].phase, 0.25);
    eq('viz mode from value', vm.lfoViz[0].mode, 1);
    eq('viz retrig from value', vm.lfoViz[0].retrigger, 1);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `vm.lfoViz` is undefined (`lfoViz present` expected true, got false).

- [ ] **Step 3: Implement** — in `src/model/viewmodel.ts`:

Add the import at the top (with the other `./` imports):
```ts
import { detectLfoViz } from './lfo-viz.js';
import type { LfoVizVM } from '../types/viewmodel.js';
```
After the `for (const cell of layout.cells)` loop that fills `rows` (and before the `// Toast follows...` block), insert:
```ts
    // LFO waveform groups: resolve detected shape+phase indices to their placed
    // (line,col), require adjacency, and read the live values off the page.
    const pageParams = s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE);
    const lfoViz: LfoVizVM[] = [];
    for (const g of detectLfoViz(pageParams)) {
        const sc = layout.cells.find(c => c.idx === g.shape);
        const pc = layout.cells.find(c => c.idx === g.phase);
        if (!sc || !pc || sc.line !== pc.line || Math.abs(sc.col - pc.col) !== 1) continue;
        const num = (idx: number | null): number => {
            if (idx == null) return 0;
            const v = s.knobValues[pageStart + idx];
            return (v === null || v === undefined) ? 0 : (v as number);
        };
        const phaseP = s.knobParams[pageStart + g.phase];
        const rawPhase = num(g.phase);
        const phase = phaseP && phaseP.max !== phaseP.min
            ? Math.max(0, Math.min(1, (rawPhase - phaseP.min) / (phaseP.max - phaseP.min)))
            : Math.max(0, Math.min(1, rawPhase));
        lfoViz.push({
            line: sc.line, startCol: Math.min(sc.col, pc.col),
            shape: Math.round(num(g.shape)),
            phase,
            mode: g.mode != null ? Math.round(num(g.mode)) : 1,
            retrigger: g.retrig != null ? Math.round(num(g.retrig)) : 0,
        });
    }
```
Then in the returned VM object, add (next to `envelopeLines`):
```ts
        lfoViz: lfoViz.length ? lfoViz : undefined,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs` → "buildViewModel emits lfoViz" ✓, `0 failures`. `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/model/viewmodel.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(lfo-viz): buildViewModel emits lfoViz for lfo-marked synth layouts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: track LFO model — reorder, cycling Shape, emit `lfoViz`

**Files:**
- Modify: `src/lfo/model.ts`
- Test: `browser-test/logic.mjs` (update the existing "LFO model" block to the new positions; add viz assertions)

**Interfaces:**
- Consumes: `LfoVizVM` shape (Task 1).
- Produces: new position order (0 Rate,1 Sync,2 Mode,3 Target,4 Shape,5 Phase,6 Retrigger,7 Depth); Shape cycles inline (no overlay); Target overlay opens on pos 3; `getViewModel().lfoViz = [{line:1,startCol:0,shape,phase,mode,retrigger}]`.

- [ ] **Step 1: Update the existing tests to the new order** — in `browser-test/logic.mjs`, replace the position-specific assertions inside the existing "Test: LFO model" block. Change the layout checks and every `handleKnobDelta/Touch/Release(k, …)` to the new positions:

Replace:
```js
    eq('pos0 is TARGET', vm.rows[0][0].shortName, 'TARGET');
    eq('pos1 is SHAPE', vm.rows[0][1].shortName, 'SHAPE');
    eq('pos4 is RATE', vm.rows[1][0].shortName, 'RATE');
    eq('pos7 is RETRIG', vm.rows[1][3].shortName, 'RETRIG');
```
with:
```js
    eq('pos0 is RATE', vm.rows[0][0].shortName, 'RATE');
    eq('pos1 is SYNC', vm.rows[0][1].shortName, 'SYNC');
    eq('pos2 is MODE', vm.rows[0][2].shortName, 'MODE');
    eq('pos3 is TARGET', vm.rows[0][3].shortName, 'TARGET');
    eq('pos4 is SHAPE', vm.rows[1][0].shortName, 'SHAPE');
    eq('pos5 is PHASE', vm.rows[1][1].shortName, 'PHASE');
    eq('pos6 is RETRIG', vm.rows[1][2].shortName, 'RETRIG');
    eq('pos7 is DEPTH', vm.rows[1][3].shortName, 'DEPTH');
    eq('lfoViz present on bank', vm.lfoViz && vm.lfoViz[0].line, 1);
    eq('lfoViz spans shape+phase', vm.lfoViz[0].startCol, 0);
```
Replace the Mode toggle (`m.handleKnobDelta(2, …)` — Mode is still pos 2, keep) — it stays. Replace Sync (`3`→`1`), Rate (`4`→`0`), Depth (`5`→`7`), Target touch/delta/release (`0`→`3`), Shape touch/delta/release (`1`→`4`), Retrigger (`7`→`6`), so the block reads:
```js
    // Mode (polarity) inline enum — pos 2.
    m.handleKnobDelta(2, DETENT);
    eq('polarity set to Bipolar', env.params['lfo1:polarity'], '1');
    eq('mode display BI', m.getViewModel().rows[0][2].displayValue, 'BI');

    // Sync — pos 1 — toggles Rate (pos 0) display.
    eq('rate shows Hz when free', m.getViewModel().rows[0][0].displayValue, '1.0 Hz');
    m.handleKnobDelta(1, DETENT);
    eq('sync set', env.params['lfo1:sync'], '1');
    eq('rate shows division when sync', m.getViewModel().rows[0][0].displayValue, '1/4');

    // Rate — pos 0 — division +1.
    m.handleKnobDelta(0, DETENT);
    eq('rate_div incremented', env.params['lfo1:rate_div'], '20');
    m.handleKnobDelta(1, -DETENT);
    eq('sync cleared', env.params['lfo1:sync'], '0');
    m.handleKnobDelta(0, DETENT * 200);
    eq('rate_hz clamped ≤ 20', parseFloat(env.params['lfo1:rate_hz']) <= 20.0, true);

    // Depth — pos 7 — clamps to −1.
    m.handleKnobDelta(7, -1000);
    eq('depth clamped exactly -1', parseFloat(env.params['lfo1:depth']), -1);

    // Target overlay — pos 3.
    m.handleKnobTouch(3);
    vm = m.getViewModel();
    eq('overlay open on target', vm.overlay !== null, true);
    eq('overlay slot 3', vm.overlay.slot, 3);
    m.handleKnobDelta(3, DETENT);
    m.handleKnobRelease(3);
    eq('target committed', env.params['lfo1:target'], 'synth');
    eq('auto-enabled on target', env.params['lfo1:enabled'], '1');

    // Shape — pos 4 — now a cycling enum (NO overlay): a turn steps it.
    m.handleKnobDelta(4, DETENT * 2);
    eq('shape cycled to 2', env.params['lfo1:shape'], '2');
    m.handleKnobTouch(4);
    eq('shape touch does NOT open overlay', m.getViewModel().overlay, null);
    m.handleKnobRelease(4);

    // Retrigger — pos 6.
    m.handleKnobDelta(6, DETENT);
    eq('retrigger on', env.params['lfo1:retrigger'], '1');

    // Bank change → LFO 2, writes hit lfo2:*.
    m.changePage(1);
    eq('bank 1 name', m.getViewModel().moduleName, 'LFO 2');
    m.handleKnobDelta(2, DETENT);
    eq('lfo2 polarity written', env.params['lfo2:polarity'], '1');
```
(Delete the old None-clear and shape-overlay sub-tests that assumed old positions; the target overlay commit above covers the blocking path already tested in the separate blocking block, which uses `handleKnobTouch(0)` → update that block's touch/delta/release from `0` to `3` as well.)

Also update the blocking test block ("LFO target commit uses blocking writes"): change `handleKnobTouch(0)`, `handleKnobDelta(0, DETENT)`, `handleKnobRelease(0)` to `3`, and `rows[0][0]` (was target) to `rows[0][3]`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — old model still has Target at pos 0 (`pos0 is RATE` fails; shape overlay still opens).

- [ ] **Step 3: Implement** — in `src/lfo/model.ts`:

Replace `buildCells` body's returned array order and drop Shape's `isLongEnum` overlay hinting (Shape is now a plain cycling enum). Replace the whole `return [ … ];` in `buildCells`:
```ts
        const rate = cell({ shortName: 'RATE', fullName: 'Rate', type: 'float', renderStyle: 'arc',
            displayValue: rateDisplay(v), normalizedValue: rateNorm(v) });
        const sync = cell({ shortName: 'SYNC', fullName: 'Sync', type: 'enum',
            options: ['FREE', 'SYNC'], enumIndex: v.sync, displayValue: v.sync ? 'SYNC' : 'FREE', normalizedValue: v.sync });
        const mode = cell({ shortName: 'MODE', fullName: 'Mode', type: 'enum',
            options: ['UNI', 'BI'], enumIndex: v.polarity, displayValue: v.polarity ? 'BI' : 'UNI', normalizedValue: v.polarity });
        const shape = cell({ shortName: 'SHAPE', fullName: 'Shape', type: 'enum',
            options: LFO_SHAPES, enumIndex: v.shape, displayValue: LFO_SHAPES[v.shape],
            normalizedValue: v.shape / (LFO_SHAPES.length - 1) });
        const phase = cell({ shortName: 'PHASE', fullName: 'Phase', type: 'float', renderStyle: 'arc',
            displayValue: formatPhase(v.phase), normalizedValue: v.phase });
        const retrig = cell({ shortName: 'RETRIG', fullName: 'Retrigger', type: 'int', renderStyle: 'hbar',
            displayValue: v.retrigger ? 'On' : 'Off', normalizedValue: v.retrigger });
        const depth = cell({ shortName: 'DEPTH', fullName: 'Depth', type: 'float', renderStyle: 'arc',
            displayValue: formatDepth(v.depth), normalizedValue: (v.depth + 1) / 2 });
        return [rate, sync, mode, targetCell, shape, phase, retrig, depth];
```
(The `targetCell` const already exists above the `return` — keep it. It stays the xbox/enum cell.)

In `buildVM`, add the `lfoViz` to the returned object (next to `overlay:`):
```ts
            lfoViz: [{ line: 1, startCol: 0, shape: v.shape, phase: v.phase, mode: v.polarity, retrigger: v.retrigger }],
```

Update `openOverlay` — Target is now pos 3, Shape no longer opens an overlay:
```ts
    function openOverlay(pos: number): void {
        const v = vals[bank];
        if (pos === 3) {
            const opts = buildTargetOptions(track, bank);
            overlay = { pos, kind: 'target', options: opts.map(o => o.label),
                selected: targetIndex(opts, v.target, v.targetParam), opts };
            accum[pos] = 0;
        }
    }
```
(Remove the `pos === 1` shape branch and the now-unused `kind: 'shape'`. `commitOverlay` keeps only the `kind === 'target'` branch — delete its `else if (overlay.kind === 'shape')` block. The `overlay` type's `kind` can stay `'target' | 'shape'` or be narrowed to `'target'`; narrowing is cleaner.)

Update `handleKnobTouch` — open overlay only for Target (pos 3):
```ts
        handleKnobTouch(k: number): void {
            if (overlay && k !== overlay.pos) { commitOverlay(); }
            const idx = touched.indexOf(k);
            if (idx >= 0) touched.splice(idx, 1);
            touched.push(k);
            if (k === 3) openOverlay(k);
            dirty = true;
        },
```

Rewrite `stepDiscrete` and the `handleKnobDelta` dispatch for the new positions:
```ts
    /* Discrete params: ±1 per detent, clamped. Positions: 0 Rate, 1 Sync,
     * 2 Mode, 4 Shape, 6 Retrigger. */
    function stepDiscrete(pos: number, delta: number): void {
        const n = countDetents(accum, pos, delta);
        if (n === 0) return;
        const v = vals[bank];
        if (pos === 0) {
            if (v.sync) { v.rateDiv = clampI(v.rateDiv + n, 0, LFO_DIVISIONS.length - 1); setP(bank, 'rate_div', String(v.rateDiv)); }
            else { v.rateHz = clampF(v.rateHz * Math.pow(RATE_HZ_FACTOR, n), RATE_HZ_MIN, RATE_HZ_MAX); setP(bank, 'rate_hz', v.rateHz.toFixed(4)); }
        } else if (pos === 1) { v.sync = clampI(v.sync + n, 0, 1); setP(bank, 'sync', String(v.sync)); }
        else if (pos === 2) { v.polarity = clampI(v.polarity + n, 0, 1); setP(bank, 'polarity', String(v.polarity)); }
        else if (pos === 4) { v.shape = clampI(v.shape + n, 0, LFO_SHAPES.length - 1); setP(bank, 'shape', String(v.shape)); }
        else if (pos === 6) { v.retrigger = clampI(v.retrigger + n, 0, 1); setP(bank, 'retrigger', String(v.retrigger)); }
    }
```
```ts
        handleKnobDelta(k: number, delta: number): void {
            if (overlay && k === overlay.pos) {
                const n = countDetents(accum, k, delta);
                if (n !== 0) { overlay.selected = clampI(overlay.selected + n, 0, overlay.options.length - 1); dirty = true; }
                return;
            }
            const v = vals[bank];
            if (k === 5) { v.phase = clampF(v.phase + delta * PHASE_STEP, 0, 1); setP(bank, 'phase_offset', v.phase.toFixed(4)); }
            else if (k === 7) { v.depth = clampF(v.depth + delta * DEPTH_STEP, -1, 1); setP(bank, 'depth', v.depth.toFixed(4)); }
            else if (k === 0 || k === 1 || k === 2 || k === 4 || k === 6) { stepDiscrete(k, delta); }
            // k === 3 (Target) is overlay-only; a bare turn is ignored.
            dirty = true;
        },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs` → all LFO blocks ✓, `0 failures`. `npm run typecheck` → 0. `node browser-test/app-loop.mjs` → `ALL APP-LOOP CHECKS PASSED` (nav is position-independent).

- [ ] **Step 5: Commit**

```bash
git add src/lfo/model.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(lfo): reorder params, cycling Shape, emit lfoViz for the wave graphic

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: screenshots

**Files:**
- Modify: `browser-test/screenshot.mjs`
- Delete baseline: `browser-test/screenshots/baseline/lfo_shape_overlay.png`
- Regenerate/create baselines: `lfo_chain`, `lfo_lfo1`, `lfo_lfo2`, `lfo_target_overlay`, `lfo_viz_unipolar`, `lfo_viz_retrig`

- [ ] **Step 1: Update the harness** — in `browser-test/screenshot.mjs`:

In `PRESETS`, replace `'lfo_shape_overlay'` with the two new scenes so the LFO line reads:
```js
    'lfo_chain', 'lfo_lfo1', 'lfo_lfo2', 'lfo_target_overlay', 'lfo_viz_unipolar', 'lfo_viz_retrig',
```
In `BASE`, replace the `lfo_shape_overlay` entry:
```js
    lfo_chain: 'test8', lfo_lfo1: 'test8', lfo_lfo2: 'test8',
    lfo_target_overlay: 'test8', lfo_viz_unipolar: 'test8', lfo_viz_retrig: 'test8',
```
Replace the LFO scene `case` block (Target touch is now pos 3; add the two viz scenes):
```js
        case 'lfo_chain':
        case 'lfo_lfo1':
        case 'lfo_lfo2':
        case 'lfo_target_overlay':
        case 'lfo_viz_unipolar':
        case 'lfo_viz_retrig': {
            env.setParams({
                'synth:chain_params': JSON.stringify([
                    { key: 'cutoff', name: 'Cutoff', type: 'float' },
                    { key: 'reso',   name: 'Resonance', type: 'float' },
                ]),
                'fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
                'lfo1:sync': '0', 'lfo1:rate_hz': '2.0', 'lfo1:depth': '0.65', 'lfo1:shape': '0',
                'lfo1:polarity': (preset === 'lfo_viz_unipolar') ? '0' : '1',
                'lfo1:phase_offset': (preset === 'lfo_viz_unipolar') ? '0.25' : '0',
                'lfo1:retrigger': (preset === 'lfo_viz_retrig') ? '1' : '0',
                'lfo2:sync': '1', 'lfo2:rate_div': '19', 'lfo2:shape': '3',
            });
            if (preset === 'lfo_viz_unipolar') env.setParams({ ...env.params, 'lfo1:shape': '2' }); // saw
            if (preset === 'lfo_viz_retrig')   env.setParams({ ...env.params, 'lfo1:shape': '1' }); // tri
            const lm = createLfoModel(0);
            lm.tick();
            if (preset === 'lfo_lfo2') lm.changePage(1);
            if (preset === 'lfo_target_overlay') lm.handleKnobTouch(3);
            if (preset === 'lfo_chain') lastRender = () => renderChainView(lm.getViewModel(), 4, false, 'T1', 'LFO');
            else lastRender = () => renderKnobsView(lm.getViewModel(), false, 0);
            lastRender();
            break;
        }
```
Note: `env` in `screenshot.mjs` is the module-level `installEnv()` result; `env.setParams({...env.params, …})` merges. If `env.params` is a getter returning the internal object, prefer setting the single key up-front in the first `setParams` call instead — adjust to whatever keeps it one object (the first `setParams` already sets `lfo1:shape`; simplest is to compute the shape value inline in that first object). Concretely, replace the two post-hoc `env.setParams` lines by computing shape in the first object:
```js
                'lfo1:shape': (preset === 'lfo_viz_unipolar') ? '2' : (preset === 'lfo_viz_retrig') ? '1' : '0',
```
and delete the two `if (preset === 'lfo_viz_…') env.setParams(...)` lines.

- [ ] **Step 2: Delete the obsolete baseline**

Run: `rm browser-test/screenshots/baseline/lfo_shape_overlay.png`

- [ ] **Step 3: Generate baselines**

Run: `npm run build:browser && node browser-test/screenshot.mjs --update`
Expected: `updated` for the LFO scenes; new `lfo_viz_unipolar.png` / `lfo_viz_retrig.png`.

- [ ] **Step 4: Verify + eyeball**

Run: `node browser-test/screenshot.mjs`
Expected: `0 failed`. Open `lfo_lfo1.png` (bipolar sine centered, 2 cycles across Shape+Phase cells), `lfo_viz_unipolar.png` (saw riding above a bottom dotted baseline, phase-shifted), `lfo_viz_retrig.png` (triangle + bold dot at the start). Confirm Retrigger hbar + Depth knob still render in cols 2–3 of line 2, and RATE/SYNC/MODE/TARGET on line 1.

- [ ] **Step 5: Commit**

```bash
git add browser-test/screenshot.mjs browser-test/screenshots/baseline/lfo_chain.png browser-test/screenshots/baseline/lfo_lfo1.png browser-test/screenshots/baseline/lfo_lfo2.png browser-test/screenshots/baseline/lfo_target_overlay.png browser-test/screenshots/baseline/lfo_viz_unipolar.png browser-test/screenshots/baseline/lfo_viz_retrig.png
git rm browser-test/screenshots/baseline/lfo_shape_overlay.png
git commit -m "$(cat <<'EOF'
test(lfo-viz): new-layout + waveform screenshot baselines

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: full suite, device verification, finalize

- [ ] **Step 1: Full local suite**

Run: `npm test && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs && npm run typecheck`
Expected: every suite `0 failures` / exit 0.

- [ ] **Step 2: Device (if reachable)**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && ./scripts/test.sh || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: `ALL CHECKS PASSED`. Then manually: drill into the LFO page, confirm line 2 shows the waveform across Shape+Phase; turn Shape → waveform morphs; turn Phase → waveform slides; toggle Mode → baseline moves (center↔bottom); toggle Retrigger → start dot appears. **If offline, report in CAPS.**

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:**
- Param reorder → Task 4 (buildCells order, handler positions) + tests. ✓
- Reusable `lfo` role marker + detection → Task 1 (`param.ts`, `lfo-viz.ts`, hierarchy propagation). ✓
- ViewModel carrier `lfoViz` → Task 1 (type) + Task 3 (generic emit) + Task 4 (track LFO emit). ✓
- Renderer waveform across 2 cells, replacing knob widgets → Task 2 (`drawLfoWave`, `drawKnobRow`/`drawKnobParams`). ✓
- Mode baseline (bipolar center / unipolar bottom) → Task 2 `drawLfoWave`. ✓
- Retrigger start dot → Task 2. ✓ Phase offset → Task 2 (`yAt` uses `g.phase`). ✓
- Shape cycles, no overlay → Task 4 (`openOverlay`/`handleKnobTouch`/`stepDiscrete`). ✓
- Depth not in viz → not passed to `drawLfoWave`; stays a knob (Task 4 cells). ✓
- Reuse in synths via custom layout → Task 1 (marker + hierarchy) + Task 3 (emit) + Task 3 test. ✓
- Tests: logic (Tasks 1–4), screenshots (Task 5), app-loop/perf/device (Tasks 4/6). ✓

**Placeholder scan:** none — every code step is complete; every test has real assertions.

**Type consistency:** `LfoVizVM` fields (`line/startCol/shape/phase/mode/retrigger`) identical across Tasks 1–4. `detectLfoViz` returns `{shape,phase,mode,retrig}` used verbatim in Task 3. `shapeSample(shape,t)` / `drawLfoWave(rowY,g)` / `drawDottedH(x0,x1,y)` signatures match between Task 2 definition and its callers. New positions (0 Rate…7 Depth) consistent across Task 4 code and tests.
