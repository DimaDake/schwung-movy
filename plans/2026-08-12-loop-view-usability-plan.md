# Loop View & Bar Indicator Usability — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute task-by-task; each task ends green and committed.

**Goal:** Make the Loop view and bar indicator correct for loops that do not start at bar 1, and give loop bars the session view's smooth hardware pulse.

**Architecture:** One coordinate model in `seq/state.ts` (`stepInLoop`, `minBarOffset`, `maxBarOffset`) that every consumer reads, replacing six sites that treated `lenSteps` as "bars 0..N". Loop-mode step LEDs move from JS colour-toggling to the firmware pulse channels already used by session view, via `cachedSetAnimLED`.

**Tech Stack:** TypeScript → `dist/esm` (`npm run build:browser`), Node `.mjs` test suites, Rust `seq-core` (read-only here — no engine changes).

**Design doc:** `movy/plans/2026-08-12-loop-view-usability-design.md`

## Global Constraints

- Loop window is **absolute**: `[loopStart, loopStart + lenSteps)`. Never treat `lenSteps` as an absolute bar count.
- `MAX_BARS = 16`; bar indices are 0-based internally, displayed 1-based.
- `C_DARKGREY = 124` is the inactive-bar colour. No new colour constants.
- Pulse channels come from `seq/colors.ts`: `ANIM_NONE`/`ANIM_PULSE`/`ANIM_PULSE_SLOW`. Never re-implement a pulse in JS.
- Priority for loop bars: **playhead > selected > active > inactive**.
- Every behaviour change is identical to today when `loopStart === 0` — existing baselines and tests must stay green without edits, except where a task says otherwise.
- After any UI rendering change: `node browser-test/screenshot.mjs --update`, then review the diff.
- Test cycle per task: `npm run build:browser` then the four `.mjs` suites. Commit only on 0 failures.
- Prove teeth: revert the fix, watch the new test fail, restore. Not optional.

---

### Task 1: One coordinate model

**Files:**
- Modify: `src/seq/state.ts:166-186`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Produces: `stepInLoop(step: number): boolean`, `minBarOffset(): number`, `maxBarOffset(): number` (existing name, new formula), `loopBarCount(): number`.

- [ ] **Step 1: Write the failing test** — append a new block to `browser-test/logic.mjs`:

```js
/* ── seq loop window coordinates ─────────────────────────────────────────── */
{
    _log('\nseq loop window coords:');
    const { seqState, resetSeqState, stepInLoop, minBarOffset, maxBarOffset, loopBarCount } =
        await import('../dist/esm/seq/state.js');

    // Loop = bars 3-4 (0-based 2-3): absolute steps 32..63.
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 32;
    eq('loop start bar navigable', minBarOffset(), 2);
    eq('one bar past the loop navigable', maxBarOffset(), 4);
    eq('loop spans 2 bars', loopBarCount(), 2);
    eq('step before the loop is out', stepInLoop(31), false);
    eq('first loop step is in', stepInLoop(32), true);
    eq('last loop step is in', stepInLoop(63), true);
    eq('step past the loop is out', stepInLoop(64), false);

    // loopStart 0 → unchanged from the old formulas (regression guard).
    resetSeqState(); seqState.lenSteps = 32;
    eq('bar 0 loop starts at 0', minBarOffset(), 0);
    eq('bar 0 loop max offset unchanged', maxBarOffset(), 2);

    // Empty slot: nowhere to navigate.
    resetSeqState();
    eq('empty clip max offset is 0', maxBarOffset(), 0);
    eq('empty clip min offset is 0', minBarOffset(), 0);

    // 16-bar cap holds even at the last bar.
    resetSeqState(); seqState.loopStart = 240; seqState.lenSteps = 16;
    eq('last bar caps at 15', maxBarOffset(), 15);
    resetSeqState();
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A3 "loop window coords"`
Expected: FAIL — `stepInLoop is not a function`.

- [ ] **Step 3: Implement**

In `src/seq/state.ts`, fix the stale comment on `clipBars` (the extra navigable bar comes from `maxBarOffset`, not from here) and replace `maxBarOffset`:

```ts
/* Number of bars the watched clip's loop spans (its length, bar-rounded).
 * Capped at 16 bars. NOT an absolute bar index — the loop can start anywhere;
 * see loopStartBar(). */
export function clipBars(): number {
    return Math.max(1, Math.ceil(seqState.lenSteps / 16));
}

export function loopBarCount(): number {
    return loopEndBar() - loopStartBar() + 1;
}

/* Navigable bar range: the loop's own bars plus ONE empty bar past its end
 * (native: stepping past the loop shows an empty bar that becomes part of the
 * loop once a note is added). Absolute bar indices — a loop that starts at bar
 * 3 must not let the arrows wander back to bar 1, and must be able to reach its
 * own last bar. */
export function minBarOffset(): number {
    if (seqState.lenSteps === 0) return 0;
    return loopStartBar();
}

export function maxBarOffset(): number {
    if (seqState.lenSteps === 0) return 0;
    return Math.min(loopEndBar() + 1, 15);
}

/* Is this absolute step inside the loop window the engine actually plays?
 * The engine loops [loop_start_steps, loop_start_steps + length_steps)
 * (seq-core clip.rs) — every UI consumer must ask through here rather than
 * comparing against lenSteps, which is a LENGTH, not an end index. */
export function stepInLoop(step: number): boolean {
    return step >= seqState.loopStart && step < seqState.loopStart + seqState.lenSteps;
}
```

Keep `loopStartBar()`/`loopEndBar()` as they are.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -5`
Expected: 0 failures.

- [ ] **Step 5: Prove teeth** — temporarily restore `maxBarOffset` to `Math.min(clipBars(), 15)`; the "one bar past the loop navigable" assertion must fail (4 vs 2). Restore.

- [ ] **Step 6: Commit**

```bash
git add src/seq/state.ts browser-test/logic.mjs
git commit -m "Give the loop window one absolute coordinate model"
```

---

### Task 2: Step row and step-press follow the loop window

**Files:**
- Modify: `src/seq/leds.ts:216-240` (the non-Loop step row), `src/seq/router-steps.ts:146-155` (`toggleStep`)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `stepInLoop` from Task 1.

This is the highest-impact fix: today a mid-clip loop renders the **entire step row black**, so step editing is blind.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:

```js
/* ── seq step row inside a mid-clip loop ─────────────────────────────────── */
{
    _log('\nseq step row in a mid-clip loop:');
    const sent = new Map();
    const savedLed = globalThis.setLED, savedBtn = globalThis.setButtonLED;
    globalThis.setLED = (n, c) => sent.set(n, c);
    globalThis.setButtonLED = () => {};

    const leds = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../dist/esm/seq/state.js');
    const { trackColorDim } = await import('../dist/esm/seq/colors.js');

    // Loop = bars 3-4 (steps 32..63), viewing bar 3, notes on steps 32 and 36.
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    occToggleStep(32); occToggleStep(36);
    leds.seqLedsInvalidate();
    // Two ticks: the first frame's 40-send budget is spent on buttons/icons too.
    leds.seqLedsTick(false, 0, 2, 4);
    leds.seqLedsTick(false, 0, 2, 4);
    eq('occupied step 32 is white', sent.get(16), 120);
    eq('occupied step 36 is white', sent.get(20), 120);
    eq('empty in-loop step is track-dim', sent.get(17), trackColorDim(0));
    eq('mid-loop row is not blacked out', [...Array(16).keys()].every(i => sent.get(16 + i) === 0), false);

    // The bar past the loop end stays dark (unchanged affordance).
    sent.clear(); seqState.barOffset = 4;
    leds.seqLedsInvalidate();
    leds.seqLedsTick(false, 0, 4, 4);
    leds.seqLedsTick(false, 0, 4, 4);
    eq('bar past the loop is dark', sent.get(16), 0);

    globalThis.setLED = savedLed; globalThis.setButtonLED = savedBtn;
    resetSeqState(); leds.seqLedsInvalidate();
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A6 "step row in a mid-clip"`
Expected: FAIL — step 32 reads 0 (black), not 120.

- [ ] **Step 3: Implement**

In `src/seq/leds.ts`, import `stepInLoop` from `./state.js`, then in `seqLedsTick`'s step loop replace the two length comparisons:

```ts
        } else if (seqState.lenSteps > 0 && !stepInLoop(step)) {
            // Steps outside the loop window are not part of the pattern → fully
            // off (overrides occupancy/playhead, which never land out here).
            color = C_BLACK;
        } else {
            const span = lengthSpanColor(step, holdStep, holdLen, watchTrack);
            if (span >= 0) color = span;
            else if (step === playStep) color = seqState.recording ? C_REC_RED : C_GREEN;
            else if (occHasStep(step)) color = C_WHITE;
            else if (seqState.lenSteps > 0 && stepInLoop(step)) color = dimTrack;
            else color = C_DARKGREY;
        }
```

In `src/seq/router-steps.ts` `toggleStep`, the sub-bar-length inert check must measure from the loop's end, not from `lenSteps`:

```ts
    // A sub-bar clip length (LENGTH knob) hides the steps in the rest of that
    // bar; pressing one is inert (no entry). The next empty bar stays tappable
    // so the native "tap into the next bar to grow the clip" still works, and a
    // pre-existing note past the length can still be cleared. Measured from the
    // loop END (absolute) — a loop starting mid-clip has its own last bar.
    const loopEnd = seqState.loopStart + seqState.lenSteps;
    const barEnd = Math.ceil(loopEnd / NUM_STEP_BUTTONS) * NUM_STEP_BUTTONS;
    if (seqState.lenSteps > 0 && step >= loopEnd && step < barEnd && !occHasStep(step)) return;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -5 && node browser-test/app-loop.mjs 2>&1 | tail -3`
Expected: 0 failures in both.

- [ ] **Step 5: Prove teeth** — restore `step >= seqState.lenSteps`; the "occupied step 32 is white" assertion must fail. Restore the fix.

- [ ] **Step 6: Commit**

```bash
git add src/seq/leds.ts src/seq/router-steps.ts browser-test/logic.mjs
git commit -m "Light the step row for the loop window, not for bars 1..N"
```

---

### Task 3: Strip and playhead sweep in absolute bars

**Files:**
- Modify: `src/seq/render.ts:14-90`
- Test: `browser-test/logic.mjs:3244-3302` (extend the existing strip block), `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `loopStartBar`, `loopEndBar`, `loopBarCount` from Task 1.
- Produces: `playheadX(posTick: number, loopStartTick: number, lenSteps: number, stripW: number): number` — **signature change**, `loopStartTick` is required.

- [ ] **Step 1: Write the failing test** — in `browser-test/logic.mjs`, update the four existing `playheadX` assertions (around line 4242) to pass the new second argument, and add the mid-clip cases:

```js
    eq('start at 0', playheadX(0, 0, 32, W), 0);
    eq('mid', playheadX(16 * 24, 0, 32, W), 64);   // half of a 32-step clip
    eq('clamps to width-1', playheadX(999999, 0, 32, W), W - 1);
    eq('empty clip → 0', playheadX(0, 0, 0, W), 0);
    // A loop starting at bar 3 (step 32): the sweep is relative to the WINDOW,
    // so its own first tick is x=0, not the right edge.
    eq('mid-clip loop starts at 0', playheadX(32 * 24, 32 * 24, 32, W), 0);
    eq('mid-clip loop halfway', playheadX(48 * 24, 32 * 24, 32, W), 64);
    eq('before the window clamps to 0', playheadX(0, 32 * 24, 32, W), 0);
```

Then append to the existing `seq loop strip:` block:

```js
    // Loop = bars 3-4 (steps 32..63), viewing bar 3. Segments must land on the
    // ACTIVE bars; before the fix these drew at bars 0-1 and bar 2 became a "+".
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    rects.length = 0;
    drawLoopStrip();
    const mid = rects.slice(1).filter(r => r.v === 1);
    eq('mid-clip loop draws two segments', mid.length, 2);
    eq('selected loop bar is thick', mid[0].h, 2);
    eq('selected segment starts at x=1', mid[0].x, 1);
    eq('other loop bar is thin', mid[1].h, 1);

    // Viewing the empty bar past a mid-clip loop → 3 spans, the last a "+".
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 4;
    rects.length = 0;
    drawLoopStrip();
    // 2 loop segments + plus icon (2 rects) = 4 lit rects.
    eq('bar past a mid-clip loop shows a plus', rects.slice(1).filter(r => r.v === 1).length, 4);

    // Sweep stays inside the active window, never over the "+" bar.
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 4;
    seqState.playing = true; seqState.posTick = 32 * 24;   // first tick of the loop
    rects.length = 0;
    drawLoopStrip();
    const sweep = rects.slice(1).find(r => r.v === 1 && r.h === 4);
    eq('sweep drawn', sweep !== undefined, true);
    eq('sweep starts at the window origin', sweep.x, 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -E "mid-clip|sweep"`
Expected: FAIL — `mid-clip loop draws two segments` gets 1 (bar 2 renders as a `+`), and `playheadX` mid-clip returns 127.

- [ ] **Step 3: Implement** — replace `playheadX` and `drawLoopStrip` in `src/seq/render.ts`:

```ts
/* Continuous playhead x within the active window: fraction of the LOOP elapsed.
 * `loopStartTick` is required, not optional — posTick is absolute (seq-core
 * seeds it from loop_start_ticks), and a caller that forgot to subtract the
 * window origin pinned the sweep to the right edge for the whole loop. */
export function playheadX(posTick: number, loopStartTick: number, lenSteps: number, stripW: number): number {
    const lenTicks = Math.max(lenSteps, 16) * TICKS_PER_STEP;
    if (lenTicks <= 0) return 0;
    const x = Math.round(((posTick - loopStartTick) / lenTicks) * stripW);
    return Math.max(0, Math.min(x, stripW - 1));
}
```

```ts
export function drawLoopStrip(): void {
    // Clear the strip band so the sweep doesn't leave trails.
    fill_rect(0, STRIP_Y - 2, W, 4, 0);
    // No clip in the current slot → no bar line at all (clipBars() floors to 1,
    // so guard on the real emptiness signal).
    if (seqState.lenSteps === 0) return;
    /* The strip spans the ACTIVE window, extended to reach the selected bar when
     * the user has navigated outside it (absolute bar indices throughout — the
     * loop can start anywhere). Bars in the window are segments; a bar only in
     * span because it is selected shows the "+" navigable marker. */
    const first = loopStartBar();
    const last = loopEndBar();
    const from = Math.min(first, seqState.barOffset);
    const to = Math.max(last, seqState.barOffset);
    const view = to - from + 1;
    const segW = Math.max(3, Math.floor(W / view));
    const single = first === last;

    for (let bar = from; bar <= to; bar++) {
        const x0 = (bar - from) * segW;
        const cx = x0 + Math.floor(segW / 2);
        if (bar >= first && bar <= last) {
            const selected = bar === seqState.barOffset;
            const thick = selected && !single;
            fill_rect(x0 + 1, thick ? STRIP_Y - 1 : STRIP_Y, segW - 2, thick ? 2 : 1, 1);
        } else {
            // "+" marker for a bar outside the loop (navigated into).
            fill_rect(cx - 1, STRIP_Y, 3, 1, 1);
            fill_rect(cx, STRIP_Y - 1, 1, 3, 1);
        }
    }

    // Playhead sweep: continuous, confined to the active window's segments.
    if (seqState.playing) {
        const originX = (first - from) * segW;
        const windowW = loopBarCount() * segW;
        const px = playheadX(seqState.posTick, first * NUM_STEP_BUTTONS * TICKS_PER_STEP,
            seqState.lenSteps, windowW);
        fill_rect(originX + px, STRIP_Y - 2, 1, 4, 1);
    }
}
```

Update the imports at the top of `render.ts`:

```ts
import { clipBars, loopBarCount, loopEndBar, loopStartBar, seqState } from './state.js';
import { NUM_STEP_BUTTONS } from './constants.js';
```

`clipBars` stays imported only if still referenced; if TypeScript reports it unused, drop it from the import.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -5 && node browser-test/perf.mjs 2>&1 | tail -3`
Expected: 0 failures. `perf.mjs:466` calls `drawLoopStrip()` with no args — unaffected.

- [ ] **Step 5: Add screenshot scenes** — in `browser-test/screenshot.mjs`, add to `PRESETS`:

```js
    'loop_strip_midclip', 'loop_strip_outside',
```

to `BASE`:

```js
    loop_strip_midclip: 'test8', loop_strip_outside: 'test8',
```

and to the `applyView` switch:

```js
        case 'loop_strip_midclip': {
            // Loop = bars 3-4, viewing bar 3, playing: segments sit on the
            // active bars and the sweep stays inside them.
            resetSeqState();
            seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
            seqState.playing = true; seqState.posTick = 40 * 24;
            lastRender = () => { renderKnobsView(model.getViewModel()); drawLoopStrip(); };
            lastRender();
            break;
        }
        case 'loop_strip_outside': {
            // Navigated two bars past a mid-clip loop: "+" markers lead to it.
            resetSeqState();
            seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 5;
            lastRender = () => { renderKnobsView(model.getViewModel()); drawLoopStrip(); };
            lastRender();
            break;
        }
```

Add `drawLoopStrip` to the existing `render.js` import near `screenshot.mjs:170`:

```js
const { drawSeqHeader, resetSeqHeader, drawLoopStrip } = await import('../dist/esm/seq/render.js');
```

- [ ] **Step 6: Generate and review baselines**

Run: `node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs 2>&1 | tail -3`
Expected: two new baselines, 0 failures. Open both PNGs and confirm the segments sit where the design says.

- [ ] **Step 7: Prove teeth** — restore `playheadX` without the `loopStartTick` subtraction; `sweep starts at the window origin` must fail. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/seq/render.ts browser-test/logic.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline
git commit -m "Draw the bar strip and sweep from the loop window"
```

---

### Task 4: Loop bars pulse with the session vocabulary

**Files:**
- Modify: `src/seq/leds.ts:31-75`
- Test: `browser-test/logic.mjs:3676-3690` (replace the existing `loopBarColor` block), `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `loopBarColor(c: BarCtx): CellLed` where `BarCtx = { isPlayhead: boolean; selected: boolean; inLoop: boolean; track: number }` and `CellLed = { base: number; anim: number; channel: number }` (the shape `sessionCellColor` already returns).

**Breaking change:** `loopBarColor` returned a number and took `hasContent`/`blink`. Both leave the ctx — the user asked for no content indication, and the firmware owns the pulse now.

- [ ] **Step 1: Write the failing test** — replace the `loopBarColor` assertions in `browser-test/logic.mjs` (~line 3676) with:

```js
{
    _log('\nseq loop bar LEDs:');
    const { loopBarColor } = await import('../dist/esm/seq/leds.js');
    const { trackColor, C_BLACK, C_DARKGREY, C_WHITE, C_GREEN,
        ANIM_NONE, ANIM_PULSE, ANIM_PULSE_SLOW } = await import('../dist/esm/seq/colors.js');
    const base = { isPlayhead: false, selected: false, inLoop: false, track: 1 };
    const led = (o) => loopBarColor({ ...base, ...o });

    // Playhead outranks everything, and is solid — it is already moving.
    deepEq('playhead solid green', led({ isPlayhead: true, inLoop: true, selected: true }),
        { base: C_GREEN, anim: C_GREEN, channel: ANIM_NONE });
    // Selected + active: white breathing toward the track colour, slow (session's
    // "selected clip" rate).
    deepEq('selected active pulses slow', led({ selected: true, inLoop: true }),
        { base: C_WHITE, anim: trackColor(1), channel: ANIM_PULSE_SLOW });
    // Selected but navigated outside the loop: still breathes, but toward grey.
    deepEq('selected inactive pulses to grey', led({ selected: true }),
        { base: C_WHITE, anim: C_DARKGREY, channel: ANIM_PULSE_SLOW });
    // Active, not selected: session's playing-clip pair exactly.
    deepEq('active pulses at quarter rate', led({ inLoop: true }),
        { base: trackColor(1), anim: C_WHITE, channel: ANIM_PULSE });
    // Inactive: very dark grey, solid. No content indication either way.
    deepEq('inactive is dark grey', led({}),
        { base: C_DARKGREY, anim: C_DARKGREY, channel: ANIM_NONE });
    eq('C_BLACK unused for bars', C_BLACK, 0);
}
```

If `logic.mjs` has no `deepEq`, add it beside `eq`:

```js
const deepEq = (label, got, want) => eq(label, JSON.stringify(got), JSON.stringify(want));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A6 "loop bar LEDs"`
Expected: FAIL — `loopBarColor` returns a number, not an object.

- [ ] **Step 3: Implement** — in `src/seq/leds.ts`, delete `barHasContent()` entirely (it cost 256 `occHasStep()` calls per frame and has no consumer left), and replace the bar ctx / colour / paint trio:

```ts
/* Loop-mode bars borrow session view's pulse vocabulary wholesale (session.ts
 * sessionCellColor): colour says WHAT the bar is, the firmware pulse rate says
 * how it relates to you. The active pair is byte-identical to a playing clip's,
 * so loop bars and session pads breathe in hardware phase-lock. Content is
 * deliberately NOT shown — a bar's job here is to say whether it plays. */
interface BarCtx { isPlayhead: boolean; selected: boolean; inLoop: boolean; track: number; }
export interface CellLed { base: number; anim: number; channel: number; }

export function loopBarColor(c: BarCtx): CellLed {
    const tc = trackColor(c.track);
    if (c.isPlayhead) return { base: C_GREEN, anim: C_GREEN, channel: ANIM_NONE };
    if (c.selected)   return { base: C_WHITE, anim: c.inLoop ? tc : C_DARKGREY, channel: ANIM_PULSE_SLOW };
    if (c.inLoop)     return { base: tc, anim: C_WHITE, channel: ANIM_PULSE };
    return { base: C_DARKGREY, anim: C_DARKGREY, channel: ANIM_NONE };
}

/* Loop Mode: step buttons are bars. */
function paintLoopBars(): void {
    const start = loopStartBar();
    const end = loopEndBar();
    const playBar = seqState.playing ? Math.floor(seqState.curStep / NUM_STEP_BUTTONS) : -1;
    for (let bar = 0; bar < NUM_STEP_BUTTONS; bar++) {
        const led = loopBarColor({
            isPlayhead: bar === playBar,
            selected: bar === seqState.barOffset,
            inLoop: bar >= start && bar <= end,
            track: seqState.watchTrack,
        });
        cachedSetAnimLED(STEP_NOTE_BASE + bar, led.base, led.anim, led.channel);
    }
}
```

Add `ANIM_NONE, ANIM_PULSE, ANIM_PULSE_SLOW` to the `./colors.js` import, and `cachedSetAnimLED` is already imported.

Then guard the two-cache hazard. Notes 16–31 are now painted through `cachedSetAnimLED` (`lastAnimLed`) in Loop mode and `cachedSetLED` (`lastNoteLed`) outside it; a stale entry in the idle map would suppress a needed send. Add near the top of `seqLedsTick`, right after `ledFrameReset()`:

```ts
    /* The step row is painted through cachedSetLED outside Loop mode and
     * cachedSetAnimLED inside it — two independent caches over the same notes.
     * Whichever map is idle goes stale, so a toggle must forget both or the
     * first frame after it silently keeps the old colours. */
    if (seqState.loopMode !== lastLoopMode) {
        lastLoopMode = seqState.loopMode;
        seqLedsInvalidate();
    }
```

and the module-level state beside the other `let`s:

```ts
let lastLoopMode = false;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -5`
Expected: 0 failures.

- [ ] **Step 5: Add the paint-path test** — append to `browser-test/app-loop.mjs`, asserting the real two-tick handshake (`cachedSetAnimLED` sends the base first, the animation the next tick):

```js
/* ── Loop mode paints bars through the firmware pulse channels ───────────── */
{
    _log('\nloop mode bar pulses:');
    const msgs = [];
    const savedSend = globalThis.move_midi_internal_send;
    globalThis.move_midi_internal_send = (m) => msgs.push(m);
    const leds = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { trackColor, ANIM_PULSE, ANIM_PULSE_SLOW } = await import('../dist/esm/seq/colors.js');

    resetSeqState();
    seqState.loopMode = true;
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    leds.seqLedsInvalidate();
    leds.seqLedsTick(false, 0, 2, 4);   // bases go out
    leds.seqLedsTick(false, 0, 2, 4);   // animations follow
    leds.seqLedsTick(false, 0, 2, 4);   // budget spillover

    // Step note 18 = bar 2 (selected, active) → slow pulse on channel ANIM_PULSE_SLOW.
    const sel = msgs.filter(m => m[2] === 18);
    eq('selected bar got a slow pulse', sel.some(m => (m[1] & 0x0f) === ANIM_PULSE_SLOW), true);
    // Step note 19 = bar 3 (active, not selected) → quarter pulse to white.
    const act = msgs.filter(m => m[2] === 19);
    eq('active bar got a quarter pulse', act.some(m => (m[1] & 0x0f) === ANIM_PULSE, true), true);
    eq('active bar base is the track colour', act[0][3], trackColor(0));
    // Step note 16 = bar 0 (inactive) → solid dark grey, channel 0.
    const off = msgs.filter(m => m[2] === 16);
    eq('inactive bar is solid', off.every(m => (m[1] & 0x0f) === 0), true);
    eq('inactive bar is dark grey', off[0][3], 124);

    globalThis.move_midi_internal_send = savedSend;
    resetSeqState(); leds.seqLedsInvalidate();
}
```

- [ ] **Step 6: Run it**

Run: `npm run build:browser && node browser-test/app-loop.mjs 2>&1 | tail -5`
Expected: 0 failures.

- [ ] **Step 7: Check the frame cost moved the right way**

Run: `node browser-test/perf.mjs 2>&1 | tail -6`
Expected: 0 failures; the loop-mode frame is no worse than before (`barHasContent`'s 256 occupancy reads are gone).

- [ ] **Step 8: Prove teeth** — delete the `lastLoopMode` invalidate block, then in `app-loop.mjs` run a non-Loop tick before the Loop ticks; the pulse assertions must fail (stale `lastNoteLed` suppresses the base sends). Restore.

- [ ] **Step 9: Commit**

```bash
git add src/seq/leds.ts browser-test/logic.mjs browser-test/app-loop.mjs
git commit -m "Pulse loop bars with the session view's LED vocabulary"
```

---

### Task 5: Persistent Loop readout

**Files:**
- Modify: `src/seq/render.ts` (add `loopHeaderText`, `drawLoopHeader`), `src/app/tick.ts:612-621`, `src/seq/loop-mode.ts` (dirty on exit)
- Test: `browser-test/logic.mjs`, `browser-test/screenshot.mjs`

**Interfaces:**
- Produces: `loopHeaderText(): string`, `drawLoopHeader(): void`.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:

```js
/* ── loop mode header readout ────────────────────────────────────────────── */
{
    _log('\nloop header readout:');
    const { loopHeaderText } = await import('../dist/esm/seq/render.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    // Loop = bars 3-4, viewing bar 3. Bars read 1-based, as printed on the unit.
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    eq('multi-bar window', loopHeaderText(), 'LOOP 3-4  BAR 3');
    // Single-bar loop reads as one number, not "3-3".
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 16; seqState.barOffset = 2;
    eq('single-bar window', loopHeaderText(), 'LOOP 3  BAR 3');
    // Navigated outside the loop: BAR still reports where you are.
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 16; seqState.barOffset = 3;
    eq('outside the window', loopHeaderText(), 'LOOP 3  BAR 4');
    resetSeqState();
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A4 "loop header readout"`
Expected: FAIL — `loopHeaderText is not a function`.

- [ ] **Step 3: Implement** — add to `src/seq/render.ts` beside the header code:

```ts
/* Loop-mode readout. The timed announcement flashed for ~0.3s and left the
 * screen with no indication of the window you were editing; while Loop mode is
 * on this band stays up and tracks navigation. Bars are 1-based here — the
 * numbers match the step buttons the user is looking at. */
export function loopHeaderText(): string {
    const first = loopStartBar() + 1;
    const last = loopEndBar() + 1;
    const window = first === last ? `${first}` : `${first}-${last}`;
    return `LOOP ${window}  BAR ${seqState.barOffset + 1}`;
}

export function drawLoopHeader(): void {
    fill_rect(0, 0, W, 9, 1);              // inverted band, same as the announce
    fontPrint(2, 1, loopHeaderText(), 0);
}
```

In `src/app/tick.ts`, import `drawLoopHeader` from `../seq/render.js` and draw it in the per-tick section that already owns the strip, so the readout tracks navigation without waiting for a dirty frame:

```ts
    if (engineReady() && !seqToastActive() && !jogToastShown && !seqState.sessionMode
        && !isBrowseView && !captureOverlayActive()) {
        // Loop mode's readout lives on the same per-tick schedule as the strip:
        // both track state that changes without a dirty frame. It supersedes the
        // timed announcement while it is up.
        if (seqState.loopMode) drawLoopHeader();
        drawLoopStrip();
    }
```

The band must be erased on exit. In `src/seq/loop-mode.ts`, import `appState` from `../app/state.js` (the direction `seq/session.ts` already takes) and mark the frame dirty wherever Loop mode turns off — the momentary restore closure and the tap-out branch:

```ts
        momentaryDown(CC_LOOP_BTN, () => {
            seqState.loopMode = loopPrev;
            appState.dirty = true;      // erase the readout band on the way out
            seqHeaderAnnounce(loopPrev ? 'Loop' : 'Note');
        });
```

```ts
        if (momentaryUp(CC_LOOP_BTN) === 'tap' && loopPrev) {
            seqState.loopMode = false; // tap while already in Loop → back to Note
            appState.dirty = true;
            seqHeaderAnnounce('Note');
        }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -5 && node browser-test/app-loop.mjs 2>&1 | tail -3`
Expected: 0 failures.

- [ ] **Step 5: Add the screenshot scene** — `PRESETS` gets `'loop_header'`, `BASE` gets `loop_header: 'test8'`, and `applyView`:

```js
        case 'loop_header': {
            // Loop mode over a live param page: readout band on top, strip below.
            resetSeqState(); resetSeqHeader();
            seqState.loopMode = true;
            seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
            lastRender = () => {
                renderKnobsView(model.getViewModel());
                drawLoopHeader(); drawLoopStrip();
            };
            lastRender();
            break;
        }
```

Extend the `render.js` import to include `drawLoopHeader`.

- [ ] **Step 6: Generate and review the baseline**

Run: `node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs 2>&1 | tail -3`
Expected: one new baseline, 0 failures. Confirm the band is legible and does not collide with the strip.

- [ ] **Step 7: Commit**

```bash
git add src/seq/render.ts src/app/tick.ts src/seq/loop-mode.ts browser-test/logic.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline
git commit -m "Keep a live LOOP/BAR readout up while Loop mode is on"
```

---

### Task 6: Gesture fixes — wall-clock double-tap, view follows the loop

**Files:**
- Modify: `src/seq/loop-mode.ts:24-100`, `src/seq/router-steps.ts:141-144`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Produces: `loopStepOnAt(bar: number, nowMs: number): void`; `loopStepOn(bar)` stays as the `Date.now()` wrapper.

- [ ] **Step 1: Write the failing test** — append to `browser-test/logic.mjs`:

```js
/* ── loop mode gestures ──────────────────────────────────────────────────── */
{
    _log('\nloop mode gestures:');
    const { loopStepOnAt, loopStepOff, resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { navigateBar } = await import('../dist/esm/seq/router-steps.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    // Double-tap is wall-clock, so the window does not shrink 3x when the
    // device tick rate rises under load (63-205 Hz observed).
    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 64;                 // 4-bar clip from bar 1
    loopStepOnAt(2, 1000); loopStepOff(2);
    loopStepOnAt(2, 1449); loopStepOff(2);  // inside 450 ms → 1-bar loop at bar 3
    eq('double-tap sets a 1-bar loop', seqState.lenSteps, 16);
    eq('double-tap loop starts at bar 3', seqState.loopStart, 32);

    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 64;
    loopStepOnAt(2, 1000); loopStepOff(2);
    loopStepOnAt(2, 1451); loopStepOff(2);  // past 450 ms → just a selection
    eq('slow re-tap does not resize', seqState.lenSteps, 64);

    // Two bars pressed → window, and the view follows into it.
    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 64; seqState.barOffset = 0;
    loopStepOnAt(2, 2000);
    loopStepOnAt(4, 2050);
    eq('two-bar press sets the window', seqState.loopStart, 32);
    eq('two-bar press sets the length', seqState.lenSteps, 48);
    eq('view follows into the window', seqState.barOffset, 2);

    // A view above the window clamps to its last bar, not below its first.
    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 128; seqState.barOffset = 7;
    loopStepOnAt(1, 3000);
    loopStepOnAt(2, 3050);
    eq('view clamps down to the window end', seqState.barOffset, 2);

    // Arrows cannot wander below a mid-clip loop's first bar.
    resetSeqState(); resetLoopMode();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    navigateBar(-1);
    eq('left arrow stops at the loop start', seqState.barOffset, 2);
    navigateBar(1); navigateBar(1);
    eq('right arrow reaches one bar past the loop', seqState.barOffset, 4);
    navigateBar(1);
    eq('right arrow stops there', seqState.barOffset, 4);

    resetSeqState(); resetLoopMode();
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A8 "loop mode gestures"`
Expected: FAIL — `loopStepOnAt is not a function`.

- [ ] **Step 3: Implement** — in `src/seq/loop-mode.ts` replace the tick-based double-tap state and `loopStepOn`:

```ts
/* Wall-clock, not tick-counted: the device tick rate is not a stable constant
 * (63-205 Hz observed, and it moves with load), so a tick-based double-tap
 * window silently swings from 0.3s to 1s. Same reasoning as momentary.ts. */
const DOUBLE_TAP_MS = 450;
```

```ts
let lastTapBar = -1;
let lastTapMs = -DOUBLE_TAP_MS;
```

```ts
/* Step press in Loop Mode = bar selection. The *At variant takes the timestamp
 * so the double-tap window is testable without sleeping. */
export function loopStepOnAt(bar: number, nowMs: number): void {
    heldBars.add(bar);
    momentaryGesture(); // selecting/setting bars while Loop held = modifier use
    if (heldBars.size >= 2) {
        const bars = [...heldBars];
        setLoopBars(Math.min(...bars), Math.max(...bars));
        heldBars.clear();
        return;
    }
    if (bar === lastTapBar && nowMs - lastTapMs <= DOUBLE_TAP_MS) {
        setLoopBars(bar, bar);
    } else {
        seqState.barOffset = bar;   // single press selects the viewed bar
    }
    lastTapBar = bar;
    lastTapMs = nowMs;
}

export function loopStepOn(bar: number): void {
    loopStepOnAt(bar, Date.now());
}
```

In `setLoopBars`, after the optimistic mirror, follow the window:

```ts
    // Optimistic mirror.
    seqState.loopStart = startStep;
    seqState.lenSteps = lenStep;
    /* Keep the viewed bar inside the new window: a two-bar press or a wheel
     * shrink used to leave barOffset outside it, so the step row edited a bar
     * that no longer plays. Clamping (not jumping to the start) keeps you near
     * where you were. */
    seqState.barOffset = Math.max(s, Math.min(seqState.barOffset, e));
```

Drop the now-unused `uiTick` from the `./engine.js` import and `resetLoopMode` resets the new fields:

```ts
export function resetLoopMode(): void {
    held = false;
    loopPrev = false;
    heldBars.clear();
    lastTapBar = -1;
    lastTapMs = -DOUBLE_TAP_MS;
}
```

In `src/seq/router-steps.ts`, `navigateBar` takes the loop-aware lower bound:

```ts
export function navigateBar(delta: number): void {
    const next = Math.max(minBarOffset(), Math.min(seqState.barOffset + delta, maxBarOffset()));
    seqState.barOffset = next;
}
```

Add `minBarOffset` to its `./state.js` import.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -5`
Expected: 0 failures.

- [ ] **Step 5: Prove teeth** — restore `DOUBLE_TAP_TICKS`/`uiTick()`; `double-tap sets a 1-bar loop` must fail (the frozen `uiTick` never advances in the test). Restore. Then drop the `barOffset` clamp; `view follows into the window` must fail.

- [ ] **Step 6: Commit**

```bash
git add src/seq/loop-mode.ts src/seq/router-steps.ts browser-test/logic.mjs
git commit -m "Time the bar double-tap on the wall clock; keep the view in the loop"
```

---

### Task 7: Docs, full suite, device verification

**Files:**
- Modify: `MANUAL.md:523-524`, `CHANGELOG.md`

- [ ] **Step 1: Run the whole local suite from clean**

```bash
npm run build:browser
node browser-test/logic.mjs && node browser-test/app-loop.mjs \
  && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```
Expected: 0 failures in all four. No `engine/` changes in this plan, so `cargo test` is not required.

- [ ] **Step 2: Rewrite the manual's Loop entry**

`MANUAL.md:523` is two lines for the whole feature and cites `§11.5`/`§12.1`, sections that no longer exist. Replace the bullet with a real subsection covering: Loop button tap vs hold; single press selects a bar; double-tap within 450 ms makes a 1-bar loop; two bars pressed set the window; Loop+jog resizes; **Shift + Step 15** doubles; the LED table from the design doc; the strip and the `LOOP 3-4  BAR 3` readout. Reference the new `loop_header` and `loop_strip_midclip` baselines as the screenshots (see `movy/CLAUDE.md` → Documentation for the `make-doc-assets.mjs` workflow).

- [ ] **Step 3: Add the CHANGELOG entry**

Cover the six fixes (strip coordinates, sweep, step row, bar navigation range, invisible loop window, tick-rate-dependent double-tap) and the two additions (pulse grammar, persistent readout).

- [ ] **Step 4: Commit docs**

```bash
git add MANUAL.md CHANGELOG.md
git commit -m "Document the Loop view's bars, LEDs, and readout"
```

- [ ] **Step 5: Device test**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && (./scripts/test.sh && ./scripts/test-seq.sh) \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, **report it to the user in CAPS**.

- [ ] **Step 6: Verify the pulse pairing on hardware**

The one inference in this plan is the two-colour pulse pair (`colors.ts:31`, Push-2 model). On the device, enter Loop mode with a mid-clip loop and confirm: selected bar reads white-dominant and breathes slowly; active bars breathe at the faster quarter rate in the track colour; inactive bars are near-black; the playing bar is solid green. If `base` is ignored once a pulse channel is set (the single-colour-firmware caveat at `session.ts:84`), swap `base`/`anim` for the two selected rows only and regenerate nothing — LED colours are not screenshotted.

- [ ] **Step 7: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:** design §1 → Task 1 + Task 3 (`playheadX` signature); §2 → Task 4; §3 → Task 2; §4 → Task 3; §5 → Task 5; §6 → Task 6; Testing → every task's teeth step + Task 7 Step 1; Docs → Task 7. Design's `toggleStep` sub-bar case, found while reading `router-steps.ts:153`, is folded into Task 2. No gaps.

**Type consistency:** `loopBarColor` returns `CellLed { base, anim, channel }` in Task 4, consumed only by `paintLoopBars` in the same task. `stepInLoop`/`minBarOffset`/`maxBarOffset`/`loopBarCount` defined in Task 1 and used in Tasks 2, 3, 6 under those exact names. `playheadX`'s 4-arg form is defined and every call site updated in Task 3. `loopStepOnAt(bar, nowMs)` defined in Task 6 and used only by its own test and the `loopStepOn` wrapper.

**Note on `loopBarColor`'s `CellLed`:** `session.ts` already exports an identical `CellLed`. Task 4 declares a second one in `leds.ts` rather than importing, because `leds.ts` importing a type from `session.ts` for a non-session feature is the wrong dependency direction. If a third consumer appears, hoist it to `colors.ts`.
