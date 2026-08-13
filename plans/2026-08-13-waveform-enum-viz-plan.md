# Waveform Enum Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a waveform silhouette in place of the abbreviated option text for single-knob waveform enums, and add matching glyphs to the full-screen enum overlay.

**Architecture:** A new cached `uniqueShape` flag on `EnumClass` decides eligibility (every option maps to a glyph AND no two options share one). A new per-cell `renderStyle: 'wave'` draws the silhouette inside the existing enum frame — no `page-layout.ts` changes, because this is a per-cell style, not a multi-cell group like envelope/LFO/filter. One shared `drawWave()` serves both the 16px cell and the 13×5 overlay row.

**Tech Stack:** TypeScript → esbuild bundle (`ui.js`), QuickJS on device. Tests are pure-node `.mjs` suites (no browser).

**Design doc:** `movy/plans/2026-08-13-waveform-enum-viz-design.md`

## Global Constraints

- **File size: hard limit 200 lines, target 50–100.** Split if exceeded.
- **`model/` never calls display functions** (`fill_rect`, `fontPrint`). **`renderer/` holds no state.**
- **Comments explain WHY** (constraints, invariants, workarounds) — never WHAT the code literally does.
- **Glyph geometry (settled by prototype, do not re-derive):** overlay glyph is **13×5 at 1 cycle**, gutter 16px. 2 cycles makes sine and triangle identical at 5px; 7px-tall glyphs bleed into neighbouring rows and get clipped by the selection bar.
- **Square/pulse risers must be straight vertical lines**, not Bresenham diagonals. Each column draws a 1px-wide `fill_rect` spanning the gap to the previous column's y.
- **Selected overlay row draws its glyph in colour 0**, inverting with the text. Drawing white-then-inverting the gutter erases the glyph.
- Run `npm run build:browser` before any `.mjs` test run.

## Qualifying set (the target — 16 params / 10 modules)

Measured against the real shipped rule after Tasks 1–3:

`303:waveform`, `forge:cv_wave`, `osirus:sub_osc_shape`, `osirus:delay_lfo_shape`,
`spectra:motion_shape`, `ambiotica:mod_shape`, `war_bells:mot_shape`,
`signal:mod_shape`, `aphex:v1_wave`, `aphex:v2_wave`, `chordism:wave_1..4`,
`noisemaker:osc1_wave`, `noisemaker:osc2_wave`.

`noisemaker` was not in the original 78-module fleet dump; it is captured into
`browser-test/fixtures/dump-extra/` (Task 3). `osirus:delay_lfo_shape` qualifies
because its rate/depth partner is not on the same page, so the two-cell LFO viz
never forms a group for it.

Must NOT qualify: `helm:osc_1_waveform`/`osc_2_waveform`/`sub_waveform` (step counts collapse), `osirus:osc1_wave_select`/`osc2_wave_select` (62 identical wavetables), `chordism:vib_stray`, `freak:random_mode`, `hush1:vca_mode` (not waveform pickers).

---

### Task 1: New shape glyphs and name mappings

**Files:**
- Modify: `src/renderer/lfo-wave.ts` (add cases to `shapeSample`, ~line 46-57)
- Modify: `src/model/lfo-shapes.ts` (`NAMED` table, ~line 10-22)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `shapeSample(shape: number, t: number): number` handles ids 13–19. `shapeId(name: string): number | null` maps the new names.

- [ ] **Step 1: Write the failing test**

Add to `browser-test/logic.mjs` (follow the file's existing assertion helper style):

```js
// --- new waveform glyph ids -------------------------------------------------
{
    const { shapeId } = await import('../dist/esm/model/lfo-shapes.js');
    const { shapeSample } = await import('../dist/esm/renderer/lfo-wave.js');

    // Names that previously had no glyph.
    eq(shapeId('Pulse'), 13, 'Pulse → 13');
    eq(shapeId('Pulse Tr'), 13, 'Pulse Tr → 13');
    eq(shapeId('PW-Square'), 14, 'PW-Square → 14');
    eq(shapeId('Ring'), 15, 'Ring → 15');
    eq(shapeId('Wavetable'), 16, 'Wavetable → 16');
    eq(shapeId('Warp'), 17, 'Warp → 17');
    eq(shapeId('Sink'), 18, 'Sink → 18');
    eq(shapeId('Off'), 19, 'Off → 19');

    // Pure aliases — no new glyph, reuse existing silhouettes.
    eq(shapeId('Ramp'), 2, 'Ramp → saw-up');
    eq(shapeId('Rand'), 4, 'Rand → s&h');

    // Pulse must no longer collide with Square (aphex:v2_wave lists both).
    ok(shapeId('Pulse') !== shapeId('Square'), 'Pulse != Square');
    // Random moves 4→5 so it stops colliding with S&H (signal:mod_shape).
    eq(shapeId('Random'), 5, 'Random → smooth-random');
    ok(shapeId('S&H') !== shapeId('Random'), 'S&H != Random');

    // Off is a flat line at zero across the whole cycle.
    eq(shapeSample(19, 0.0), 0, 'off flat at 0.0');
    eq(shapeSample(19, 0.5), 0, 'off flat at 0.5');
    // Every new id must produce a finite sample in [-1, 1].
    for (let id = 13; id <= 19; id++) {
        for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
            const v = shapeSample(id, t);
            ok(Number.isFinite(v) && v >= -1 && v <= 1, `shape ${id} @ ${t} in range`);
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `shapeId('Pulse')` returns `3` (square), `shapeId('Off')` returns `null`.

- [ ] **Step 3: Add the glyph samplers**

In `src/renderer/lfo-wave.ts`, add these cases to `shapeSample`'s switch, immediately before `default:`:

```ts
        case 13: return ph < 0.25 ? 1 : -1;                    // pulse (25% duty)
        case 14: return ph < 0.15 ? 1 : -1;                    // pw-square (narrow)
        /* Ring mod: a carrier gated by a much faster modulator, so the silhouette
         * reads as a dense burst rather than a smooth tone. */
        case 15: return Math.sin(ph * 2 * Math.PI) * Math.sin(ph * 10 * Math.PI);
        case 16: return Math.sin(ph * 2 * Math.PI) * 0.6       // wavetable
                      + Math.sin(ph * 8 * Math.PI) * 0.4;
        /* Warp/Sink are Sine bent toward square and toward a spike. They exist
         * only so ambiotica's Sine|Warp|Sink list has three distinct glyphs. */
        case 17: { const s = Math.sin(ph * 2 * Math.PI); return Math.sign(s) * Math.pow(Math.abs(s), 0.35); }
        case 18: { const s = Math.sin(ph * 2 * Math.PI); return Math.sign(s) * Math.pow(Math.abs(s), 3); }
        case 19: return 0;                                      // off — flat line
```

Extend the id legend comment at the top of `src/model/lfo-shapes.ts`:

```
 *  13 pulse  14 pw-square  15 ring  16 wavetable  17 warp  18 sink  19 off
```

- [ ] **Step 4: Add the name mappings**

In `src/model/lfo-shapes.ts`, update `NAMED`. Note `norm()` strips `&`, spaces and underscores but **not** hyphens, so `PW-Square` normalises to `pw-square`.

```ts
const NAMED: Record<string, number> = {
    sine: 0, sin: 0, skewedsine: 0,
    tri: 1, triangle: 1,
    saw: 2, sawtooth: 2, rampup: 2, softsaw: 2, sawup: 2, ramp: 2,
    square: 3, sqr: 3, squ: 3, rect: 3, softsquare: 3,
    sh: 4, samplehold: 4, rnd1: 4, rand: 4,
    smoothrandom: 5, sg: 5, rnd2: 5, drift: 5, sampleglide: 5, random: 5,
    rampdown: 6, sawdown: 6,
    noise: 7,
    envelope: 8,
    stepsequencer: 9, step: 9,
    mseg: 10, formula: 10,
    pulse: 13, pulsetr: 13, warmpulse: 13,
    'pw-square': 14,
    ring: 15,
    wavetable: 16,
    warp: 17,
    sink: 18,
    off: 19,
};
```

Three deliberate moves out of their old slots, each with a reason to record in a comment above the table:

```ts
/* `random` was 4 (s&h) and `pulse`/`warmpulse` were 3 (square). Both moved so a
 * list containing BOTH members of the pair gets two distinct silhouettes —
 * signal:mod_shape lists S&H and Random, aphex:v2_wave lists Square and Pulse.
 * `warp`/`sink` left sine (0) for the same reason (ambiotica:mod_shape). */
```

- [ ] **Step 5: Run tests**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS.

- [ ] **Step 6: Regenerate LFO screenshot baselines**

The `random` 4→5 and `pulse` 3→13 moves change existing LFO waveform renders.

```bash
cd movy && node browser-test/screenshot.mjs --update
git diff --stat browser-test/screenshots/baseline/
```
Inspect each changed baseline. Only LFO scenes whose current option is Random/Pulse/Warp/Sink should move. **If an unrelated baseline changed, stop and investigate** — it means a mapping was moved that some other list depended on.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lfo-wave.ts src/model/lfo-shapes.ts browser-test/logic.mjs browser-test/screenshots/baseline/
git commit -m "$(cat <<'EOF'
feat(viz): add pulse/ring/wavetable/warp/sink/off waveform glyphs

Splits Pulse from Square and Random from S&H so lists containing both
members of a pair get distinct silhouettes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `uniqueShape` detection

**Files:**
- Modify: `src/model/enum-class.ts:23-47`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `shapeId()` from Task 1.
- Produces: `EnumClass` gains `uniqueShape: boolean` and `shapeIds: number[] | null`. `enumClassOf(p: KnobParam): EnumClass` is unchanged in signature.

`shapeIds` is cached alongside the booleans so neither the cell nor the overlay resolves option names per frame — the same reasoning as the existing `enumClass` cache (see the file header). It is non-null exactly when `uniqueShape` is true.

- [ ] **Step 1: Write the failing test**

```js
// --- uniqueShape ------------------------------------------------------------
{
    const { enumClassOf } = await import('../dist/esm/model/enum-class.js');
    const mk = (options) => ({ key: 'k', label: 'L', type: 'enum', options });

    // Qualifies: every option maps, all distinct.
    ok(enumClassOf(mk(['Saw', 'Square'])).uniqueShape, '303 waveform qualifies');
    ok(enumClassOf(mk(['Sine', 'Tri', 'Saw', 'Square', 'Noise'])).uniqueShape, 'forge cv_wave qualifies');
    ok(enumClassOf(mk(['Off', 'Sine', 'Triangle', 'Saw', 'Square', 'Pulse Tr', 'Wavetable'])).uniqueShape,
       'chordism wave_N qualifies');
    ok(enumClassOf(mk(['Sine', 'Tri', 'Saw', 'Square', 'S&H', 'Random'])).uniqueShape,
       'signal mod_shape qualifies');
    ok(enumClassOf(mk(['Saw', 'Square', 'Pulse', 'Ring'])).uniqueShape, 'aphex v2_wave qualifies');

    // Rejected — a name has no glyph.
    ok(!enumClassOf(mk(['Gate', 'Envelope'])).uniqueShape, 'hush1 vca_mode rejected');
    ok(!enumClassOf(mk(['LFO', 'Random'])).uniqueShape, 'chordism vib_stray rejected');

    // Rejected — two options would draw the same glyph.
    ok(!enumClassOf(mk(['Sine', 'Triangle', 'Square', 'Saw Down', 'Saw Up',
                        '3 Step', '4 Step', '8 Step',
                        '3 Pyramid', '5 Pyramid', '9 Pyramid'])).uniqueShape,
       'helm osc waveform rejected (step counts collapse)');
    ok(!enumClassOf(mk(['Sine', 'Triangle', 'Wave 3', 'Wave 4'])).uniqueShape,
       'osirus wavetables rejected');

    // Non-enums and empty lists are inert.
    eq(enumClassOf({ key: 'k', label: 'L', type: 'float', options: null }).uniqueShape, false, 'float inert');

    // shapeIds is populated exactly when uniqueShape holds.
    const q = enumClassOf(mk(['Saw', 'Square']));
    deepEq(q.shapeIds, [2, 3], 'shapeIds resolved');
    eq(enumClassOf(mk(['Gate', 'Envelope'])).shapeIds, null, 'shapeIds null when not qualifying');
}
```

(Use whatever deep-equality helper `logic.mjs` already defines; if it has none, compare `JSON.stringify`.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `uniqueShape` is `undefined`.

- [ ] **Step 3: Implement**

In `src/model/enum-class.ts`, extend the interface and the factory:

```ts
export interface EnumClass {
    shape: boolean;      // a waveform picker (LFO shape viz)
    division: boolean;   // a clock-division list (LFO rate viz)
    filterMode: boolean; // a filter-type picker (filter curve viz)
    slope: boolean;      // a dB-per-octave picker (filter curve viz)
    /* Every option maps to a glyph AND no two share one — the bar for replacing
     * the option TEXT with a silhouette. A list failing either half would draw
     * two different options identically, which is worse than the abbreviation
     * it replaces (helm's 3/4/8 Step, osirus's 62 "Wave N" wavetables). */
    uniqueShape: boolean;
    shapeIds: number[] | null;   // non-null exactly when uniqueShape
}

const NONE: EnumClass = { shape: false, division: false, filterMode: false, slope: false,
                          uniqueShape: false, shapeIds: null };

/* Resolve every option to a glyph id, or null if any is unmapped or duplicated. */
function uniqueShapeIds(opts: string[]): number[] | null {
    const ids: number[] = [];
    const seen: Record<number, true> = {};
    for (const o of opts) {
        const id = shapeId(o);
        if (id === null || seen[id]) return null;
        seen[id] = true;
        ids.push(id);
    }
    return ids;
}
```

Add `shapeId` to the existing import from `./lfo-shapes.js`, and in `enumClassOf`:

```ts
export function enumClassOf(p: KnobParam): EnumClass {
    if (!p.options || p.options.length === 0) return NONE;
    if (!p.enumClass) {
        const ids = uniqueShapeIds(p.options);
        p.enumClass = {
            shape: isShapeEnum(p.options),
            division: isDivisionEnum(p.options),
            filterMode: isFilterModeEnum(p.options),
            slope: isSlopeEnum(p.options),
            uniqueShape: ids !== null,
            shapeIds: ids,
        };
    }
    return p.enumClass;
}
```

- [ ] **Step 4: Run tests**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/enum-class.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(model): cache uniqueShape + shapeIds on EnumClass

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Shared `drawWave` primitive

**Files:**
- Modify: `src/renderer/lfo-wave.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `shapeSample` (Task 1).
- Produces: `drawWave(x: number, y: number, w: number, h: number, shape: number, cycles: number, colour: 0 | 1): void`.

`drawLfoWave` is **not** modified — it keeps its richer renderer (phase, deform, amplitude, bipolar baseline, retrigger dot). `drawWave` is the plain silhouette used by both the knob cell and the overlay row.

- [ ] **Step 1: Write the failing test**

Assert geometry via a `fill_rect` spy — a square's transition column must be a single tall rect, not a stack of diagonal pixels.

```js
// --- drawWave straight risers ----------------------------------------------
{
    const calls = [];
    const prev = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => calls.push({ x, y, w, h, v });
    const { drawWave } = await import('../dist/esm/renderer/lfo-wave.js');

    drawWave(0, 0, 13, 5, 3, 1, 1);            // square, 1 cycle, 13x5
    globalThis.fill_rect = prev;

    ok(calls.length > 0, 'drawWave drew something');
    ok(calls.every(c => c.w === 1), 'every column is 1px wide');
    ok(calls.every(c => c.v === 1), 'colour honoured');
    ok(calls.every(c => c.y >= 0 && c.y + c.h <= 5), 'stays inside the box');
    ok(calls.every(c => c.x >= 0 && c.x < 13), 'stays inside the box horizontally');
    // The square's edge is a single vertical rect spanning the full height.
    ok(calls.some(c => c.h === 5), 'square riser is one full-height vertical rect');
    // Flat "off" never rises.
    const flat = [];
    globalThis.fill_rect = (x, y, w, h, v) => flat.push({ x, y, w, h, v });
    drawWave(0, 0, 13, 5, 19, 1, 1);
    globalThis.fill_rect = prev;
    ok(flat.every(c => c.h === 1), 'off is flat — no risers');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `drawWave is not a function`.

- [ ] **Step 3: Implement**

Append to `src/renderer/lfo-wave.ts`:

```ts
/* Plain waveform silhouette in a w×h box — the single-knob enum cell and the
 * enum-overlay row, which differ only in size. Each column is one pixel plus a
 * VERTICAL connector spanning the gap to the previous column: square and pulse
 * edges must be straight risers. drawLfoWave's Bresenham diagonals read as
 * slanted steps once the box is only 5px tall. */
export function drawWave(
    x: number, y: number, w: number, h: number,
    shape: number, cycles: number, colour: 0 | 1,
): void {
    const mid = y + (h - 1) / 2, amp = (h - 1) / 2;
    const yAt = (px: number): number =>
        Math.round(mid - shapeSample(shape, ((px - x) / w) * cycles) * amp);
    let py = yAt(x);
    fill_rect(x, py, 1, 1, colour);
    for (let px = x + 1; px < x + w; px++) {
        const ny = yAt(px);
        fill_rect(px, Math.min(py, ny), 1, Math.abs(ny - py) + 1, colour);
        py = ny;
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS.

- [ ] **Step 5: Check the file size limit**

```bash
wc -l src/renderer/lfo-wave.ts
```
If over 200, split the sampler (`shapeSample` + `skewPhase`) into `src/renderer/wave-sample.ts` and re-export, updating importers.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lfo-wave.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(renderer): add drawWave silhouette primitive with straight risers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `'wave'` render style in the knob cell

**Files:**
- Create: `src/model/wave-viz.ts`
- Modify: `src/types/param.ts:127`, `src/types/viewmodel.ts:11` (add `'wave'` to both `renderStyle` unions, add `waveShape?: number` to `ParamVM`)
- Modify: `src/model/viewmodel.ts:82-100`
- Modify: `src/renderer/knob.ts:195-221`
- Test: `browser-test/logic.mjs`, `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `enumClassOf` (Task 2), `drawWave` (Task 3), `planPageLayout` from `src/model/page-layout.ts`.
- Produces: `waveCellIndices(params: (KnobParam | null)[], layout: PageLayout): Set<number>` from `src/model/wave-viz.ts`. `ParamVM.renderStyle` may be `'wave'`, with `ParamVM.waveShape: number` carrying the current option's glyph id.

No `page-layout.ts` change: envelope/LFO/filter groups claim whole lines, but a single-knob waveform is a per-cell style.

- [ ] **Step 1: Write the failing test**

```js
// --- wave cell selection ----------------------------------------------------
{
    const { waveCellIndices } = await import('../dist/esm/model/wave-viz.js');
    const { planPageLayout } = await import('../dist/esm/model/page-layout.js');
    const enumP = (key, options, extra = {}) =>
        ({ key, label: key, type: 'enum', options, renderStyle: 'arc', ...extra });

    // A lone waveform enum gets the style.
    {
        const params = [enumP('waveform', ['Saw', 'Square']), null, null, null, null, null, null, null];
        const idx = waveCellIndices(params, planPageLayout(params));
        ok(idx.has(0), 'lone waveform enum selected');
    }
    // A shape enum inside a detected LFO group belongs to the LFO graphic, not here.
    {
        const params = [
            enumP('lfo_shape', ['Sine', 'Tri', 'Saw', 'Square', 'Noise']),
            { key: 'lfo_rate', label: 'LFO Rate', type: 'float', min: 0, max: 1, renderStyle: 'arc' },
            null, null, null, null, null, null,
        ];
        const layout = planPageLayout(params);
        ok(layout.lfos.length === 1, 'LFO group detected (guard)');
        ok(!waveCellIndices(params, layout).has(0), 'LFO-owned shape not re-styled');
    }
    // A non-qualifying enum is untouched.
    {
        const params = [enumP('vca_mode', ['Gate', 'Envelope']), null, null, null, null, null, null, null];
        ok(!waveCellIndices(params, planPageLayout(params)).has(0), 'non-waveform enum untouched');
    }
    // An explicit config render override wins.
    {
        const params = [enumP('waveform', ['Saw', 'Square'], { renderStyle: 'preset' }),
                        null, null, null, null, null, null, null];
        ok(!waveCellIndices(params, planPageLayout(params)).has(0), 'config render override wins');
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — cannot resolve `dist/esm/model/wave-viz.js`.

- [ ] **Step 3: Create `src/model/wave-viz.ts`**

```ts
/* Which cells on a page draw a waveform silhouette instead of the abbreviated
 * option text. Unlike envelope/LFO/filter groups (see page-layout.ts) this is a
 * per-CELL style, not a multi-cell group, so it needs no layout rearrange —
 * only the indices the other detectors already claimed, to stay out of them.
 * Pure: indices only, no rendering. */

import type { KnobParam } from '../types/param.js';
import type { PageLayout } from './page-layout.js';
import { enumClassOf } from './enum-class.js';

/* Cells already drawn by a multi-cell graphic. An LFO's Shape param is drawn as
 * part of the LFO waveform; re-styling its cell would draw it twice. */
function claimedCells(layout: PageLayout): Set<number> {
    const out = new Set<number>();
    for (const e of layout.envelopes) { /* envelopes claim by role index */ }
    for (const l of layout.lfos) {
        out.add(l.shape);
        for (const i of [l.phase, l.rate, l.depth, l.deform, l.mode, l.retrig]) {
            if (i !== null) out.add(i);
        }
    }
    for (const f of layout.filters) {
        out.add(f.cutoff); out.add(f.resonance);
        if (f.modeIdx !== null) out.add(f.modeIdx);
        if (f.slopeIdx !== null) out.add(f.slopeIdx);
    }
    return out;
}

export function waveCellIndices(
    params: (KnobParam | null)[], layout: PageLayout,
): Set<number> {
    const claimed = claimedCells(layout);
    const out = new Set<number>();
    params.forEach((p, i) => {
        if (!p || p.type !== 'enum' || claimed.has(i)) return;
        /* A module config's explicit `render:` stays authoritative, as it is
         * everywhere else the model picks a style. */
        if (p.renderStyle !== 'arc') return;
        if (enumClassOf(p).uniqueShape) out.add(i);
    });
    return out;
}
```

Delete the empty envelope loop — envelope stages are numeric, never enums, so they cannot collide. Keep the LFO and filter loops.

- [ ] **Step 4: Widen the types**

`src/types/param.ts:127` and `src/types/viewmodel.ts:11` — add `'wave'` to both `renderStyle` unions and extend the trailing comment on the `ParamVM` one:

```ts
    renderStyle:    'arc' | 'hbar' | 'vbar' | 'preset' | 'xbox' | 'steps' | 'wave';
```

Add to `ParamVM` in `src/types/viewmodel.ts`:

```ts
    waveShape?:      number;    // glyph id for renderStyle 'wave' (see lfo-shapes.ts)
```

- [ ] **Step 5: Wire the viewmodel**

In `src/model/viewmodel.ts`, import `waveCellIndices` from `./wave-viz.js`, and after the `layout` is computed (line 38):

```ts
const waveCells = waveCellIndices(s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE), layout);
```

Inside the `for (const cell of layout.cells)` loop, replace the `renderStyle: p.renderStyle,` line with:

```ts
            renderStyle:     waveCells.has(localIdx) ? 'wave' : p.renderStyle,
            ...(waveCells.has(localIdx)
                ? { waveShape: (p.enumClass?.shapeIds ?? [])[enumIdx] ?? 10 }
                : {}),
```

(`enumClass` is populated by the `waveCellIndices` call above, so the lookup is a cached array index. Falling back to the generic squiggle `10` guards an out-of-range index from a stale value.)

- [ ] **Step 6: Draw it**

In `src/renderer/knob.ts`, import `drawWave` from `./lfo-wave.js` and add a function next to `drawEnumSquare`:

```ts
/* Waveform cell: the enum square's frame with a silhouette instead of the two
 * abbreviated text lines. The frame stays because it is what marks the cell as
 * an option list rather than a continuous value — and it distinguishes this
 * from the frameless two-cell LFO graphic. */
function drawWaveSquare(kx: number, ky: number, shape: number): void {
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
    drawWave(kx + 2, ky + 4, KW - 4, KW - 8, shape, 1, 1);
}
```

In `drawKnobWidget`, add the branch **before** the `pvm.type === 'enum'` branch (that branch would otherwise swallow it):

```ts
    } else if (pvm.renderStyle === 'wave') {
        drawWaveSquare(kx, ky, pvm.waveShape ?? 10);
    } else if (pvm.type === 'enum') {
```

- [ ] **Step 7: Run tests**

```bash
cd movy && npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```
Expected: PASS.

- [ ] **Step 8: Add screenshot scenes**

Add `'wave_cell_303'`, `'wave_cell_forge'`, `'wave_cell_chordism'` to the `PRESETS` array in `browser-test/screenshot.mjs`, with mock presets backing them in `BASE` following the existing pattern (see how `lfo_prefix` / `collide_osc` are set up). Then:

```bash
node browser-test/screenshot.mjs --update
node browser-test/screenshot.mjs
```
Open the three new baselines and confirm the silhouette is centred in the frame and the square's riser is vertical.

- [ ] **Step 9: Update the dump snapshot**

```bash
node browser-test/dump-replay.mjs
```
Expected: FAIL — render styles changed for the 12 qualifying params.

```bash
node browser-test/dump-replay.mjs --update
git diff browser-test/dump-expect.json | grep -c '"wave"'
```
Expected: exactly **12** `"wave"` entries. Confirm they are the 12 named at the top of this plan and that no `helm` or `osirus:osc*_wave_select` entry is among them. If the count differs, the detector is wrong — fix it before continuing.

- [ ] **Step 10: Commit**

```bash
git add src/model/wave-viz.ts src/model/viewmodel.ts src/renderer/knob.ts \
        src/types/param.ts src/types/viewmodel.ts \
        browser-test/logic.mjs browser-test/screenshot.mjs \
        browser-test/dump-expect.json browser-test/screenshots/baseline/
git commit -m "$(cat <<'EOF'
feat(ui): draw waveform silhouette for single-knob waveform enums

12 params across 8 modules qualify; the strict rule (every option maps to
a distinct glyph) excludes helm's step counts and osirus's wavetables.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Glyphs in the enum overlay

**Files:**
- Modify: `src/types/viewmodel.ts:70-74` (`OverlayState`)
- Modify: `src/model/viewmodel.ts:161-165`
- Modify: `src/renderer/overlay.ts:13-49`
- Test: `browser-test/screenshot.mjs`, `browser-test/perf.mjs`

**Interfaces:**
- Consumes: `drawWave` (Task 3), `EnumClass.shapeIds` (Task 2).
- Produces: `OverlayState.shapeIds: number[] | null`.

- [ ] **Step 1: Extend `OverlayState`**

`src/types/viewmodel.ts`:

```ts
export interface OverlayState {
    slot:     number;
    options:  string[];
    selected: number;
    /* Per-option glyph ids when the param is a qualifying waveform enum; null
     * for every other list, which then renders exactly as before. */
    shapeIds: number[] | null;
}
```

- [ ] **Step 2: Populate it**

In `src/model/viewmodel.ts`, replace the `overlay:` ternary:

```ts
        overlay: s.enumOverlay
            ? {
                slot: s.enumOverlay.slot,
                options: s.enumOverlay.options,
                selected: s.enumOverlay.selected,
                /* Read from the cached EnumClass — resolving 64 option names per
                 * frame is exactly what enum-class.ts exists to prevent. */
                shapeIds: (() => {
                    const p = s.knobParams[s.enumOverlay.gi];
                    return p ? (enumClassOf(p).shapeIds) : null;
                })(),
              }
            : s.fileOverlay
            ? { slot: s.fileOverlay.slot, options: s.fileOverlay.labels,
                selected: s.fileOverlay.selected, shapeIds: null }
            : null,
```

Import `enumClassOf` from `./enum-class.js`.

- [ ] **Step 3: Draw the gutter**

In `src/renderer/overlay.ts`, import `drawWave` from `./lfo-wave.js` and add above `drawEnumOverlay`:

```ts
/* Overlay glyph geometry. 13×5 at ONE cycle: at two cycles sine and triangle
 * become the same squiggle at this height, and a 7px-tall glyph bleeds into the
 * neighbouring row and is clipped by the selection bar. */
const GLYPH_W = 13, GLYPH_H = 5, GUTTER = 16;
```

Then inside the row loop, replace the body with:

```ts
    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = listTop + i * ROW_H;
        const sel = idx === ov.selected;
        if (sel) fill_rect(ovX, y, ovW - 2, ROW_H, 1);
        const textX = ov.shapeIds ? ovX + GUTTER : ovX + 2;
        if (ov.shapeIds) {
            /* Drawn in the row's foreground colour so it inverts with the text.
             * Drawing it lit and then inverting the gutter erases it. */
            drawWave(ovX + 2, y + Math.floor((ROW_H - GLYPH_H) / 2),
                     GLYPH_W, GLYPH_H, ov.shapeIds[idx] ?? 10, 1, sel ? 0 : 1);
        }
        fontPrint(textX, y + 1, ov.options[idx], sel ? 0 : 1);
    }
```

- [ ] **Step 4: Typecheck and run existing suites**

```bash
cd movy && npm run typecheck && npm run build:browser \
  && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```
Expected: PASS. Typecheck catches any `OverlayState` construction missing the new field.

- [ ] **Step 5: Add screenshot scenes**

Add to `PRESETS` in `browser-test/screenshot.mjs`:
- `wave_overlay_chordism` — selected on `Off`, so the flat-line glyph and the inversion are both covered
- `wave_overlay_signal` — selected on `S&H`, proving S&H and Random differ
- `wave_overlay_aphex` — selected on `Pulse`, proving Pulse and Square differ

Drive each the same way the existing `enum_overlay` scene does (`screenshot.mjs:287`: `model.handleKnobTouch(0); forceRender();`).

```bash
node browser-test/screenshot.mjs --update
node browser-test/screenshot.mjs
```

Open all three. Verify: glyphs are legible, the selected row's glyph is dark-on-light, the text baseline still aligns, and no name is clipped by the 78px remaining width.

Also confirm the **existing** `enum_overlay` baseline did **not** change — Plaits' list is not a qualifying waveform enum, so that overlay must be byte-identical.

- [ ] **Step 6: Guard the cost**

Add a `perf.mjs` case rendering `wave_overlay_chordism` and asserting the `fill_rect` count stays under a ceiling (~6 rows × 13 columns + frame + text; set the ceiling ~20% above the measured value). Follow the existing assertions' style in that file.

```bash
node browser-test/perf.mjs
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/viewmodel.ts src/model/viewmodel.ts src/renderer/overlay.ts \
        browser-test/screenshot.mjs browser-test/perf.mjs \
        browser-test/screenshots/baseline/
git commit -m "$(cat <<'EOF'
feat(ui): draw waveform glyphs in the enum overlay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verification, docs, device

**Files:**
- Modify: `MANUAL.md`
- Create: `docs/assets/wave_cell_forge.png`, `docs/assets/wave_overlay_chordism.png`

- [ ] **Step 1: Run the whole local suite**

```bash
cd movy && npm test && npm run typecheck
```
Expected: all five suites 0 failures, typecheck clean.

- [ ] **Step 2: Prove the strict rule has teeth**

Temporarily weaken `uniqueShapeIds` in `src/model/enum-class.ts` to ignore duplicates (`if (id === null) return null;` — drop the `seen[id]` check), rebuild, and run:

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: **FAIL** on the helm and osirus assertions. Revert the weakening, rebuild, confirm PASS. A test that does not fail here is not protecting anything.

- [ ] **Step 3: Generate doc assets**

```bash
node scripts/make-doc-assets.mjs wave_cell_forge wave_overlay_chordism
```

- [ ] **Step 4: Update `MANUAL.md`**

Read the surrounding sections first and match their voice. Cover: waveform enums draw as a silhouette instead of an abbreviation; the overlay lists names with matching glyphs; it applies only where every option has its own distinct glyph, so lists like Osirus's wavetables keep their text. Add the two screenshots. Add the render style to the **Controls reference** tables in section 8 if they enumerate cell styles.

`README.md` is not updated — this is not a headline feature.

- [ ] **Step 5: Device test**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, report **DEVICE OFFLINE** to the user in CAPS. If reachable, also open Movy on a track with Forge loaded and grab the real screen to confirm the silhouette renders on hardware:

```bash
node scripts/grab-screen.mjs /tmp/wave.png
```

- [ ] **Step 6: Commit and push**

```bash
git add MANUAL.md docs/assets/wave_cell_forge.png docs/assets/wave_overlay_chordism.png
git commit -m "$(cat <<'EOF'
docs: document waveform enum visualization

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes

- **Spec coverage:** glyph set → Task 1; `uniqueShape` → Task 2; shared `drawWave` with vertical risers → Task 3; cell style + no page-layout change + config-override precedence → Task 4; overlay glyphs at 13×5/1-cycle with colour-0 selection → Task 5; tests/docs/device → Tasks 4–6. The design's "out of scope" items (leaving `drawLfoWave` alone, no helm/osirus rendering) are respected.
- **Type consistency:** `waveCellIndices` / `drawWave` / `uniqueShapeIds` / `shapeIds` / `waveShape` are each defined once and used with the same names and signatures throughout.
- **Known risk:** Task 1's remaps move existing LFO baselines. Step 6 of that task is the checkpoint — an unrelated baseline moving means a mapping was stolen from another list.
