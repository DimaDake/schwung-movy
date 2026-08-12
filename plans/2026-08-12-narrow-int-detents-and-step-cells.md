# Narrow-Int Detents & Step Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make narrow discrete parameters take 4 clicks per step instead of 1, and show octave-like and voice-count parameters as a framed number instead of an arc.

**Architecture:** Two independent rules, both keyed off metadata movy already has. The
tick rate lives in `model/knob-step.ts` next to the existing per-detent step rule and
is applied in `applyKnobDelta` through the shared `countDetents` accumulator. The cell
look is decided once at hierarchy-load time by a new `model/step-labels.ts`, which
replaces `inferRenderStyle`; the renderer gains one branch reusing the existing
`drawEnumSquare`. Params stay `type: 'int'` throughout — the DSP wire format, clamping,
automation, undo and the long-press overlay gate are all untouched.

**Tech Stack:** TypeScript → `ui.js` (esbuild), QuickJS shadow-UI runtime, node
`browser-test/*.mjs` suites.

## Global Constraints

- Files: hard limit 200 lines, target 50–100. `src/model/store.ts` is already at 330 — do not grow it; put new rules in their own file.
- `model/` never calls display functions; `renderer/` holds no state.
- Comments explain WHY, never WHAT.
- Narrow range means `max - min` between 2 and 8 inclusive. Range 1 (`0..1` toggles) is explicitly excluded from both rules and must not change at all.
- Detents per step for narrow ints = `ENUM_DELTA_DIV` (4), reusing the constant so the feel matches the enum knobs rather than introducing a second number.
- Octave labels are signed (`+1`) only when `min < 0`; counts are always unsigned.
- Box params keep `type: 'int'`. Never synthesize an `options` array for them — writing `"+1"` where the DSP expects `1` is the mrdrums `"loop"` failure (value coerced, read back, knob snaps back).
- No label arrays: the box receives the single already-formatted `displayValue`, because `sfz voices` runs 1..128.

---

### Task 1: Narrow ints take 4 clicks per step

**Files:**
- Modify: `src/model/knob-step.ts` (add `detentsPerStep`)
- Modify: `src/seq/detent.ts:9-16` (accept a divisor; tolerate a sparse accum array)
- Modify: `src/model/store.ts:131-200` (`applyKnobDelta`)
- Modify: `src/model/state.ts` (add `detentAccum`), `src/model/hierarchy.ts` (clear it)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `perDetentStep(p)` from `src/model/knob-step.ts`, `countDetents` from `src/seq/detent.ts`.
- Produces: `detentsPerStep(p: KnobParam): number` and `NARROW_RANGE_MAX = 8` from `src/model/knob-step.ts`; `ModelState.detentAccum: number[]`.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:

```js
_log('\nTest: narrow discrete params take four clicks per step');
{
  const { applyKnobDelta } = await import('../dist/esm/model/store.js');
  const mkP = (min, max, type = 'int', step = 1, extra = {}) => ({
    key: 'p', label: 'p', shortLabel: null, type, min, max, step,
    options: null, renderStyle: 'arc', automatable: true, ...extra,
  });
  const st = (p, value) => ({
    activeSlot: 0, componentKey: 'synth', knobPage: 0, moduleConfig: null,
    knobParams: [p], knobValues: [value], enumFmt: [undefined], fileValues: [null],
    slotMapCache: null, paramGestures: {}, triggerStates: {}, detentAccum: [],
    dirty: false,
  });
  const writes = [];
  const origSet = globalThis.shadow_set_param;
  globalThis.shadow_set_param = (_s, k, v) => { writes.push([k, v]); return true; };

  // One click at a time: nothing moves until the fourth.
  const s = st(mkP(-2, 2), 0);
  const seen = [];
  for (let i = 0; i < 8; i++) { applyKnobDelta(s, 0, 1); seen.push(s.knobValues[0]); }
  eq('narrow int: 4 clicks per step up', JSON.stringify(seen),
    JSON.stringify([0, 0, 0, 1, 1, 1, 1, 2]));
  // Counter-clockwise is the mirror image.
  const d = st(mkP(-2, 2), 2);
  const seenDown = [];
  for (let i = 0; i < 8; i++) { applyKnobDelta(d, 0, -1); seenDown.push(d.knobValues[0]); }
  eq('narrow int: 4 clicks per step down', JSON.stringify(seenDown),
    JSON.stringify([2, 2, 2, 1, 1, 1, 1, 0]));
  // A sub-step turn writes nothing at all: no IPC, no undo entry.
  writes.length = 0;
  const q = st(mkP(0, 3), 1);
  applyKnobDelta(q, 0, 1);
  applyKnobDelta(q, 0, 1);
  eq('sub-step turn writes nothing', writes.length, 0);
  applyKnobDelta(q, 0, 2);
  eq('crossing the step writes once', writes.length, 1);
  eq('crossing the step moves by one', q.knobValues[0], 2);
  // A batched flush of 4 detents moves one step, like 4 separate clicks.
  const b = st(mkP(1, 8), 4);
  applyKnobDelta(b, 0, 4);
  eq('batched 4 detents = one step', b.knobValues[0], 5);
  // Excluded: 0..1 toggles, wide ranges, floats, and 'wide' acceleration.
  const t = st(mkP(0, 1, 'int', 1, { renderStyle: 'hbar' }), 0);
  applyKnobDelta(t, 0, 1);
  eq('0..1 toggle still flips on one click', t.knobValues[0], 1);
  const w = st(mkP(0, 100), 50);
  applyKnobDelta(w, 0, 1);
  eq('wide int unchanged: one unit per click', w.knobValues[0], 51);
  const f = st(mkP(0, 1, 'float', 0.01), 0.5);
  applyKnobDelta(f, 0, 1);
  eq('float unchanged', Math.abs(f.knobValues[0] - 0.505) < 1e-9, true);
  globalThis.shadow_set_param = origSet;
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "✗"`
Expected: FAIL — `narrow int: 4 clicks per step up` reports `[1,2,2,...]` because every click still moves a whole unit.

- [ ] **Step 3: Generalize the shared accumulator**

Replace the body of `countDetents` in `src/seq/detent.ts`. The divisor becomes a
parameter (existing callers keep `DETENT_DIV`), and a missing slot counts as 0 so
callers can pass a sparse array:

```ts
/** Accumulate raw delta for knob `k` into `accum`; return the number of whole
 *  ±1 detents consumed, keeping the remainder in `accum[k]`. `div` is how many
 *  raw units make one detent. */
export function countDetents(accum: number[], k: number, delta: number, div = DETENT_DIV): number {
    let rem = (accum[k] ?? 0) + delta;
    let n = 0;
    while (rem >= div)  { rem -= div; n++; }
    while (rem <= -div) { rem += div; n--; }
    accum[k] = rem;
    return n;
}
```

- [ ] **Step 4: Add the rate rule to `src/model/knob-step.ts`**

Import `ENUM_DELTA_DIV` alongside the existing constants and append:

```ts
/* A range this narrow or narrower is stepped rather than swept. */
export const NARROW_RANGE_MAX = 8;

/* Physical clicks per value step. A handful of discrete values spread over a
 * whole knob is a hair trigger — one click crossing a quarter of an octave
 * param's range is what made it "too fast in the middle" — so narrow ints are
 * stepped at the same rate as the enum knobs (ENUM_DELTA_DIV), which is what a
 * module publishing its octave as an enum already feels like.
 *
 * A range of 1 is an on/off switch drawn as a bar: it never had the fractional
 * step problem and a switch that needs four clicks to flip is worse, so it is
 * left alone. 'wide' acceleration owns its own rate. */
export function detentsPerStep(p: KnobParam): number {
    if (p.type !== 'int' || p.knobAcceleration === 'wide') return 1;
    const range = p.max - p.min;
    return range >= 2 && range <= NARROW_RANGE_MAX ? ENUM_DELTA_DIV : 1;
}
```

- [ ] **Step 5: Add the accumulator to `ModelState`**

In `src/model/state.ts`, declare next to `slotMapCache`:

```ts
    /* Sub-step turn progress per param index, for knobs that need several
     * clicks per value (knob-step.ts:detentsPerStep). Cleared on a module
     * change so a half-finished turn cannot leak into another module's knob. */
    detentAccum:         number[];
```

and initialise it in the factory: `detentAccum: [],`.

In `src/model/hierarchy.ts`, wherever `slotMapCache` is reset during
`loadHierarchy`, add `s.detentAccum = [];` on the same line group.

- [ ] **Step 6: Apply it in `applyKnobDelta`**

In `src/model/store.ts`, import `detentsPerStep` from `./knob-step.js` and
`countDetents` from `../seq/detent.js`. Immediately before the `const scaled =`
line, insert:

```ts
    /* Several clicks per step for a narrow range. Returning early on a turn that
     * has not yet crossed a step is deliberate: no set_param, and no undo entry
     * for an edit that changed nothing. */
    const div = detentsPerStep(p);
    let steps = delta;
    if (div > 1) {
        steps = countDetents(s.detentAccum, gi, delta, div);
        if (steps === 0) return;
    }
```

and change the continuous branch of `scaled` to use `steps`:

```ts
    const scaled = p.type === 'enum' ? delta / ENUM_DELTA_DIV
        : p.knobAcceleration === 'wide' ? wideStepCount(s, p, delta) * p.step
        : steps * perDetentStep(p);
```

- [ ] **Step 7: Run the tests**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: ALL LOGIC CHECKS PASSED, including the earlier direction-symmetry block.

- [ ] **Step 8: Commit**

```bash
git add src/model/knob-step.ts src/model/state.ts src/model/hierarchy.ts \
        src/model/store.ts src/seq/detent.ts browser-test/logic.mjs
git commit -m "Step narrow discrete params four clicks per value"
```

---

### Task 2: Octave and voice-count params resolve to a step cell

**Files:**
- Create: `src/model/step-labels.ts`
- Modify: `src/types/param.ts` (`renderStyle` union, `signed?`), `src/types/viewmodel.ts` (`renderStyle` union)
- Modify: `src/model/param-build.ts:17-19,69-87`, `src/model/config-pages.ts:81-88`, `src/model/store.ts:formatValue`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `cellStyleFor(key: string, type: KnobParam['type'], min: number, max: number): { renderStyle: KnobParam['renderStyle']; signed?: boolean }` from `src/model/step-labels.ts`. Replaces `inferRenderStyle`, which is deleted.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:

```js
_log('\nTest: octave and voice-count params become step cells');
{
  const { cellStyleFor } = await import('../dist/esm/model/step-labels.js');
  const { formatValue } = await import('../dist/esm/model/store.js');
  const style = (key, min, max, type = 'int') => {
    const c = cellStyleFor(key, type, min, max);
    return c.renderStyle + (c.signed ? '+' : '');
  };
  // Octave-like, signed because the range is a transpose.
  eq('obxd octave -2..2',            style('octave', -2, 2),             'steps+');
  eq('octave_transpose -3..3',       style('octave_transpose', -3, 3),   'steps+');
  eq('lane1_octave -3..3',           style('lane1_octave', -3, 3),       'steps+');
  eq('nusaw sub_octave -2..0',       style('sub_octave', -2, 0),         'steps+');
  eq('moog osc1_range -2..2',        style('osc1_range', -2, 2),         'steps+');
  // Octave-like counts are unsigned.
  eq('helm arp_octaves 1..4',        style('arp_octaves', 1, 4),         'steps');
  // Voice counts are unsigned at any width.
  eq('obxd voice_count 1..8',        style('voice_count', 1, 8),         'steps');
  eq('freak unison 1..8',            style('unison', 1, 8),              'steps');
  eq('granny active_voices 0..8',    style('active_voices', 0, 8),       'steps');
  eq('forge cho_voices 2..8',        style('cho_voices', 2, 8),          'steps');
  eq('helm osc_1_unison_voices',     style('osc_1_unison_voices', 1, 15),'steps');
  eq('mrdrums g_polyphony 1..64',    style('g_polyphony', 1, 64),        'steps');
  eq('sfz voices 1..128',            style('voices', 1, 128),            'steps');
  // Excluded: toggles stay bars.
  eq('helm sub_octave 0..1',         style('sub_octave', 0, 1),          'hbar');
  eq('obxd unison 0..1',             style('unison', 0, 1),              'hbar');
  eq('obxd bend_range 0..1',         style('bend_range', 0, 1),          'hbar');
  // Excluded: too wide to be an octave, amounts, randomisers, non-ints.
  eq('genera octaves 0..100',        style('octaves', 0, 100),           'arc');
  eq('lane1_oct_seed 0..65535',      style('lane1_oct_seed', 0, 65535),  'arc');
  eq('signal rnd_voices 0..127',     style('rnd_voices', 0, 127),        'arc');
  eq('obxd unison_det 0..100',       style('unison_det', 0, 100),        'arc');
  eq('osirus unison_detune 0..127',  style('unison_detune', 0, 127),     'arc');
  eq('hera pitch_range 0..2',        style('pitch_range', 0, 2),         'arc');
  eq('obxd legato 0..3',             style('legato', 0, 3),              'arc');
  eq('obxd cutoff 0..100',           style('cutoff', 0, 100),            'arc');
  eq('float octave-named stays arc', style('octave', -2, 2, 'float'),    'arc');
  // The sign shows up in the value text, so box and touched readout agree.
  const p = (signed) => ({ key: 'octave', label: 'Octave', shortLabel: null, type: 'int',
    min: -2, max: 2, step: 1, options: null, renderStyle: 'steps', automatable: true,
    ...(signed ? { signed: true } : {}) });
  eq('signed int shows +1',  formatValue(p(true), 1),   '+1');
  eq('signed int shows 0',   formatValue(p(true), 0),   '0');
  eq('signed int shows -2',  formatValue(p(true), -2),  '-2');
  eq('count shows 4 unsigned', formatValue(p(false), 4), '4');
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -3`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `dist/esm/model/step-labels.js`.

- [ ] **Step 3: Create `src/model/step-labels.ts`**

```ts
/* Which knobs are drawn as a framed number instead of an arc. An arc shows a
 * position in a range, which is the wrong reading for a value the user thinks of
 * by name: an octave offset or a voice count. The cell normally shows the
 * param's NAME (renderer/label.ts) and its value only while the knob is
 * touched, so these params were numbers you could not see without touching. */
import type { KnobParam } from '../types/param.js';
import { NARROW_RANGE_MAX } from './knob-step.js';

/* `oct`, `octave`, `octaves` as a whole word: octave, octave_transpose,
 * sub_octave, lane1_octave, arp_octaves. */
const OCTAVE_LIKE = /(^|_)oct(ave|aves)?(_|$)/;
/* Moog's oscN_range is an octave selector by meaning (the Model D's 32'..2'
 * switch). Only when signed — hera's pitch_range 0..2 is a bend depth. */
const SIGNED_RANGE = /_range$/;
/* A count of voices, at any width. Excludes amounts (unison_det,
 * unison_detune, unison_pan_spread) by requiring a count word. */
const COUNT_LIKE   = /voice_count|voices|polyphony/;

export function cellStyleFor(
    key: string, type: KnobParam['type'], min: number, max: number,
): { renderStyle: KnobParam['renderStyle']; signed?: boolean } {
    if (type === 'int' && min === 0 && max === 1) return { renderStyle: 'hbar' };
    if (type !== 'int' || max - min < 2) return { renderStyle: 'arc' };
    const k = key.toLowerCase();
    /* A randomiser is an amount or an action, never the thing it names. */
    if (k.includes('rnd')) return { renderStyle: 'arc' };
    if (COUNT_LIKE.test(k) || k === 'unison') return { renderStyle: 'steps' };
    if (max - min > NARROW_RANGE_MAX) return { renderStyle: 'arc' };
    if (OCTAVE_LIKE.test(k) || (SIGNED_RANGE.test(k) && min < 0))
        return min < 0 ? { renderStyle: 'steps', signed: true } : { renderStyle: 'steps' };
    return { renderStyle: 'arc' };
}
```

- [ ] **Step 4: Widen the types**

In `src/types/param.ts`, change `KnobParam.renderStyle` to
`'arc' | 'hbar' | 'vbar' | 'preset' | 'xbox' | 'steps'` and add after it:

```ts
    /** Step cell whose value reads as an offset: show a leading + above zero. */
    signed?:        boolean;
```

In `src/types/viewmodel.ts`, add `'steps'` to `ParamVM.renderStyle` the same way
and extend the trailing comment with `steps = framed number (octave/voice count)`.

- [ ] **Step 5: Route both builders through it**

In `src/model/param-build.ts`, delete `inferRenderStyle` entirely, import
`cellStyleFor` from `./step-labels.js`, and in `buildGenericParam` replace the
`renderStyle:` line with a spread so `signed` rides along:

```ts
        ...cellStyleFor(key, type as KnobParam['type'], min, max),
```

In `src/model/config-pages.ts:81-88`, replace the `renderStyle` const and its use:

```ts
                const style = slot.render
                    ? { renderStyle: slot.render }
                    : cellStyleFor(key, type as KnobParam['type'], min, max);
```

then spread `...style,` where `renderStyle` was passed, and change the
`capturesModuleState` line to read `style.renderStyle === 'preset'`.

- [ ] **Step 6: Sign the value text in `formatValue`**

In `src/model/store.ts`, replace the `if (p.type === 'int')` line of `formatValue`:

```ts
    if (p.type === 'int') {
        const n = Math.round(v);
        return (p.signed && n > 0 ? '+' : '') + n;
    }
```

- [ ] **Step 7: Run the tests**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: ALL LOGIC CHECKS PASSED. `npm run typecheck` must be clean — it is what
catches any remaining `inferRenderStyle` import.

- [ ] **Step 8: Commit**

```bash
git add src/model/step-labels.ts src/model/param-build.ts src/model/config-pages.ts \
        src/model/store.ts src/types/param.ts src/types/viewmodel.ts browser-test/logic.mjs
git commit -m "Resolve octave and voice-count knobs to a step cell"
```

---

### Task 3: Draw the step cell

**Files:**
- Modify: `src/renderer/knob.ts:194-217` (`drawKnobWidget`)
- Test: `browser-test/screenshot.mjs` + baselines under `browser-test/screenshots/baseline/`

**Interfaces:**
- Consumes: `ParamVM.renderStyle === 'steps'` and `ParamVM.displayValue` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Add the branch**

In `drawKnobWidget`, directly after the `pvm.type === 'file'` branch (which already
boxes a single string), add:

```ts
    } else if (pvm.renderStyle === 'steps') {
        /* One pre-formatted string, not an options array — sfz's voice count runs
         * to 128 and building a label per value every frame would be absurd. */
        drawEnumSquare(kx, ky, [pvm.displayValue], 0);
```

- [ ] **Step 2: See which committed baselines move**

Run: `npm run build:browser && node browser-test/screenshot.mjs`
Expected: FAIL on the scenes whose pages hold a step cell — `obxd_main_page` (the
Global page: octave, octave_transpose, voice_count) and any `forge_*` scene showing
`cho_voices`. Note the exact list the run prints.

- [ ] **Step 3: Confirm each diff is the intended change**

For every failing scene, open `browser-test/screenshots/actual/<name>.png` beside
`baseline/<name>.png` and check that the only difference is an arc replaced by a
framed number, and that the number reads correctly (`+1`/`-2` for an octave, plain
for a count). If any other cell changed, stop — the rule caught a param it should
not have.

- [ ] **Step 4: Add a scene that pins a signed octave and a count together**

In `browser-test/screenshot.mjs`, add `'obxd_global_steps'` to `PRESETS` and a case
beside the other obxd scenes. Use the page index that the Task 3 Step 2 run showed
holds octave; touch nothing, so the cells render in their resting state:

```js
        case 'obxd_global_steps': model.changePage(1); forceRender(); break;
```

If `obxd_main_page` already renders that page, keep the new scene anyway but point it
at the Filter/Voice page holding `voice_count`, so a count cell is pinned too.

- [ ] **Step 5: Regenerate and re-run**

Run: `node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs`
Expected: `0 failed`, and `git status` shows only the baselines identified in Step 2
plus the new scene's baseline.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/knob.ts browser-test/screenshot.mjs \
        browser-test/screenshots/baseline/
git commit -m "Draw octave and voice-count cells as a framed number"
```

---

### Task 4: Freeze the classification across all 78 dumped modules

**Files:**
- Modify: `browser-test/dump-replay.mjs` (`snapshot`, `checkExpect`, `checkKnobStepSymmetric`)
- Modify: `browser-test/dump-expect.json` (via `--update`)
- Modify: `build/browser.mjs` (expose `step-labels` as an entry point)

**Interfaces:**
- Consumes: `detentsPerStep` (Task 1), `cellStyleFor` (Task 2).
- Produces: `stepCells` and `slowCells` fields in every `dump-expect.json` entry.

- [ ] **Step 1: Expose the module to the browser build**

In `build/browser.mjs`, add `resolve(root, 'src/model/step-labels.ts'),` next to the
existing `knob-step.ts` entry.

- [ ] **Step 2: Extend the snapshot and the invariant**

In `browser-test/dump-replay.mjs`, import `detentsPerStep` from
`../dist/esm/model/knob-step.js` (alongside `perDetentStep`), then add to the object
`snapshot()` returns:

```js
        /* Which knobs read as a framed number and which are stepped rather than
         * swept. Frozen per module because the rules are name-based: a future
         * naming tweak that quietly recruits or drops a param shows up here as a
         * named diff instead of as a surprise on the device. */
        stepCells: model.dumpLayout().params
            .filter(p => p?.renderStyle === 'steps')
            .map(p => p.key + (p.signed ? ' +' : '')).sort(),
        slowCells: model.dumpLayout().params
            .filter(p => p && detentsPerStep(p) > 1).map(p => p.key).sort(),
```

Add both to the field loop in `checkExpect`, which compares by JSON:

```js
    for (const field of ['stepCells', 'slowCells']) {
        check(`${key}: ${field} = ${JSON.stringify(expect[field])} (got ${JSON.stringify(snap[field])})`,
            JSON.stringify(snap[field]) === JSON.stringify(expect[field]));
    }
```

And inside `checkKnobStepSymmetric`, assert the toggle exclusion that must never
regress:

```js
        if (p.max - p.min <= 1) {
            check(`${key}: toggle ${p.key} keeps one click per flip`, detentsPerStep(p) === 1);
            check(`${key}: toggle ${p.key} is not a step cell`, p.renderStyle !== 'steps');
        }
        if (p.renderStyle === 'steps') {
            check(`${key}: step cell ${p.key} is an int`, p.type === 'int');
        }
```

Note the existing `continue` guards at the top of that loop skip file/enum/trigger
params before this code runs, which is correct — those are not step cells.

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm run build:browser && node browser-test/dump-replay.mjs 2>&1 | tail -3`
Expected: FAIL — every module reports `stepCells`/`slowCells` missing from
`dump-expect.json`.

- [ ] **Step 4: Regenerate the snapshot and review the diff**

Run: `node browser-test/dump-replay.mjs --update && git diff --stat browser-test/dump-expect.json`

Then read the diff and check it against the agreed scope: 45 `stepCells` across 28
modules (25 oct-named + 4 moog `oscN_range` + 16 voice counts), and no `stepCells`
or `slowCells` entry for any `0..1` param. Spot-check `obxd` (`octave +`,
`octave_transpose +`, `voice_count`), `moog` (`osc1_range +`..`osc4_range +`),
`sfz` (`voices`), and `helm` (`arp_octaves` unsigned, `sub_octave` absent).

- [ ] **Step 5: Re-run to confirm green**

Run: `node browser-test/dump-replay.mjs`
Expected: ALL DUMP-REPLAY CHECKS PASSED (78 modules).

- [ ] **Step 6: Commit**

```bash
git add build/browser.mjs browser-test/dump-replay.mjs browser-test/dump-expect.json
git commit -m "Freeze step-cell and slow-detent classification across the fleet"
```

---

### Task 5: Documentation and device verification

**Files:**
- Modify: `MANUAL.md` (section 2, Parameter pages), `CHANGELOG.md` (`[Unreleased]`)
- Test: `npm test`, `node browser-test/screenshot.mjs`, `./scripts/test.sh`

**Interfaces:** none.

- [ ] **Step 1: Replace the knob-response paragraph in `MANUAL.md`**

The `[Unreleased]` bug fix already added a paragraph after "Turning a knob edits the
parameter live." Extend it so the two new behaviours are described:

```markdown
Knobs are normalised so a full sweep feels the same on every parameter whatever
its units — about a hundred clicks from end to end — and a parameter with
discrete values (an octave, a voice count, a mode) moves in whole steps instead.
Either way a click moves the same distance clockwise and counter-clockwise, and
turning faster covers proportionally more ground rather than less.

A parameter with only a handful of values takes four clicks per step, so a five-
position octave is no longer a quarter-turn per octave. On/off switches still
flip on a single click. Octave offsets and voice counts are drawn as a framed
number rather than an arc — an octave shows its sign, so you can read `+1` or
`-2` without touching the knob.
```

- [ ] **Step 2: Add the `CHANGELOG.md` entries**

Under the existing `## [Unreleased]`, add an `### Changed` section above `### Fixed`:

```markdown
### Changed

- **A handful of values no longer means a hair trigger.** Any discrete parameter
  with eight values or fewer now takes four clicks per step — the rate Movy's
  enum knobs already used — so OB-Xd's five-position octave takes a deliberate
  turn instead of crossing its whole range in four clicks. On/off switches are
  untouched and still flip on a single click.
- **Octave offsets and voice counts read as numbers, not arcs.** 45 parameters
  across 28 modules (every `octave`/`octave_transpose`, Moog's oscillator ranges,
  and every voice count from `obxd voice_count` to `sfz voices`) are drawn as a
  framed value, with a sign on the offsets. The cell otherwise shows the
  parameter's name and revealed its value only while the knob was touched.
```

- [ ] **Step 3: Run every local suite**

Run: `npm test && node browser-test/screenshot.mjs`
Expected: all five suites pass, `0 failed` on screenshots.

- [ ] **Step 4: Verify on device**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: ALL CHECKS PASSED. If the device is offline, report it to the user in CAPS.

- [ ] **Step 5: Commit and push**

```bash
git add MANUAL.md CHANGELOG.md
git commit -m "Document stepped narrow params and framed octave/count cells"
git push
```

---

## Self-Review

**Spec coverage:** 4-click rate for range 2–8 → Task 1. Toggles untouched → Task 1
(test) + Task 4 (fleet assertion). Octave rule incl. moog `_range` and signed labels →
Task 2. Voice-count rule at any width → Task 2. Box rendering with a single string →
Task 3. Scope list enforced across 78 modules → Task 4. Docs + device → Task 5.

**Types:** `cellStyleFor(key, type, min, max)` is defined in Task 2 Step 3 and used in
Task 2 Step 5 and Task 4 Step 2 with that signature. `detentsPerStep(p)` is defined in
Task 1 Step 4 and used in Task 1 Step 6 and Task 4 Step 2. `NARROW_RANGE_MAX` is
exported by `knob-step.ts` (Task 1) and imported by `step-labels.ts` (Task 2) — that
direction matters, since `knob-step.ts` must not import `step-labels.ts` back.

**Known ordering constraint:** Task 3 cannot be verified before Task 2 lands (no
`'steps'` param exists to draw), and Task 4's snapshot needs both. Task 1 is
independent of all three.
