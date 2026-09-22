# SP-57 — Virtual page alignment (host-side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three migrated virtual pages — step params, clip params, set
params — feel and read like the pages they replaced, using Schwung's own
widgets and movy's own seam, with no upstream dependency.

**Architecture:** Everything here goes through the contract movy already writes
(`chain_params`, via `createVirtualSource`) or through the input binding movy
already owns (`schwung-page-input.ts`). No movy widget is registered, no
Schwung file is patched, and nothing outside the three virtual components
changes behaviour — every new seam is gated on the source that supplies it.

**Tech Stack:** TypeScript → `ui.js` (esbuild), QuickJS on device; Schwung
`param_pages` consumed as a library; `browser-test/` (node) for logic and
pixels; `test-device/` (TypeScript) for the device tier.

**Spec:** `docs/superpowers/specs/2026-09-22-virtual-page-alignment-design.md`
— read it first; every task below cites the finding (F*) or item (H*) it
implements.

## Global Constraints

- **Native first, not pixel identity** (spec ruling 1). Use Schwung's own
  widgets. Do not register a movy widget and do not restore movy's old cell
  styles.
- **Nothing outside the three virtual components may change** — feel, pixels or
  reads. Every new hook is optional and absent on a real module's port.
- **Schwung is read-only.** `schwung/` and `schwung-davebox/` are reference
  checkouts. A change Schwung needs is the upstream plan
  (`plans/su-16-19-upstream-page-bundle.md`), never a local patch.
- **File size:** 200 lines hard limit in `src/`, ~600 in `browser-test/` and
  `test-device/`.
- **Comments explain WHY** — constraints, invariants, workarounds — never what
  the code literally does.
- **Teeth are mandatory.** Every fix is reverted individually and the new test
  watched red before the task is called done. Assert the condition, never the
  label (`ok(label, cond)` has silently ignored its condition before).
- **Both gates run at the end of every task that touches code:**
  `SCHWUNG=../schwung npm test` (0 failures) and, when `move.local` answers,
  `npm run test:device`. Without `SCHWUNG=` every Schwung assertion is SKIPPED,
  not failed. If the device is unreachable, say **DEVICE OFFLINE** in caps.
- **Run `./scripts/run-gate.sh preflight` before starting Task 1**, to know the
  gate is green for its own reasons before any of this is blamed for it.

---

## File structure

| file | responsibility | task |
| --- | --- | --- |
| `src/renderer/schwung-page-source.ts` | the seam's interface — gains one optional member, `rawPerDetent` | 2 |
| `src/renderer/schwung-virtual-source.ts` | contract builder — gains `viz` passthrough and answers `rawPerDetent` | 1, 2 |
| `src/renderer/schwung-page-input.ts` | the gesture binding — gains the detent accumulator and the two-option write | 2, 3 |
| `src/renderer/schwung-page.ts` | `SchwungPage` interface — gains `peekOpen()` | 5 |
| `src/renderer/schwung-page-render.ts` | implements `peekOpen()` off `ctl.enumPeek()` | 5 |
| `src/app/page-poll.ts` | the repaint decision — the peek joins the comparison | 5 |
| `src/seq/step-params-contract.ts` | VEL's fader + step, COND/LEN readings | 1, 2, 4 |
| `src/seq/clip-params-contract.ts` | LENGTH's reading | 4 |
| `src/seq/set-params-contract.ts` | SWING/TEMPO readings | 4 |
| `browser-test/logic/step-params-source.mjs` | contract assertions for the step page | 1, 2, 4 |
| `browser-test/logic/knob-input.mjs` | the detent accumulator and the two-option write | 2, 3 |
| `browser-test/logic/page-freshness.mjs` | the peek's effect on the repaint decision | 5 |
| `test-device/scenarios/page-dive.ts` | F2's diagnosis and its regression check | 6 |
| `docs/schwung-page-migration.md`, `MANUAL.md` | the ledger entry and the user-facing docs | 7 |

---

### Task 1: Velocity draws Schwung's fader (H1)

The contract builder drops any `viz` a cell declares — `chainParamsJson` emits
`key/name/type` plus `short_name` and the options-or-range pair, and nothing
else. So the declaration has to be carried before it can be made.

**Files:**
- Modify: `src/renderer/schwung-virtual-source.ts` (`VirtualCellSpec`, `chainParamsJson`)
- Modify: `src/seq/step-params-contract.ts` (the `vel` cell)
- Test: `browser-test/logic/step-params-source.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VirtualCellSpec.viz?: Record<string, unknown>` — carried verbatim
  into each `chain_params` entry as `viz`. Tasks 2 and 4 add sibling optional
  fields to the same interface.

- [ ] **Step 1: Write the failing test**

Append to the first block of `browser-test/logic/step-params-source.mjs`
(the block that needs no schwung checkout):

```js
/* H1. The fader is DECLARED, not detected: no detector claims `vel` (spec F1),
 * so without this the cell draws Schwung's ordinary arc. The assertion is on
 * the contract string because that is the whole of movy's side of it — the
 * pixels are pinned by the `page_stepparams` baseline. */
{
    const src = stepParamsSource();
    const params = JSON.parse(src.getParam(STEP_PARAMS_COMPONENT + ':chain_params'));
    const vel = params.find((p) => p.key === 'vel');
    ok('step vel declares the fader viz',
       !!vel && !!vel.viz && vel.viz.kind === 'fader');
    ok('no other step cell declares a viz',
       params.filter((p) => p.viz).length === 1);
}
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A2 "step page virtual source"
```

Expected: FAIL on `step vel declares the fader viz` — `vel.viz` is `undefined`,
because `chainParamsJson` never emits the field.

- [ ] **Step 3: Carry `viz` through the contract builder**

In `src/renderer/schwung-virtual-source.ts`, add to `VirtualCellSpec` (beside
`shortName`):

```ts
    /** A DECLARED graphic, carried verbatim into `chain_params`. `param_meta`
     *  folds a chain entry's `viz` straight onto the meta and `viz.mjs`'s
     *  `collectDeclared` builds a single-key group from it, so this reaches
     *  Schwung's own widget with no override hook and no registration. It is
     *  the only way a virtual cell gets a graphic: no detector claims any of
     *  these keys (SP-57 F1). */
    viz?: Record<string, unknown>;
```

and in `chainParamsJson`, immediately after the `short_name` line:

```ts
            if (c.viz) entry.viz = c.viz;
```

- [ ] **Step 4: Declare the fader on VEL**

In `src/seq/step-params-contract.ts`, the `vel` cell becomes:

```ts
    {
        key: 'vel', name: 'Velocity', shortName: 'VEL', type: 'int', min: 0, max: 127, step: 4,
        /* The `vbar` picture SP-54 gave up, taken back as Schwung's OWN fader
         * rather than a movy widget (SP-57 ruling 1). Declared because nothing
         * detects it: the fader detector works on NAME and `vel` is not one of
         * the fourteen it takes, so the cell drew an arc. A unipolar 0..127
         * level is exactly what `drawFader` draws honestly. */
        viz: { kind: 'fader' },
        get: () => String(seqState.holdVel),
        set: (v) => applyStepVelocityAbs(asIndex(v)),
    },
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A2 "step page virtual source"
```

Expected: PASS, both assertions.

- [ ] **Step 6: Prove the teeth**

Comment out the `if (c.viz) entry.viz = c.viz;` line, re-run Step 5, and
confirm the first assertion goes red. Restore it.

- [ ] **Step 7: Re-baseline the step page screenshot and look at it**

```bash
SCHWUNG=../schwung node browser-test/screenshot.mjs --update
node scripts/make-doc-assets.mjs page_stepparams   # 4x, for eyeballing
```

Open `docs/assets/page_stepparams.png` and confirm the VEL cell is a fader
whose fill tracks the held velocity — not an arc, not an empty cell. A
`custom:` kind that fails to draw degrades to the built-in silently, so
"the baseline changed" is not by itself proof the fader appeared.

- [ ] **Step 8: Full local gate**

```bash
SCHWUNG=../schwung npm test
```

Expected: 0 failures; `screenshot.mjs` reports the new baseline count with only
`page_stepparams` moved.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/schwung-virtual-source.ts src/seq/step-params-contract.ts \
        browser-test/logic/step-params-source.mjs \
        browser-test/screenshots/baseline/page_stepparams.png
git commit -m "SP-57: step velocity draws Schwung's own fader

A virtual cell had no way to declare a graphic — chainParamsJson emitted
key/name/type, short_name and the range, and dropped anything else — so VEL
drew an arc. No detector claims it either (F1: the fader detector matches on
name and 'vel' is not one of the fourteen), which is why SP-54 recorded the
vbar as lost.

VirtualCellSpec gains an optional viz carried verbatim into chain_params,
which param_meta folds onto the meta and viz.mjs turns into a single-key
group — Schwung's own drawFader, no movy widget and no registration."
```

---

### Task 2: One knob rule for the three pages (H2, F5)

Old movy charged 8 raw CC units per step on every cell of these pages
(`mainPageKnob`, `clipPageKnob`, and `countDetents`'s `DETENT_DIV = 8`).
Delegation feeds one detent per raw unit into `ENUM_DELTA_DIV = 4`, so enums run
at twice the old rate; velocity changed shape as well (flat ±4 per CC event
before, magnitude-scaled now).

The fix has two halves: how many raw units make one controller detent (a new
optional member on the source), and what one detent is worth (each cell's
declared `step`, chosen against `perDetentStep`).

**Files:**
- Modify: `src/renderer/schwung-page-source.ts` (`PageParamSource`)
- Modify: `src/renderer/schwung-virtual-source.ts` (answer `rawPerDetent`)
- Modify: `src/renderer/schwung-page-input.ts` (`knobTurn`)
- Modify: `src/seq/step-params-contract.ts` (VEL's `step`)
- Test: `browser-test/logic/knob-input.mjs`, `browser-test/logic/step-params-source.mjs`

**Interfaces:**
- Consumes: `VirtualCellSpec` from Task 1.
- Produces: `PageParamSource.rawPerDetent?(fullKey: string): number | null` —
  how many raw CC units make one `ctl.onKnobTurn` call for that key. Absent or
  null means 1, which is today's behaviour and what every real port answers.

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic/step-params-source.mjs`, first block:

```js
/* H2. The DIVISOR half of the rule. Enum cells are asked for one detent per 2
 * raw units because Schwung then spends 4 of them per option (ENUM_DELTA_DIV),
 * which lands on old movy's 8 raw units per step; int cells are asked for one
 * per 8 because one detent already moves one step. */
{
    const src = stepParamsSource();
    const per = (k) => src.rawPerDetent(STEP_PARAMS_COMPONENT + ':' + k);
    ok('enum cells cost 2 raw units per detent', per('len') === 2 && per('prob') === 2);
    ok('int cells cost 8 raw units per detent', per('vel') === 8);
    ok('an unknown key falls through to 1', per('nosuchkey') === null);
}

/* The STEP half: one Schwung detent must be one step, which for an int is
 * round(max(step, range * 0.01) * 0.5). At step 4 that is 2 — half a velocity
 * step — so the declaration moves to 8. */
{
    const src = stepParamsSource();
    const params = JSON.parse(src.getParam(STEP_PARAMS_COMPONENT + ':chain_params'));
    const vel = params.find((p) => p.key === 'vel');
    const perDetent = Math.round(Math.max(vel.step, (vel.max - vel.min) * 0.01) * 0.5);
    ok('one detent moves velocity by 4', perDetent === 4);
}
```

Append a new block inside `browser-test/logic/knob-input.mjs`'s `run()`. **The
file's harness import list is narrower than these tests need** — it currently
takes `createModel, portFor, enumRawToIndex, enumUsesIndex, enumSetValue,
MOCK_SYNTHS, eq, bootModel, _log, env`. Add `ok`, `appState`,
`schwungLibAvailable`, `schwungPageFor`, `setSchwungGridMode` and
`schwungGridReload` to it.

```js
_log('\nlogic: virtual-page knob feel (SP-57 H2)');
{
    const { countDetents } = await import('../../dist/esm/seq/detent.js');
    const accum = [];
    /* Eight raw units is one step, and a turn split across two CC events must
     * land in the same place as one event carrying all of it — the remainder
     * carries. A dropped remainder is what made a movy knob move on one turn
     * direction and not the other. */
    eq('8 raw units = 1 detent', countDetents(accum, 0, 8, 8), 1);
    eq('4 + 4 = 1 detent', countDetents(accum, 1, 4, 8) + countDetents(accum, 1, 4, 8), 1);
    eq('7 raw units = 0 detents', countDetents(accum, 2, 7, 8), 0);
    eq('-8 raw units = -1 detent', countDetents(accum, 3, -8, 8), -1);
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "rawPerDetent|raw units|one detent moves"
```

Expected: FAIL — `src.rawPerDetent is not a function`, and `one detent moves
velocity by 4` is red because `step` is still 4 (it computes 2).

- [ ] **Step 3: Add the optional member to the seam**

In `src/renderer/schwung-page-source.ts`, after `formatValue`:

```ts
    /** How many raw CC units make ONE `ctl.onKnobTurn` call for this key.
     *
     *  movy expands an encoder's accumulated magnitude into that many detents
     *  (`schwung-page-input.ts`), which is the fix for "knobs move very very
     *  slowly like shift is held" and is right for a module page. On movy's
     *  OWN pages it is twice the rate those pages had before delegation
     *  (SP-57 F5), because Schwung then spends 4 detents per enum option.
     *
     *  Absent or null means 1 — today's behaviour, and what every real port
     *  answers, which is what keeps module pages untouched by this. */
    rawPerDetent?(fullKey: string): number | null;
```

- [ ] **Step 4: Answer it from the virtual source**

In `src/renderer/schwung-virtual-source.ts`, inside the returned object, after
`formatValue`:

```ts
        /* THE RULE IS STATED IN RAW UNITS PER STEP, not per detent, because
         * that is the thing the user's hand measures — 8 of them, the same
         * number `seq/detent.ts` has always charged on these pages. What a
         * detent is worth differs by kind (Schwung spends 4 per enum option,
         * 1 per int step), so the divisor does too and the felt rate does
         * not. */
        rawPerDetent(fullKey: string): number | null {
            const c = byKey.get(bare(fullKey));
            if (!c) return null;
            return (c.type === 'enum' || c.type === 'toggle') ? 2 : 8;
        },
```

- [ ] **Step 5: Spend the accumulator in the input binding**

In `src/renderer/schwung-page-input.ts`, add the import:

```ts
import { countDetents } from '../seq/detent.js';
```

add the accumulator beside `presetKnobState` in `createPageInput`'s closure:

```ts
    /* One remainder per knob, owned here rather than in the renderer: the
     * binding is where a gesture's state already lives (`presetKnobState`),
     * and a remainder carried across CC events is the whole point — see
     * `seq/detent.ts`, which this reuses rather than restates. */
    const turnAccum: number[] = [];
```

and replace the tail of `knobTurn` (from `const n = Math.min(...)` to the loop)
with:

```ts
            /* A SOURCE MAY CHARGE MORE THAN ONE RAW UNIT PER DETENT (SP-57
             * H2). movy's own pages do, to keep the rate they had before
             * delegation; a real module's port answers nothing and the
             * expansion below is unchanged for it. */
            const key = typeof ctl.keyAt === 'function' ? ctl.keyAt(slot) : null;
            const per = (key && port.rawPerDetent) ? (port.rawPerDetent(qualify(key)) || 1) : 1;
            let n: number;
            if (per > 1) {
                const steps = countDetents(turnAccum, slot, delta, per);
                if (steps === 0) return;          // banked; the remainder carries
                n = Math.abs(steps);
            } else {
                n = Math.min(Math.abs(delta) | 0, 63) || 1;
            }
            for (let i = 0; i < n; i++) ctl.onKnobTurn(slot, dir);
```

- [ ] **Step 6: Declare VEL's step so one detent is one step**

In `src/seq/step-params-contract.ts`, the `vel` cell's `step: 4` becomes:

```ts
        key: 'vel', name: 'Velocity', shortName: 'VEL', type: 'int', min: 0, max: 127, step: 8,
```

and add to that cell's comment block:

```ts
        /* STEP 8 IS A STATEMENT ABOUT THE DETENT, not about precision.
         * `perDetentStep` is round(max(step, range * 0.01) * 0.5), so a
         * declared 4 moved velocity by TWO per detent — half a step, and half
         * of what every other cell on this page moves. 8 lands on 4, which is
         * the VEL_STEP the delta path has always used. */
```

- [ ] **Step 7: Run the tests and watch them pass**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "raw units|one detent moves|falls through"
```

Expected: PASS, all six assertions.

- [ ] **Step 8: Add the end-to-end check, through the real page**

Append to `browser-test/logic/step-params-source.mjs`'s guarded third block
(the one behind `schwungLibAvailable()`), where a real `SchwungPage` is built:

```js
/* The rule end to end: four raw units on an enum cell move NOTHING, eight move
 * exactly one option. This is the assertion that fails if either half is wrong
 * — the divisor here or ENUM_DELTA_DIV upstream — which is why it drives the
 * real page rather than the divisor alone. */
{
    const page = schwungPageFor(0, STEP_PARAMS_COMPONENT);
    const slot = 1;                                   // LEN
    const before = seqState.holdGate;
    page.knobTouch(slot, true);
    page.knobTurn(slot, 4);
    ok('four raw units do not move an enum cell', seqState.holdGate === before);
    page.knobTurn(slot, 4);
    ok('eight raw units move it exactly one option',
       lengthIndexForTicks(seqState.holdGate) === lengthIndexForTicks(before) + 1);
    page.knobTouch(slot, false);
}
```

Import `lengthIndexForTicks` alongside the existing `step-page-vm.js` imports
at the top of the file.

- [ ] **Step 9: Prove the teeth**

Change the enum divisor in `schwung-virtual-source.ts` from `2` to `1`, re-run
Step 8's block, and confirm `four raw units do not move an enum cell` goes red.
Restore it. Then revert `step: 8` to `4` and confirm `one detent moves velocity
by 4` goes red. Restore it.

- [ ] **Step 10: Confirm module pages are untouched**

```bash
SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | tail -5
SCHWUNG=../schwung node browser-test/schwung-page-idle-cost.mjs 2>&1 | tail -3
```

Expected: 0 failures, and the idle-cost suite unmoved at its recorded count. A
real port answers no `rawPerDetent`, so no module page can have moved — this
step is what proves that claim rather than asserting it.

- [ ] **Step 11: Full local gate and commit**

```bash
SCHWUNG=../schwung npm test
git add src/renderer/schwung-page-source.ts src/renderer/schwung-virtual-source.ts \
        src/renderer/schwung-page-input.ts src/seq/step-params-contract.ts \
        browser-test/logic/knob-input.mjs browser-test/logic/step-params-source.mjs
git commit -m "SP-57: one knob rule for the three virtual pages — 8 raw units a step

Old movy charged DETENT_DIV = 8 raw CC units per step on every cell of these
pages. Delegation feeds one detent per raw unit into ENUM_DELTA_DIV = 4, so
every enum ran at twice its old rate, and velocity changed shape as well: a
flat +-4 per CC event became 2x the event's magnitude.

The rule is stated where the hand measures it — raw units per STEP — and
implemented in two halves, because what a detent is worth differs by kind:
rawPerDetent (a new optional member on PageParamSource, answered only by the
virtual source) and each cell's declared step, chosen against perDetentStep.
VEL's declared 4 was moving velocity by two, half of what every neighbouring
cell moved.

A real module's port answers nothing, so module pages keep today's feel by
construction rather than by a flag."
```

---

### Task 3: MODE and LAYOUT step instead of cycling (H3, F3)

`isTwoWayMeta` makes any 2-option enum toggle on every detent, latched at 270 ms
— so turning LAYOUT flips it back and forth instead of stepping it. LINK and
INVERT escape only because `Off`/`On` makes them switches, which are
direction-absolute.

**A refinement of spec H3, deliberate and recorded:** the spec kept LINK and
INVERT on the delegated path. Routing *every* 2-option virtual cell through the
same direction-absolute write is simpler, and it is what the delta path always
did (`applyLink(n > 0)`, `applyStepInvertOn(n > 0)`). The write is skipped when
the value is already there, so a continued turn is a no-op rather than a stream
of identical commands — which is what makes dropping the 270 ms latch safe.

**Files:**
- Modify: `src/renderer/schwung-page-input.ts` (`knobTurn`)
- Test: `browser-test/logic/knob-input.mjs`

**Interfaces:**
- Consumes: `port.rawPerDetent` and `turnAccum` from Task 2; `ctl.metaAt(slot)`,
  `ctl.commitEnum(key, index)` from Schwung's controller (both already public).
- Produces: nothing new. This is behaviour inside `knobTurn`.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/knob-input.mjs`, inside the SP-57 block, using
the real set-params page:

Mirror the setup `step-params-source.mjs`'s guarded block uses — the page only
delegates in `page` mode, so `setSchwungGridMode('page')` and
`schwungGridReload()` come first or `schwungPageFor` hands back a page nothing
drives.

```js
/* H3/F3. A 2-option enum that is not Off/On falls through isSwitchMeta into
 * isTwoWayMeta, which TOGGLES on every detent — so a continued turn walks the
 * value back and forth. Direction-absolute is what the delta path always did. */
if (schwungLibAvailable()) {
    setSchwungGridMode('page'); schwungGridReload();
    const { SET_PARAMS_COMPONENT } = await import('../../dist/esm/chain/config.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');
    const page = schwungPageFor(0, SET_PARAMS_COMPONENT);
    const slot = 7;                                   // LAYOUT
    page.knobTouch(slot, true);
    for (let i = 0; i < 6; i++) page.knobTurn(slot, 8);   // six steps clockwise
    eq('clockwise lands on the second option, not somewhere in between',
       keyboardState.layout, 1);
    for (let i = 0; i < 6; i++) page.knobTurn(slot, -8);
    eq('counter-clockwise lands on the first', keyboardState.layout, 0);
    page.knobTouch(slot, false);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run build:browser && SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | grep -E "clockwise lands"
```

Expected: FAIL — six toggles land back where they started (or one step off,
depending on where the latch fell), because each detent flips rather than steps.

- [ ] **Step 3: Write the direction-absolute branch**

In `src/renderer/schwung-page-input.ts`, inside `knobTurn`, immediately after
`per` is resolved and before the accumulator is spent:

```ts
            /*
             * A TWO-OPTION CHOICE IS SET BY DIRECTION, NOT TOGGLED (SP-57 F3).
             *
             * `isTwoWayMeta` flips any 2-option enum on every detent, latched
             * at 270 ms, on the reasoning that a boxed value shows a state and
             * not a direction. That is right for a click and wrong for a turn:
             * a continued turn then walks the value back and forth, reported
             * as the Pad Layout knob "cycling through values".
             *
             * Off/On pairs (LINK, INVERT) already behave, because
             * `isSwitchMeta` takes them first — they are routed here anyway so
             * one rule covers every two-option cell on these pages, which is
             * also what the delta path did (`applyLink(n > 0)`).
             *
             * The write is SKIPPED when the value is already there, so holding
             * a turn is a no-op instead of a stream of identical commands.
             * That is what makes dropping the latch safe. Virtual components
             * only — `per > 1` is true for no real port.
             */
            const meta = (per > 1 && typeof ctl.metaAt === 'function') ? ctl.metaAt(slot) : null;
            if (meta && Array.isArray(meta.options) && meta.options.length === 2 && key) {
                const target = dir > 0 ? 1 : 0;
                const now = Math.round(Number(port.getParam(qualify(key))));
                if (now !== target) ctl.commitEnum(key, target);
                return;
            }
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm run build:browser && SCHWUNG=../schwung node browser-test/logic.mjs 2>&1 | grep -E "clockwise lands"
```

Expected: PASS, both directions.

- [ ] **Step 5: Add the idempotence check**

Append to the same block:

```js
/* The no-op guard is what replaces the 270 ms latch: a continued clockwise
 * turn must not re-emit the write it already made. */
if (schwungLibAvailable()) {
    const { peekSeqCmdQueue, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { SET_PARAMS_COMPONENT } = await import('../../dist/esm/chain/config.js');
    const page = schwungPageFor(0, SET_PARAMS_COMPONENT);
    page.knobTouch(7, true);
    page.knobTurn(7, 8);                    // arrives at option 1
    resetSeqEngine();
    for (let i = 0; i < 5; i++) page.knobTurn(7, 8);
    eq('a turn that changes nothing emits nothing', peekSeqCmdQueue().length, 0);
    page.knobTouch(7, false);
}
```

- [ ] **Step 6: Prove the teeth**

Delete the `if (now !== target)` guard (write unconditionally), re-run Step 5,
and confirm `a turn that changes nothing emits nothing` goes red. Restore it.
Then delete the whole branch and confirm Step 1's assertions go red. Restore.

- [ ] **Step 7: Full local gate and commit**

```bash
SCHWUNG=../schwung npm test
git add src/renderer/schwung-page-input.ts browser-test/logic/knob-input.mjs
git commit -m "SP-57: a two-option choice is set by direction, not toggled

isTwoWayMeta flips any 2-option enum on every detent, so a continued turn
walked Pad Layout and Note Mode back and forth — reported as the knob cycling
through values. LINK and INVERT escaped it only because Off/On makes them
switches, which are direction-absolute already.

Every two-option cell on a virtual page now takes the same direction-absolute
write the delta path always used, skipped when the value is already there: the
no-op guard is what replaces the 270 ms gesture latch, so holding a turn emits
nothing rather than a stream of identical commands.

A stopgap with a named end — SU-16 is the general version, and this branch is
deleted when it ships."
```

---

### Task 4: Units and readings through `formatValue` (H4)

The hook is wired and already carries TRANSPOSE's `n/a` and TEMPO's `EXT`.
Swing reads as a bare number where movy showed `54%`; clip length as a bare
number where it showed `N steps`; tempo's unit is lost.

**Files:**
- Modify: `src/seq/set-params-contract.ts` (`swing`, `tempo`)
- Modify: `src/seq/clip-params-contract.ts` (`length`)
- Test: `browser-test/logic/set-params-source.mjs`, `browser-test/logic/clip-params-source.mjs`

**Interfaces:**
- Consumes: `VirtualCellSpec.format(raw, surface)` — already defined.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

In `browser-test/logic/set-params-source.mjs`:

```js
/* H4. The cell band is 30px and the header strip is not, so a unit that would
 * crowd the cell rides on the header only — which is also what the screen
 * reader speaks. Swing's % is short enough for both. */
{
    const src = setParamsSource();
    const f = (k, raw, surface) => src.formatValue(SET_PARAMS_COMPONENT + ':' + k, raw, surface);
    eq('swing reads as a percentage in the cell', f('swing', '54', 'cell'), '54%');
    eq('swing reads as a percentage in the header', f('swing', '54', 'header'), '54%');
    eq('tempo carries its unit in the header', f('tempo', '120', 'header'), '120 bpm');
    eq('tempo stays bare in the cell', f('tempo', '120', 'cell'), null);
}
```

In `browser-test/logic/clip-params-source.mjs`:

```js
/* The clip length's unit is the thing that distinguishes "16" the count from
 * "16" the bar — it rides the header, where there is room for the word. */
{
    const src = clipParamsSource();
    const f = (k, raw, surface) => src.formatValue(CLIP_PARAMS_COMPONENT + ':' + k, raw, surface);
    eq('clip length names its unit in the header', f('length', '16', 'header'), '16 steps');
    eq('clip length stays bare in the cell', f('length', '16', 'cell'), null);
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "swing reads|carries its unit|names its unit"
```

Expected: FAIL — every one returns `null` today.

- [ ] **Step 3: Implement the readings**

In `src/seq/set-params-contract.ts`, the `swing` cell gains:

```ts
        /* The percent sign is the reading, not decoration: swing is the one
         * value on this page whose bare number could be read as a count. Both
         * surfaces, because "54%" fits the 30px cell where "120 bpm" does
         * not. */
        format: (raw) => (raw === null ? null : raw + '%'),
```

and the `tempo` cell's existing `format` becomes:

```ts
        /* The raw value stays a plain bpm number (so the arc/knob-state math
         * stays sane); only the PRINTED text carries the suffix. EXT wins over
         * the unit — when the clock is external, WHERE the tempo comes from is
         * the more useful of the two readings, and they do not both fit. */
        format: (raw, surface) => {
            if (raw === null) return null;
            if (seqState.extSync) return raw + ' EXT';
            return surface === 'header' ? raw + ' bpm' : null;
        },
```

In `src/seq/clip-params-contract.ts`, the `length` cell gains:

```ts
        /* Header only: the word is what tells 16 STEPS from 16 bars, and the
         * 30px cell has no room for it. */
        format: (raw, surface) =>
            (raw !== null && surface === 'header') ? raw + ' steps' : null,
```

- [ ] **Step 4: Run them and watch them pass**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "swing reads|carries its unit|names its unit"
```

Expected: PASS, all six assertions.

- [ ] **Step 5: Confirm the EXT precedence did not regress**

```bash
node browser-test/logic.mjs 2>&1 | grep -iE "EXT"
```

Expected: the pre-existing SP-53 assertion on `120 EXT` still passes. If it
does not, the `extSync` branch has been reordered — it must come first.

- [ ] **Step 6: Prove the teeth**

Remove swing's `format` and confirm both swing assertions redden; restore.
Swap tempo's `extSync` branch below the surface check and confirm the `EXT`
assertion reddens; restore.

- [ ] **Step 7: Re-baseline, gate and commit**

```bash
SCHWUNG=../schwung node browser-test/screenshot.mjs --update
SCHWUNG=../schwung npm test
git add src/seq/set-params-contract.ts src/seq/clip-params-contract.ts \
        browser-test/logic/set-params-source.mjs browser-test/logic/clip-params-source.mjs \
        browser-test/screenshots/baseline/
git commit -m "SP-57: swing, tempo and clip length say what they are

Three readings the migrated pages lost: swing's percent, tempo's unit, and the
word that tells 16 steps from 16 bars. All three go through formatValue, which
already carried TRANSPOSE's n/a and TEMPO's EXT — no new seam.

Surface-aware, because the cell band is 30px and the header strip is not:
'54%' fits both, '120 bpm' and '16 steps' ride the header alone. EXT keeps
precedence over the bpm unit — when the clock is external, where the tempo
comes from is the more useful of the two, and they do not both fit."
```

---

### Task 5: The enum peek joins the repaint decision (H5, F2 half one)

`pollDrawnPage` compares page identity, the eight knob levels, and whether a
widget is animating. The peek is in none of them, so the frame in which the
overlay should appear — and the one in which its 1500 ms expiry takes it down —
is never asked for.

This is half of F2 and it is worth landing on its own: it is correct
regardless of what the device says about the touch-clear, and Task 6 needs it
in place to tell the two causes apart.

**Files:**
- Modify: `src/renderer/schwung-page.ts` (`SchwungPage`)
- Modify: `src/renderer/schwung-page-render.ts` (implement it)
- Modify: `src/app/page-poll.ts` (`pollDrawnPage`)
- Test: `browser-test/logic/page-freshness.mjs`

**Interfaces:**
- Consumes: `ctl.enumPeek()` (public on the controller; returns the live peek
  or null, and nulls an expired one as a side effect).
- Produces: `SchwungPage.peekOpen(): boolean`.

- [ ] **Step 1: Write the failing test**

In `browser-test/logic/page-freshness.mjs`, beside the existing SP-38 block.
**There is no `fakeOwner` helper in this file** — it builds a real delegated
owner (`pageOwnerOf(m)` over `MOCK_SYNTHS.test_enum`, polled until
`owner.delegated`), and this test does the same, because the peek is the
controller's own state and a stub would only test the stub.

The isolation that gives this teeth: a turn normally moves a knob level too, so
`pollDrawnPage` would answer true whether the peek counted or not. **Turn at the
last option instead** — the value clamps and does not move, while the peek is
raised anyway — and take it down with `ctl.dismissPeek()`, which is public, so
neither edge has to wait out the 1500 ms clock.

```js
_log('\nTest: SP-57 — the enum peek asks for its own frames');
{
    const { pageOwnerOf } = await import('../../dist/esm/app/page-owner.js');
    const { pollDrawnPage } = await import('../../dist/esm/app/page-poll.js');

    setSchwungGridMode('page');
    schwungGridReload();
    appState.activeTrack.index = 0;
    env.setParams(MOCK_SYNTHS.test_enum);
    const m = settleModel(bootModel(MOCK_SYNTHS.test_enum));
    appState.trackModels[0] = [m];
    const owner = pageOwnerOf(m);
    for (let i = 0; i < 12 * 60 && !owner.delegated; i++) pollDrawnPage(owner);
    ok('the enum page delegated to Schwung', owner.delegated);

    const p = owner.page;
    const stable = (n) => { for (let i = 0; i < n; i++) if (pollDrawnPage(owner)) return false; return true; };

    /* Walk knob 0 (a four-option enum) to its last option and let the page go
     * quiet, so nothing but the peek can move the answer from here. */
    p.knobTouch(0, true);
    for (let i = 0; i < 40; i++) { p.knobTurn(0, 1); pollDrawnPage(owner); }
    let quiet = false;
    for (let i = 0; i < 12 * 60 && !(quiet = stable(3)); i++) pollDrawnPage(owner);
    ok('the page went quiet at the last option', quiet);

    /* UP: a turn that cannot move the value still raises the list. */
    p.knobTurn(0, 1);
    ok('a peek going up asks for a frame', pollDrawnPage(owner) === true);
    ok('a peek that stays up asks for nothing', stable(2));

    /* DOWN: the same, in reverse, without waiting out ENUM_PEEK_MS. */
    p.ctl.dismissPeek();
    ok('a peek coming down asks for a frame', pollDrawnPage(owner) === true);
    p.knobTouch(0, false);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "a peek"
```

Expected: FAIL on the first and third — `pollDrawnPage` returns false, because
nothing it compares has moved.

- [ ] **Step 3: Declare it on the interface**

In `src/renderer/schwung-page.ts`, after `animating`:

```ts
    /** Is Schwung's enum peek — the option list a turn raises over the grid —
     *  currently up? Asked by the repaint decision, because it both appears
     *  and EXPIRES without any value or page identity changing, and neither
     *  transition would otherwise ask for a frame. */
    peekOpen(): boolean;
```

- [ ] **Step 4: Implement it**

In `src/renderer/schwung-page-render.ts`, in the returned object beside
`animating`:

```ts
        /* `enumPeek()` is the reader that also RETIRES an expired peek
         * (`page_controller`), so asking is what keeps the state honest as
         * well as what answers the question. */
        peekOpen(): boolean {
            return typeof ctl.enumPeek === 'function' ? !!ctl.enumPeek() : false;
        },
```

- [ ] **Step 5: Put it in the comparison**

In `src/app/page-poll.ts`, add a module-level `let lastPeek = false;` beside
`lastKey`, and immediately after the knob-levels loop:

```ts
    /* SP-57. BEFORE the animation predicate, not after: a peek is a real
     * change, so it must not be filtered by the repaint cap that exists for a
     * page which never settles. Both edges count — up and down. */
    const peek = typeof page.peekOpen === 'function' ? page.peekOpen() : false;
    if (peek !== lastPeek) { lastPeek = peek; moved = true; }
```

Reset `lastPeek = false` in the same branch that does `levels.fill(null)` when
there is no page.

- [ ] **Step 6: Run it and watch it pass**

```bash
npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "a peek"
```

Expected: PASS, all three.

- [ ] **Step 7: Confirm the idle cost did not move**

```bash
SCHWUNG=../schwung node browser-test/schwung-page-idle-cost.mjs 2>&1 | tail -3
```

Expected: unmoved at its recorded count. One boolean read per tick is the whole
of the addition, but the suite is what says so.

- [ ] **Step 8: Prove the teeth, gate and commit**

Remove the two-line comparison in `page-poll.ts`, re-run Step 6, confirm two of
the three redden, restore.

```bash
SCHWUNG=../schwung npm test
git add src/renderer/schwung-page.ts src/renderer/schwung-page-render.ts \
        src/app/page-poll.ts browser-test/logic/page-freshness.mjs
git commit -m "SP-57: the enum peek asks for its own frames

pollDrawnPage compares page identity, the eight knob levels and whether a
widget is animating. The peek is in none of them — it goes up on a turn that
may not change a level, and it comes down on a 1500 ms clock with nothing
moving at all — so the frame that should draw it, and the frame that should
take it away, were never asked for.

Both edges now count, and the check sits BEFORE the animation predicate so the
repaint cap (which exists for a page that never settles) cannot filter a real
change. Half of F2; the touch-clear half is settled on the device."
```

---

### Task 6: Settle F2 on the device (F2 half two)

The remaining candidate cause: `onKnobTouch` nulls `s.peek` unconditionally, on
press *and* release, and movy forwards both. If that is what costs the overlay,
the fix is upstream (SU-19) and this task's output is the evidence for it — not
a patch.

**Files:**
- Modify: `test-device/scenarios/page-dive.ts`
- Modify: `docs/schwung-page-migration.md` (record the finding)

**Interfaces:**
- Consumes: `SchwungPage.peekOpen()` from Task 5; the harness's `Display`,
  `dev.hold*`, `until`, `bus.frames`.
- Produces: a recorded verdict — "the repaint gate was the whole of it" or
  "the touch-clear is real, and here is the trace" — which decides whether
  SU-19 exists.

- [ ] **Step 1: Write the scenario check**

Read `test-device/scenarios/jog-hint.ts` first — it is the model for this, and
it has already paid for the hard part. Its own comment: a time-limited overlay
read over `scp` fails on one host and passes on another minutes apart, so every
sample is TIMED and only one that landed well inside the window is judged.
The peek's window is `ENUM_PEEK_MS = 1500`, which is the same problem.

`t.check` is `(id, label, pass, {expected, actual})` and takes a boolean — it
is not awaited. The display API is `new Display(t.host)` with
`disp.bandFill(y0, h)`, a lit-fraction over a horizontal band; there is no
image-compare helper and this plan does not add one.

Add to `test-device/scenarios/page-dive.ts`:

```ts
/* SP-57 F2. The option list a turn raises over an enum cell.
 *
 * Two candidate causes were read from source and only the box can separate
 * them: movy's repaint gate never asked for the frame (Task 5), or
 * onKnobTouch nulls the peek on the very press that precedes the turn.
 *
 * The panel clears the screen and draws five rows of text, so the grid band
 * goes from cells-and-labels to list rows — a fill fraction tells them apart
 * without re-encoding the font, which is the same reasoning jog-hint's band
 * check is built on.
 *
 * ONE INJECT PER GESTURE. A touch and a CC sent as two injects are ~0.5s
 * apart, which movy reads as a hold, and the peek would be gone on timing
 * alone — the check would then be measuring ssh latency and reporting it as a
 * missing overlay. */
const PEEK_Y = 9, PEEK_H = 45;          // ENUM_LIST_TOP_Y .. RULE_Y - 1
const PEEK_WINDOW_MS = 1500;            // ENUM_PEEK_MS

const quiet = await disp.bandFill(PEEK_Y, PEEK_H);
t.note('gridFill', quiet);

const t0 = Date.now();
await dev.knob({ slot: 2, delta: 8 });   // PROB, one option, touch bracketed
const lit = await disp.bandFill(PEEK_Y, PEEK_H);
const elapsed = Date.now() - t0;

t.note('peekFill', lit);
t.note('peekSampleMs', elapsed);
/* A sample that landed after the window proves nothing either way — judge only
 * the ones that were taken while the panel should still have been up. */
if (elapsed < PEEK_WINDOW_MS * 0.6) {
    t.check('enum-peek-raised', 'turning an enum cell raises the option list',
        Math.abs(lit - quiet) > 0.05,
        { expected: `the list band to differ from the grid's ${quiet.toFixed(3)}`,
          actual: `${lit.toFixed(3)} at ${elapsed}ms` });
} else {
    t.note('peekSkipped', 'sample landed outside the peek window');
}
```

`dev.knob` must deliver touch-on, the CC and touch-off in ONE inject. Check
`test-device/device.ts` — if it does not, add that there rather than sending
three injects from the scenario; the harness rule is that a gesture is one
round trip.

- [ ] **Step 2: Run it against the device**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok && \
  npm run test:device -- --scenario page-dive
```

Expected, if Task 5 was the whole cause: PASS. If it fails, or every sample
lands outside the window, go to Step 3. If the device is unreachable, stop and
report **DEVICE OFFLINE** in caps — this task cannot be completed without it.

- [ ] **Step 3: Separate the two causes, if it failed**

Temporarily stop forwarding the touch on a virtual page — in
`schwung-page-input.ts`'s `knobTouch`, return early when `port.rawPerDetent`
exists — redeploy, and re-run Step 2.

```bash
./scripts/deploy.sh && npm run test:device -- --scenario page-dive
```

- Passes now → the touch-clear is confirmed. **Revert the experiment** (movy
  must keep forwarding touch: the header claim, the card warm and the picker
  dismissal all hang off it) and record the trace. This is SU-19's evidence,
  and it is what tells the upstream plan whether U4 exists at all.
- Still fails → neither candidate is the cause. Record what `peekFill` actually
  read and re-open F2 in the ledger rather than guessing a third cause.

- [ ] **Step 4: Record the verdict in the ledger**

Add the finding to `docs/schwung-page-migration.md` under SP-57 — what was
run, on which build, and which cause it eliminated. A claim no run prints is a
claim nobody has checked, and this one decides whether an upstream item exists.

- [ ] **Step 5: Commit**

```bash
git add test-device/scenarios/page-dive.ts docs/schwung-page-migration.md
git commit -m "SP-57: settle F2 on the box — which half cost the enum overlay

Two candidate causes were read from source and neither could be chosen from a
checkout: movy's repaint gate never asking for the frame, or onKnobTouch
nulling the peek on the press that precedes every turn. The scenario drives
the turn as ONE gesture, because a press and a CC sent as two injects are half
a second apart and movy reads that as a hold — which would take the peek down
on timing alone and prove nothing.

The verdict is recorded in the ledger with the build it was measured on."
```

---

### Task 7: Docs, ledger and the wave's gate

**Files:**
- Modify: `MANUAL.md` (the three pages' sections)
- Modify: `docs/schwung-page-migration.md` (SP-57's entry, SU-16…SU-19 rows)
- Modify: `docs/superpowers/specs/2026-09-22-virtual-page-alignment-design.md`
  (H3's scope, if Task 3's refinement stands)

- [ ] **Step 1: Update `MANUAL.md`**

In the step-params, clip-params and set-params sections, document what a user
can now see and feel: velocity draws a fader; every knob on these pages moves
one step per eight detents of the encoder, the same rate as before the
migration; Pad Layout and Note Mode are set by turn direction; swing, tempo and
clip length name their units. Match the file's existing voice — it explains
gestures step by step, not release notes.

- [ ] **Step 2: Refresh the doc screenshots from the baselines**

```bash
node scripts/make-doc-assets.mjs page_stepparams page_clipparams page_setparams
```

Reference them as `docs/assets/<name>.png`.

- [ ] **Step 3: Open SP-57 in the ledger**

Add the entry to `docs/schwung-page-migration.md`'s Open table and its own
section: what shipped, the teeth for each item, what was measured on device,
and the one deliberate divergence (Task 3's branch, with SU-16 named as its
end). Add SU-16…SU-19 rows to the Upstream table pointing at
`plans/su-16-19-upstream-page-bundle.md`.

- [ ] **Step 4: Both gates, clean**

```bash
./scripts/run-gate.sh both
```

Expected: `VERDICT: GREEN`. A red tier has already retried itself — fix it or
report the failing check; never wave it through.

- [ ] **Step 5: Commit and push**

```bash
git add MANUAL.md docs/assets/ docs/schwung-page-migration.md \
        docs/superpowers/specs/2026-09-22-virtual-page-alignment-design.md
git commit -m "SP-57: docs and ledger for the virtual page alignment"
git push
```

---

## Notes for the executor

- **`page_setparams` and `page_clipparams` baselines move in Task 4, not Task
  1.** If they move earlier than that, something outside the intended cell
  changed — find out what before re-baselining.
- **`schwungPageFor` needs `SCHWUNG=`.** Without the checkout those blocks skip
  rather than fail, and a skipped teeth check proves nothing. `ALLOW_SKIPPED=1`
  is the loud opt-out and must not be used to get a task past its gate.
- **Tasks 1–5 are independent of Task 6's verdict.** If the device is offline,
  ship 1–5 and leave 6 open; do not let it block the wave.
