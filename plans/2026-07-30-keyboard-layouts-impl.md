# Scales & Keyboard Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give movy's melodic pad grid four selectable layouts (chromatic fourths / piano / in-key fourths / in-key inline), move the chromatic root to the 4th pad of the bottom row, and make the octave per-track and persistent.

**Architecture:** A new pure module `src/keyboard/layouts.ts` owns all grid geometry and produces an `Int16Array(32)` pad→pitch map. `keyboardState`'s conflated `rootNote` splits into a global `rootPc` plus a per-track `octave[4]`. Every consumer (note-on, LED colour, hold overlay, Keys view) reads the cached map instead of recomputing geometry, which is also a net perf win over today's per-tick div/mod loop.

**Tech Stack:** TypeScript → esbuild bundle (`ui.js`), Node-based browser tests (`browser-test/*.mjs`), no browser and no device needed for tasks 1–5.

**Design spec:** `plans/2026-07-30-keyboard-layouts-design.md`

## Global Constraints

- **File size:** hard limit 200 lines per file; target 50–100.
- **Comments explain WHY** (constraints, invariants, workarounds) — never WHAT the code literally does.
- **No code duplication** — refactor into a shared location before proceeding.
- `model/` never calls display functions; `renderer/` holds no state; `src/types/` never imports from the rest of `src/`.
- Every task ends with `npm run typecheck` clean (zero errors).
- Run `npm run build:browser` before any `browser-test/*.mjs` run — the tests import from `dist/esm/`.
- Commit after every task. Never `git add -A`; add named files.
- Prove each new test has teeth: remove the change, watch the test fail, restore.

**Grid facts** (do not re-derive): pads are MIDI notes 68–99, `PAD_MIN = 68`, 8 columns × 4 rows, index `padNote - PAD_MIN`, index 0 = bottom-left, row 0 = bottom row.

---

### Task 1: `layouts.ts` — pad-map geometry

Pure math, no state, no I/O. Everything else in the plan consumes this.

**Files:**
- Create: `src/keyboard/layouts.ts`
- Test: `browser-test/logic.mjs` (new section, append near the existing `scales` section around line 4165)

**Interfaces:**
- Consumes: `SCALES` from `src/seq/scales.ts` (`{ name, degrees: number[] }[]`, index 0 = Major, index 12 = Chromatic).
- Produces:
  - `COLS = 8`, `ROWS = 4`, `PAD_COUNT = 32`
  - `MODE_CHROMATIC = 0`, `MODE_IN_KEY = 1`, `MODE_NAMES: string[]`
  - `LAYOUT_FOURTHS = 0`, `LAYOUT_PIANO = 1`, `LAYOUT_INLINE = 1`
  - `layoutNames(mode: number): string[]`
  - `degreeToPitch(base: number, degrees: number[], i: number): number`
  - `buildPadMap(mode: number, layout: number, scaleIdx: number, base: number): Int16Array`
  - `isPianoBlack(mode: number, layout: number, padIdx: number): boolean`

- [ ] **Step 1: Write the failing test**

Append this section to `browser-test/logic.mjs`, immediately after the closing `}` of the `inScaleFor` section (the block ending with `eq('chromatic admits all', ...)`):

```js
/* ── pad layouts: grid geometry for every mode/layout combination ────────── */
{
    _log('\npad layouts:');
    const {
        buildPadMap, degreeToPitch, layoutNames, isPianoBlack,
        MODE_CHROMATIC, MODE_IN_KEY, LAYOUT_FOURTHS, LAYOUT_PIANO, LAYOUT_INLINE,
        MODE_NAMES, PAD_COUNT,
    } = await import('../dist/esm/keyboard/layouts.js');

    // Row 0 is the BOTTOM row; index 0 is bottom-left.
    const row = (map, r) => Array.from(map.slice(r * 8, r * 8 + 8));

    eq('mode names', JSON.stringify(MODE_NAMES), '["Chromatic","In Key"]');
    eq('chromatic layouts', JSON.stringify(layoutNames(MODE_CHROMATIC)), '["Fourths","Piano"]');
    eq('in-key layouts', JSON.stringify(layoutNames(MODE_IN_KEY)), '["Fourths","Inline"]');

    // ── Chromatic / Fourths: +1 per column, +5 per row, root on column 4.
    // base 60 (C4) → bottom-left is 57 (A3), so the root sits at index 3.
    {
        const m = buildPadMap(MODE_CHROMATIC, LAYOUT_FOURTHS, 0, 60);
        eq('chrom 4ths bottom row', JSON.stringify(row(m, 0)), '[57,58,59,60,61,62,63,64]');
        eq('chrom 4ths root at col 4', m[3], 60);
        eq('chrom 4ths row step is a fourth', m[8] - m[0], 5);
        eq('chrom 4ths top-left', m[24], 72);
    }

    // ── Chromatic / Piano: whites on rows 0/2, blacks on rows 1/3 shifted right
    // (C# above D). Cols 0, 3 and 7 of a black row are dead. Rows 2-3 are +12.
    {
        const m = buildPadMap(MODE_CHROMATIC, LAYOUT_PIANO, 0, 60);
        eq('piano white row', JSON.stringify(row(m, 0)), '[60,62,64,65,67,69,71,72]');
        eq('piano black row', JSON.stringify(row(m, 1)), '[-1,61,63,-1,66,68,70,-1]');
        eq('piano upper white row', JSON.stringify(row(m, 2)), '[72,74,76,77,79,81,83,84]');
        eq('piano upper black row', JSON.stringify(row(m, 3)), '[-1,73,75,-1,78,80,82,-1]');
        eq('piano root bottom-left', m[0], 60);
        eq('isPianoBlack row0', isPianoBlack(MODE_CHROMATIC, LAYOUT_PIANO, 0), false);
        eq('isPianoBlack row1', isPianoBlack(MODE_CHROMATIC, LAYOUT_PIANO, 9), true);
        eq('isPianoBlack off in fourths', isPianoBlack(MODE_CHROMATIC, LAYOUT_FOURTHS, 9), false);
        eq('isPianoBlack off in key mode', isPianoBlack(MODE_IN_KEY, LAYOUT_PIANO, 9), false);
    }

    // ── In Key / Fourths: +3 scale degrees per row, root bottom-left.
    // C major from 60: C D E F G A B C / F G A B C D E F / B C D E ... 
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_FOURTHS, 0, 60);
        eq('key 4ths bottom row', JSON.stringify(row(m, 0)), '[60,62,64,65,67,69,71,72]');
        eq('key 4ths row1 starts on F', JSON.stringify(row(m, 1)), '[65,67,69,71,72,74,76,77]');
        eq('key 4ths row2 starts on B', JSON.stringify(row(m, 2)), '[71,72,74,76,77,79,81,83]');
        eq('key 4ths root bottom-left', m[0], 60);
        eq('key 4ths never out of scale', row(m, 3).every((p) => [0,2,4,5,7,9,11].includes(((p - 60) % 12 + 12) % 12)), true);
    }

    // ── In Key / Inline: row step = the scale's own degree count, so each row
    // is exactly one octave up for a 7-note scale.
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 0, 60);
        eq('key inline bottom row', JSON.stringify(row(m, 0)), '[60,62,64,65,67,69,71,72]');
        eq('key inline row1 is an octave up', JSON.stringify(row(m, 1)), '[72,74,76,77,79,81,83,84]');
        eq('key inline row3 is 3 octaves up', m[24] - m[0], 36);
    }

    // ── Minor (index 1, [0,2,3,5,7,8,10]) folds correctly.
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 1, 60);
        eq('c minor inline bottom row', JSON.stringify(row(m, 0)), '[60,62,63,65,67,68,70,72]');
    }

    // ── Minor pentatonic (index 10, [0,3,5,7,10]) has 5 degrees, so Inline
    // steps 5 per row and rows overlap — the documented behaviour.
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 10, 60);
        eq('min penta inline bottom row', JSON.stringify(row(m, 0)), '[60,63,65,67,70,72,75,77]');
        eq('min penta inline row step is 5 degrees', m[8], 72);
    }

    // ── degreeToPitch wraps octaves in both directions.
    {
        const maj = [0, 2, 4, 5, 7, 9, 11];
        eq('degree 0', degreeToPitch(60, maj, 0), 60);
        eq('degree 7 wraps an octave', degreeToPitch(60, maj, 7), 72);
        eq('degree 15 wraps two octaves', degreeToPitch(60, maj, 15), 86);
        eq('degree -1 wraps down', degreeToPitch(60, maj, -1), 59);
    }

    // ── Pitches outside 0..127 become dead pads, never clamped notes.
    {
        const m = buildPadMap(MODE_CHROMATIC, LAYOUT_FOURTHS, 0, 2);
        eq('below 0 is dead', m[0], -1);
        const hi = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 0, 120);
        eq('above 127 is dead', hi[PAD_COUNT - 1], -1);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `Cannot find module '.../dist/esm/keyboard/layouts.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/keyboard/layouts.ts`:

```ts
/* Pad → pitch mapping for every melodic pad layout. This is the one place the
 * grid geometry lives: note-on, LED colouring, the Keys view and the step-hold
 * overlay all read the map this builds, so no two of them can disagree about
 * what a pad plays.
 *
 * Grid: 8 columns × 4 rows, index = padNote - PAD_MIN, index 0 = bottom-left,
 * row 0 = bottom. A value of -1 marks a dead pad — a piano gap, or a pitch
 * outside MIDI 0..127. Dead pads are silent and unlit; they are never clamped
 * to a playable note, which would put two pads on the same pitch. */

import { SCALES } from '../seq/scales.js';

export const COLS = 8;
export const ROWS = 4;
export const PAD_COUNT = COLS * ROWS;

export const MODE_CHROMATIC = 0;
export const MODE_IN_KEY = 1;
export const MODE_NAMES = ['Chromatic', 'In Key'];

/* Layout options depend on mode: there is no Inline for Chromatic, and no Piano
 * for In Key (a piano keyboard is chromatic by construction). Both lists are
 * length 2, so the selected index survives a mode flip without reindexing. */
export const LAYOUT_FOURTHS = 0;
export const LAYOUT_PIANO = 1;
export const LAYOUT_INLINE = 1;
const LAYOUTS_CHROMATIC = ['Fourths', 'Piano'];
const LAYOUTS_IN_KEY = ['Fourths', 'Inline'];

export function layoutNames(mode: number): string[] {
    return mode === MODE_IN_KEY ? LAYOUTS_IN_KEY : LAYOUTS_CHROMATIC;
}

const CHROM_ROW_STEP = 5;   // a perfect fourth per row — the guitar fretboard
const CHROM_ROOT_COL = 3;   // root on the 4th pad, leaving 3 pads below it
const KEY_ROW_STEP = 3;     // a fourth measured in scale degrees (Push's In Key)

const PIANO_WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
/* Blacks sit above the white note they lead into (C# above D), so cols 0, 3
 * and 7 have no black key above them. */
const PIANO_BLACK = [-1, 1, 3, -1, 6, 8, 10, -1];

/** Scale-degree index → pitch, wrapping into higher (or lower) octaves. */
export function degreeToPitch(base: number, degrees: number[], i: number): number {
    const len = degrees.length;
    const oct = Math.floor(i / len);
    return base + oct * 12 + degrees[i - oct * len];
}

export function buildPadMap(mode: number, layout: number, scaleIdx: number, base: number): Int16Array {
    const map = new Int16Array(PAD_COUNT);
    const degrees = (SCALES[scaleIdx] ?? SCALES[0]).degrees;
    for (let i = 0; i < PAD_COUNT; i++) {
        const row = (i / COLS) | 0;
        const col = i % COLS;
        let pitch: number;
        if (mode === MODE_IN_KEY) {
            const step = layout === LAYOUT_INLINE ? degrees.length : KEY_ROW_STEP;
            pitch = degreeToPitch(base, degrees, row * step + col);
        } else if (layout === LAYOUT_PIANO) {
            const off = (row & 1) ? PIANO_BLACK[col] : PIANO_WHITE[col];
            pitch = off < 0 ? -1 : base + (row >> 1) * 12 + off;
        } else {
            pitch = base + row * CHROM_ROW_STEP + col - CHROM_ROOT_COL;
        }
        map[i] = (pitch < 0 || pitch > 127) ? -1 : pitch;
    }
    return map;
}

/** True for a piano black key — the only pad that takes the darker LED tint. */
export function isPianoBlack(mode: number, layout: number, padIdx: number): boolean {
    if (mode !== MODE_CHROMATIC || layout !== LAYOUT_PIANO) return false;
    return (((padIdx / COLS) | 0) & 1) === 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build:browser && node browser-test/logic.mjs && npm run typecheck
```

Expected: PASS, 0 failures, typecheck clean.

- [ ] **Step 5: Prove the tests have teeth**

Temporarily change `CHROM_ROOT_COL` from `3` to `0`, rebuild, run `node browser-test/logic.mjs`. Expected: `chrom 4ths bottom row` and `chrom 4ths root at col 4` FAIL. Restore `3` and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/keyboard/layouts.ts browser-test/logic.mjs
git commit -m "Add pad-layout geometry module

Chromatic fourths (root on column 4), chromatic piano, in-key fourths
(+3 degrees per row) and in-key inline (+1 scale octave per row), as a
pure pad-index -> pitch map."
```

---

### Task 2: Split `keyboardState` and cache the pad map

Mechanical but wide: `rootNote` disappears in favour of `rootPc` + `octave[4]`. After this task the app still behaves exactly as before **except** that the chromatic root moves to column 4 (that comes free from Task 1's geometry).

**Files:**
- Modify: `src/keyboard/state.ts` (full rewrite, ~40 lines)
- Modify: `src/app/init.ts:42`
- Modify: `browser-test/logic.mjs` (17 `rootNote` sites), `browser-test/screenshot.mjs` (7 sites), `browser-test/app-loop.mjs` (4 sites), `browser-test/perf.mjs` (2 sites)
- Test: `browser-test/logic.mjs` (new section)

**Interfaces:**
- Consumes: `buildPadMap` from Task 1.
- Produces:
  - `keyboardState: { rootPc, scale, mode, layout, octave: number[], lastPlayedNote }`
  - `OCT_MIN = 0`, `OCT_MAX = 8`
  - `baseNoteFor(track: number): number`
  - `padMapFor(track: number): Int16Array`
  - `padMapBuildCount(): number`
  - `resetPadMapCache(): void`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`, right after the `pad layouts` section from Task 1:

```js
/* ── keyboard state: per-track octave + pad-map cache ───────────────────── */
{
    _log('\nkeyboard state:');
    const { keyboardState, baseNoteFor, padMapFor, padMapBuildCount, resetPadMapCache, OCT_MIN, OCT_MAX }
        = await import('../dist/esm/keyboard/state.js');

    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
    resetPadMapCache();

    eq('default base is C3', baseNoteFor(0), 48);
    eq('octave range', OCT_MIN + '-' + OCT_MAX, '0-8');

    // Per-track: changing one track's octave must not move another's.
    keyboardState.octave[1] = 2;
    eq('track 0 unchanged', baseNoteFor(0), 48);
    eq('track 1 moved down two octaves', baseNoteFor(1), 24);

    // Tonic is global — it moves every track's base together.
    keyboardState.rootPc = 3;
    eq('root pc shifts track 0', baseNoteFor(0), 51);
    eq('root pc shifts track 1', baseNoteFor(1), 27);
    keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];

    // Cache: rebuilt only when one of its inputs changes. The per-tick LED loop
    // calls padMapFor at ~205 Hz, so a rebuild per call would be pure waste.
    resetPadMapCache();
    const b0 = padMapBuildCount();
    for (let i = 0; i < 500; i++) padMapFor(0);
    eq('500 unchanged calls build once', padMapBuildCount() - b0, 1);
    keyboardState.octave[0] = 5;
    padMapFor(0);
    eq('octave change rebuilds', padMapBuildCount() - b0, 2);
    keyboardState.octave[0] = 4;
    padMapFor(0);
    keyboardState.mode = 1;
    padMapFor(0);
    eq('mode change rebuilds', padMapBuildCount() - b0, 4);
    keyboardState.layout = 1;
    padMapFor(0);
    eq('layout change rebuilds', padMapBuildCount() - b0, 5);
    keyboardState.scale = 2;
    padMapFor(0);
    eq('scale change rebuilds', padMapBuildCount() - b0, 6);
    padMapFor(1);
    eq('other track rebuilds (different base)', padMapBuildCount() - b0, 6);

    keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
    keyboardState.octave = [4, 4, 4, 4];
    resetPadMapCache();
    eq('map is 32 entries', padMapFor(0).length, 32);
}
```

Note the second-to-last assertion: track 1 has the same octave as track 0, so its base is identical and the cache must **not** rebuild — the cache key is the base note, not the track index.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `baseNoteFor is not a function`.

- [ ] **Step 3: Rewrite `src/keyboard/state.ts`**

```ts
/* Melodic keyboard state. `rootPc` (the tonic) and the per-track `octave` are
 * deliberately separate: with the chromatic root on column 4 the bottom-left
 * pad is no longer the tonic, so a single absolute "root note" can no longer
 * mean both the musical root and the layout origin. */

import { buildPadMap } from './layouts.js';

export const OCT_MIN = 0;
export const OCT_MAX = 8;   // base 96 + the tallest layout's reach stays < 127

export const keyboardState = {
    rootPc: 0,                /* 0..11 tonic pitch class          (global) */
    scale:  0,                /* index into SCALES                (global) */
    mode:   0,                /* MODE_CHROMATIC | MODE_IN_KEY     (global) */
    layout: 0,                /* index into layoutNames(mode)     (global) */
    octave: [4, 4, 4, 4],     /* per-track; 4 → C3, today's default base 48 */
    /* most recent pad-played MIDI note — the sequencer's step-entry value */
    lastPlayedNote: 60,
};

export function baseNoteFor(track: number): number {
    return keyboardState.octave[track & 3] * 12 + keyboardState.rootPc;
}

/* One-entry cache keyed by everything buildPadMap reads. Only the active
 * track's pads are ever drawn or played, and the LED loop asks for the map on
 * every tick (~205 Hz) — rebuilding 32 entries each time would be waste. The
 * key is the base note rather than the track, so two tracks on the same octave
 * legitimately share one map. */
let cacheKey = '';
let cacheMap: Int16Array | null = null;
let builds = 0;

export function padMapFor(track: number): Int16Array {
    const base = baseNoteFor(track);
    const key = keyboardState.mode + ':' + keyboardState.layout + ':' +
                keyboardState.scale + ':' + base;
    if (cacheMap === null || key !== cacheKey) {
        cacheKey = key;
        cacheMap = buildPadMap(keyboardState.mode, keyboardState.layout, keyboardState.scale, base);
        builds++;
    }
    return cacheMap;
}

/** Test hook: how many times the map has actually been rebuilt. */
export function padMapBuildCount(): number { return builds; }

/** Test hook: drop the cache so a following build is guaranteed. */
export function resetPadMapCache(): void { cacheKey = ''; cacheMap = null; }
```

- [ ] **Step 4: Update `src/app/init.ts`**

Replace line 42 (`keyboardState.rootNote = 48;`) with:

```ts
    keyboardState.rootPc = 0;
    keyboardState.octave = [4, 4, 4, 4];
```

Keep whatever surrounding lines already reset `scale`; if none exist, also set `keyboardState.mode = 0; keyboardState.layout = 0;` there.

- [ ] **Step 5: Migrate the existing test call sites**

Find every remaining reference:

```bash
grep -rn "rootNote" src/ browser-test/*.mjs
```

Rewrite each `keyboardState.rootNote = N` as the equivalent pair:

```js
keyboardState.rootPc = N % 12; keyboardState.octave = [Math.floor(N / 12), Math.floor(N / 12), Math.floor(N / 12), Math.floor(N / 12)];
```

For the common `= 48` case that is `rootPc = 0; octave = [4,4,4,4]`. In `browser-test/app-loop.mjs` the two `rootBefore` assertions become octave assertions:

```js
const octBefore = keyboardState.octave[track];
// ... MoveUp ...
eq('drum track: MoveUp does not shift octave', keyboardState.octave[track], octBefore);
eq('melodic: MoveUp shifts octave +1', keyboardState.octave[track], octBefore + 1);
```

(`track` is whichever slot that block already activates — read the surrounding code.) Leave `src/` call sites other than `init.ts` alone for now; Task 3 rewrites them.

- [ ] **Step 6: Run tests**

```bash
npm run build:browser && node browser-test/logic.mjs && npm run typecheck
```

Expected: the new `keyboard state` section PASSES. Compile errors in `src/seq/pads.ts`, `src/app/tick.ts`, `src/keyboard/handler.ts`, `src/renderer/keys-view.ts` and `src/seq/persist.ts` are **expected here** — Task 3 fixes them. If typecheck must be green before committing, do Steps 1–6 of Task 3 first and make this one commit; otherwise commit now.

- [ ] **Step 7: Commit**

```bash
git add src/keyboard/state.ts src/app/init.ts browser-test/logic.mjs browser-test/app-loop.mjs browser-test/screenshot.mjs browser-test/perf.mjs
git commit -m "Split keyboardState into global tonic + per-track octave

rootNote conflated the musical tonic with the bottom-left pad's pitch;
moving the chromatic root off column 1 makes that impossible. Adds a
one-entry pad-map cache so the per-tick LED loop stops recomputing grid
geometry."
```

---

### Task 3: Wire the pad map into notes, LEDs and the octave buttons

**Files:**
- Modify: `src/seq/pads.ts` (rewrite, ~55 lines)
- Modify: `src/keyboard/handler.ts` (~50 lines)
- Modify: `src/keyboard/drum-handler.ts:6-15` and `src/keyboard/leds.ts:4-11` (drop the unused `rootNote` param)
- Modify: `src/app/tick.ts` (lines ~138, ~318-321, ~413, ~503, ~529-538)
- Modify: `src/midi/router.ts` (line ~178 drum call, line ~537 octave buttons)
- Modify: `src/renderer/keys-view.ts:5,17-18`
- Test: `browser-test/logic.mjs`, `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `padMapFor`, `baseNoteFor`, `keyboardState`, `OCT_MIN`, `OCT_MAX` (Task 2); `isPianoBlack` (Task 1).
- Produces:
  - `padPitch(track: number, padNote: number, padMin: number): number` (`src/seq/pads.ts`) — replaces `chromaticPitch`
  - `padColor(padNote: number, padMin: number, track: number, isPlaying: boolean, holdNotes?: number[] | null): number` (`src/seq/pads.ts`) — replaces `chromaticPadColor`
  - `setRootPc(pc: number): void`, `changeOctave(track: number, delta: number): void` (`src/keyboard/handler.ts`) — replace `setRoot`/`changeRoot`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`, after the `keyboard state` section:

```js
/* ── pad colours: root / scale / piano blacks / dead pads ───────────────── */
{
    _log('\npad colours:');
    const { padColor, padPitch } = await import('../dist/esm/seq/pads.js');
    const { keyboardState, resetPadMapCache } = await import('../dist/esm/keyboard/state.js');
    const { resetHeld } = await import('../dist/esm/seq/held.js');

    const C_BLACK = 0, C_WHITE = 120, C_DARKGREY = 124, C_LIGHTGREY = 118, C_GREEN = 11;
    const TRACK0 = 127;
    const PAD_MIN = 68;

    if (typeof resetHeld === 'function') resetHeld();
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
    resetPadMapCache();

    // Chromatic fourths, base 48: bottom-left is 45 (A2), root C3 at index 3.
    eq('pitch bottom-left', padPitch(0, PAD_MIN, PAD_MIN), 45);
    eq('pitch at root column', padPitch(0, PAD_MIN + 3, PAD_MIN), 48);
    eq('root pad is track colour', padColor(PAD_MIN + 3, PAD_MIN, 0, false), TRACK0);
    eq('in-scale pad is light grey', padColor(PAD_MIN + 5, PAD_MIN, 0, false), C_LIGHTGREY); // D
    eq('out-of-scale pad is dark', padColor(PAD_MIN + 4, PAD_MIN, 0, false), C_BLACK);       // C#
    eq('sounding pad is green', padColor(PAD_MIN + 3, PAD_MIN, 0, true), C_GREEN);
    eq('hold overlay pad is white', padColor(PAD_MIN + 3, PAD_MIN, 0, false, [48]), C_WHITE);

    // Piano: blacks take the darker tint so the keyboard shape reads; the gap
    // columns are dead.
    keyboardState.layout = 1; resetPadMapCache();
    eq('piano root still track colour', padColor(PAD_MIN, PAD_MIN, 0, false), TRACK0);
    eq('piano white D is light grey', padColor(PAD_MIN + 1, PAD_MIN, 0, false), C_LIGHTGREY);
    eq('piano gap col 0 is dead', padColor(PAD_MIN + 8, PAD_MIN, 0, false), C_BLACK);
    eq('piano black C# is out of C major, so dark', padColor(PAD_MIN + 9, PAD_MIN, 0, false), C_BLACK);
    // With the Chromatic scale (index 12) every pad lights, and blacks are dim.
    keyboardState.scale = 12; resetPadMapCache();
    eq('piano black lights dark grey in chromatic scale', padColor(PAD_MIN + 9, PAD_MIN, 0, false), C_DARKGREY);
    eq('piano white lights light grey in chromatic scale', padColor(PAD_MIN + 1, PAD_MIN, 0, false), C_LIGHTGREY);
    eq('piano gap stays dead in chromatic scale', padColor(PAD_MIN + 8, PAD_MIN, 0, false), C_BLACK);

    // In Key: every pad is in scale, so nothing is dark except dead pads.
    keyboardState.mode = 1; keyboardState.layout = 0; keyboardState.scale = 0;
    resetPadMapCache();
    eq('key mode root bottom-left', padColor(PAD_MIN, PAD_MIN, 0, false), TRACK0);
    eq('key mode non-root is light grey', padColor(PAD_MIN + 1, PAD_MIN, 0, false), C_LIGHTGREY);

    keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
    resetPadMapCache();
}

/* ── octave buttons: per-track, clamped ─────────────────────────────────── */
{
    _log('\noctave buttons:');
    const { changeOctave, setRootPc } = await import('../dist/esm/keyboard/handler.js');
    const { keyboardState, OCT_MIN, OCT_MAX } = await import('../dist/esm/keyboard/state.js');

    keyboardState.octave = [4, 4, 4, 4];
    changeOctave(1, 1);
    eq('shifts only the named track', JSON.stringify(keyboardState.octave), '[4,5,4,4]');
    changeOctave(1, -1);
    eq('shifts back', JSON.stringify(keyboardState.octave), '[4,4,4,4]');

    keyboardState.octave[2] = OCT_MAX;
    changeOctave(2, 1);
    eq('clamps at the top', keyboardState.octave[2], OCT_MAX);
    keyboardState.octave[2] = OCT_MIN;
    changeOctave(2, -1);
    eq('clamps at the bottom', keyboardState.octave[2], OCT_MIN);
    keyboardState.octave = [4, 4, 4, 4];

    setRootPc(13);
    eq('root pc wraps above B', keyboardState.rootPc, 1);
    setRootPc(-1);
    eq('root pc wraps below C', keyboardState.rootPc, 11);
    setRootPc(0);
}
```

If `src/seq/held.js` has no `resetHeld` export, drop that import and the guarded call — the surrounding tests already leave the held ledger empty.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `padColor is not a function` / build error on the still-unmigrated `src/` files.

- [ ] **Step 3: Rewrite `src/seq/pads.ts`**

```ts
/* Melodic pad pitch + LED colour. Geometry comes entirely from the layout
 * module's pad map (keyboard/layouts.ts); this file only decides what colour a
 * pad's pitch deserves.
 *
 * Priority: dead > sounding > held/hold-overlay > root > in-scale > out.
 * Piano black keys take the darker in-scale tint, which is what makes the
 * keyboard shape readable on the grid. */

import { C_BLACK, C_GREEN, C_WHITE, C_DARKGREY, C_LIGHTGREY, trackColor } from './colors.js';
import { noteHeld } from './held.js';
import { inScaleFor } from './scales.js';
import { keyboardState, padMapFor } from '../keyboard/state.js';
import { isPianoBlack } from '../keyboard/layouts.js';

/** MIDI pitch this pad plays on `track`, or -1 for a dead pad. */
export function padPitch(track: number, padNote: number, padMin: number): number {
    return padMapFor(track)[padNote - padMin] ?? -1;
}

/* holdNotes: when non-null, those pitches show white instead of the lastHeld
 * set (step-hold overlay mode). null = normal mode using lastHeld. */
export function padColor(
    padNote:   number,
    padMin:    number,
    track:     number,
    isPlaying: boolean,
    holdNotes: number[] | null = null,
): number {
    const idx = padNote - padMin;
    const pitch = padMapFor(track)[idx] ?? -1;
    if (pitch < 0) return C_BLACK;
    if (isPlaying) return C_GREEN;
    const white = holdNotes !== null ? holdNotes.includes(pitch) : noteHeld(track, pitch);
    if (white) return C_WHITE;
    if ((((pitch - keyboardState.rootPc) % 12) + 12) % 12 === 0) return trackColor(track);
    if (!inScaleFor(pitch, keyboardState.rootPc, keyboardState.scale)) return C_BLACK;
    return isPianoBlack(keyboardState.mode, keyboardState.layout, idx) ? C_DARKGREY : C_LIGHTGREY;
}
```

Delete the old `chromaticPitch`, `inScale` and `chromaticPadColor` exports and the now-unused `COLS`/`ROW_INTERVAL` constants. If `inScale` has other callers (`grep -rn "inScale(" src/`), point them at `inScaleFor` directly.

- [ ] **Step 4: Rewrite the handler**

`src/keyboard/handler.ts` — replace the whole file body below the imports:

```ts
import { keyboardState, padMapFor, OCT_MIN, OCT_MAX } from './state.js';
import { noteSounded, noteReleased } from './held-notes.js';
import { emitNoteOff, releaseAllLive } from './release.js';
import { padColor, padPitch } from '../seq/pads.js';
import { C_GREEN } from '../seq/colors.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';

/* Live pad note. Emits on the track's MIDI channel (0x9n) so it reaches that
 * track's chain slot, carrying real velocity. The caller supplies the final
 * velocity (Full Velocity is applied there). */
export function noteOn(padNote: number, padMin: number, track: number, vel: number): void {
    const midiNote = padPitch(track, padNote, padMin);
    if (midiNote < 0) return;              // dead pad: piano gap or out of range
    noteSounded(padNote, track, midiNote);
    keyboardState.lastPlayedNote = midiNote;
    shadow_send_midi_to_dsp([MidiNoteOn | track, midiNote, vel]);
    setLED(padNote, C_GREEN, true); // immediate green feedback before the next poll
}

/* The ledger — not the caller and not the currently active track — decides
 * which channel this off goes to. A track switch, module change, layout change
 * or view change between press and release must not be able to redirect it. */
export function noteOff(padNote: number, padMin: number): void {
    const n = noteReleased(padNote);
    if (n === undefined) return;
    emitNoteOff(n.track, n.pitch);
    setLED(padNote, padColor(padNote, padMin, n.track, false), true);
}

/* Set the global tonic's pitch class, wrapping at the octave edges (B↔C).
 * Pads are deliberately NOT painted here: app/tick.ts owns pad LEDs and is
 * track-aware (chromatic vs drum vs Session clip grid), so a root change
 * repaints on the next tick without ever overwriting a drum rack or clip grid. */
export function setRootPc(pc: number): void {
    releaseAllLive();
    keyboardState.rootPc = (((pc % 12) + 12) % 12);
    markUiStateDirty();
}

/* Shift one track's octave. Per-track by design: switching to a bass part
 * should not cost the lead track its register. */
export function changeOctave(track: number, delta: number): void {
    const t = track & 3;
    const next = Math.max(OCT_MIN, Math.min(OCT_MAX, keyboardState.octave[t] + delta));
    if (next === keyboardState.octave[t]) return;
    releaseAllLive();
    keyboardState.octave[t] = next;
    markUiStateDirty();
}
```

- [ ] **Step 5: Drop the dead `rootNote` params from the drum path**

In `src/keyboard/drum-handler.ts`, remove the `rootNote: number,` parameter from `drumPadOn` (it is never read in the body). In `src/keyboard/leds.ts`, remove `rootNote: number,` from `drumPadLedColor` (likewise never read). Then fix the two call sites:

- `src/midi/router.ts:~178` — drop the `keyboardState.rootNote,` argument.
- `src/app/tick.ts:~503` — drop the `keyboardState.rootNote,` argument.
- `browser-test/logic.mjs` — the `drumPadOn`/`drumPadOff` section calls `drumPadOn` directly; drop the corresponding positional argument there too.

- [ ] **Step 6: Update `src/app/tick.ts`**

Four edits:

1. The UI-state key (~line 138) must react to every new field, or a layout change would not trigger a redraw:

```ts
        keyboardState.rootPc, keyboardState.scale,
        keyboardState.mode, keyboardState.layout,
        keyboardState.octave[appState.activeSlot]].join(',');
```

2. The init LED batch (~lines 318–323):

```ts
        for (let i = appState.initLedIndex; i < end; i++) {
            const p = PAD_MIN + i;
            const color = padColor(p, PAD_MIN, appState.activeSlot, false);
            chromaticCache[i] = color;
            setLED(p, color, true);
        }
```

Delete the now-unused `const base = keyboardState.rootNote;` above it.

3. The Keys view render (~line 413): `renderKeysView(activeModel?.getModuleName() ?? '—', baseNoteFor(appState.activeSlot), midiNoteName)`.

4. The per-tick chromatic loop (~lines 529–543):

```ts
        const track     = appState.activeSlot;
        const map       = padMapFor(track);
        const holdNotes = seqState.holdStep >= 0 && seqState.holdNotes.length > 0
            ? displayHoldNotes() : null;
        for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
            const p     = PAD_MIN + i;
            const pitch = map[i];
            const isPlaying = isSounding(p) || (pitch >= 0 && activeHasNote(track, pitch));
            const color = padColor(p, PAD_MIN, track, isPlaying, holdNotes);
            if (chromaticCache[i] !== color) {
                chromaticCache[i] = color;
                setLED(p, color, true);
            }
        }
```

Update the imports at the top of `tick.ts`: `chromaticPitch, chromaticPadColor` → `padPitch, padColor`, and add `baseNoteFor, padMapFor` to the `keyboard/state.js` import.

- [ ] **Step 7: Update `src/midi/router.ts` octave buttons (~line 534)**

```ts
    if (d1 === MoveUp || d1 === MoveDown) {
        if (trackIsDrum(appState.activeSlot)) return;
        if (d2 > 0) {
            changeOctave(appState.activeSlot, d1 === MoveUp ? 1 : -1);
            setButtonLED(d1, WHITE_BRIGHT, true);
        } else {
            setButtonLED(d1, WHITE_DIM, true);
        }
        appState.dirty = true;
        return;
    }
```

Change the import on line 7 from `changeRoot` to `changeOctave`.

- [ ] **Step 8: Update `src/renderer/keys-view.ts`**

Rename the parameter for accuracy — it is the layout's base note, not the tonic:

```ts
export function renderKeysView(moduleName: string, baseNote: number, midiNoteName: (n: number) => string): void {
```

and inside, `midiNoteName(baseNote)` / `midiNoteName(baseNote + 24)`.

- [ ] **Step 9: Run all local tests**

```bash
npm run build:browser && npm run typecheck \
  && node browser-test/logic.mjs \
  && node browser-test/dump-replay.mjs \
  && node browser-test/app-loop.mjs
```

Expected: typecheck clean, all three suites 0 failures. `screenshot.mjs` may still fail if any melodic-pad baseline changed — that is handled in Task 4.

- [ ] **Step 10: Prove the tests have teeth**

In `padColor`, temporarily swap the `isPianoBlack ? C_DARKGREY : C_LIGHTGREY` ternary for a bare `C_LIGHTGREY`. Rebuild and run `node browser-test/logic.mjs`. Expected: `piano black lights dark grey in chromatic scale` FAILS. Restore and re-run.

- [ ] **Step 11: Commit**

```bash
git add src/seq/pads.ts src/keyboard/handler.ts src/keyboard/drum-handler.ts src/keyboard/leds.ts src/app/tick.ts src/midi/router.ts src/renderer/keys-view.ts browser-test/logic.mjs browser-test/app-loop.mjs
git commit -m "Drive pad notes and LEDs from the layout map

padPitch/padColor replace chromaticPitch/chromaticPadColor and read the
cached pad map, so piano gaps are silent and unlit and in-key layouts
colour correctly. +/- now shifts only the active track's octave. Drops
the rootNote argument both drum functions ignored."
```

---

### Task 4: SET PARAMETERS page — rearrange and add MODE / LAYOUT

**Files:**
- Modify: `src/seq/main-page.ts` (rewrite, ~130 lines)
- Modify: `src/seq/main-page-vm.ts` (~95 lines)
- Modify: `browser-test/logic.mjs` (the `main params page` and `main params page ViewModel` sections, and the `root change does not paint pads directly` section — all use the old knob indices)
- Modify: `browser-test/screenshot.mjs` (7 `main-*` scenes) + new scenes
- Modify: `browser-test/perf.mjs` (2 main-page scenes)

**Interfaces:**
- Consumes: `setRootPc` (Task 3); `MODE_NAMES`, `layoutNames` (Task 1); `keyboardState` (Task 2).
- Produces:
  - `mainPageState: { active, origin, touchedKnob, overlayKnob, overlaySel }` — `overlayKnob === -1` means closed; replaces `scaleOverlay`/`scaleSel`.
  - Knob map: 0 TEMPO, 1 SWING, 2 LINK, 3 unused, 4 ROOT, 5 KEY, 6 MODE, 7 LAYOUT.

- [ ] **Step 1: Write the failing test**

Replace the body of the existing `main params page` section in `browser-test/logic.mjs` (currently around line 4167, the block whose assertions start `page active after open`) with:

```js
/* ── main params page: state machine + knob/touch/release handlers ──────── */
{
    _log('\nmain params page:');
    const {
        mainPageState, openMainPage, closeMainPage, mainPageActive,
        mainPageKnob, mainPageTouch, mainPageRelease, resetMainPage,
    } = await import('../dist/esm/seq/main-page.js');
    const { peekSeqCmdQueue, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');
    const { resetSeqState } = await import('../dist/esm/seq/state.js');

    resetMainPage(); resetSeqEngine(); resetSeqState();
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    openMainPage(3);
    eq('page active after open', mainPageActive(), true);

    // Knob 0 tempo: 8 raw delta units = 1 detent = +1 BPM (bpmX100 starts 12000).
    mainPageKnob(0, 8);
    eq('tempo +1 BPM emits bpm 12100', peekSeqCmdQueue().some((c) => c.startsWith('bpm 12100')), true);
    // Knob 1 swing.
    mainPageKnob(1, 8);
    eq('swing +1 emits swing 51', peekSeqCmdQueue().some((c) => c === 'swing 51'), true);
    // Knob 2 is now LINK (moved off knob 4 by the row rearrangement).
    mainPageKnob(2, 8);
    eq('link on emits link 1', peekSeqCmdQueue().some((c) => c === 'link 1'), true);

    // Knob 4 is ROOT: cycles the pitch class, wrapping B↔C.
    keyboardState.rootPc = 11;
    mainPageKnob(4, 8);
    eq('root wraps B->C', keyboardState.rootPc, 0);
    mainPageKnob(4, -8);
    eq('root wraps C->B', keyboardState.rootPc, 11);
    keyboardState.rootPc = 0;

    // Knob 5 KEY: touch opens the overlay, turn scrolls, release commits.
    mainPageTouch(5, true);
    eq('key overlay opens on touch', mainPageState.overlayKnob, 5);
    eq('key overlay seeded from current scale', mainPageState.overlaySel, 0);
    mainPageKnob(5, 8);
    eq('key overlay scrolled', mainPageState.overlaySel, 1);
    mainPageRelease(5);
    eq('scale committed on release', keyboardState.scale, 1);
    eq('key overlay closed on release', mainPageState.overlayKnob, -1);

    // Knob 6 MODE: Chromatic → In Key.
    mainPageTouch(6, true);
    eq('mode overlay opens', mainPageState.overlayKnob, 6);
    mainPageKnob(6, 8);
    eq('mode overlay scrolled', mainPageState.overlaySel, 1);
    mainPageKnob(6, 8);
    eq('mode overlay clamps at the end', mainPageState.overlaySel, 1);
    mainPageRelease(6);
    eq('mode committed', keyboardState.mode, 1);

    // Knob 7 LAYOUT: the option list follows mode (In Key → Fourths/Inline).
    mainPageTouch(7, true);
    mainPageKnob(7, 8);
    mainPageRelease(7);
    eq('layout committed', keyboardState.layout, 1);

    // Flipping back to Chromatic keeps the index valid (both lists are length 2).
    mainPageTouch(6, true); mainPageKnob(6, -8); mainPageRelease(6);
    eq('mode back to chromatic', keyboardState.mode, 0);
    eq('layout index survives the mode flip', keyboardState.layout, 1);

    eq('close returns origin view', closeMainPage(), 3);
    eq('page inactive after close', mainPageActive(), false);
    keyboardState.scale = 0; keyboardState.mode = 0; keyboardState.layout = 0;
}
```

Then replace the `main params page ViewModel` section body with:

```js
/* ── main params page ViewModel ──────────────────────────────────────────── */
{
    _log('\nmain params page ViewModel:');
    const { buildMainPageVM } = await import('../dist/esm/seq/main-page-vm.js');
    const { mainPageState, resetMainPage } = await import('../dist/esm/seq/main-page.js');
    const { seqState } = await import('../dist/esm/seq/state.js');
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');

    resetMainPage();
    seqState.bpmX100 = 12000; seqState.swingPct = 50;
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    mainPageState.active = true; mainPageState.touchedKnob = 0;
    let vm = buildMainPageVM();
    // Row 0: TEMPO SWING LINK -, row 1: ROOT KEY MODE LAYOUT.
    eq('tempo cell shows 120', vm.rows[0][0].displayValue, '120');
    eq('swing cell shows 50%', vm.rows[0][1].displayValue, '50%');
    eq('link cell shows OFF', vm.rows[0][2].displayValue, 'OFF');
    eq('row 0 slot 3 is empty', vm.rows[0][3], null);
    eq('root cell shows C', vm.rows[1][0].displayValue, 'C');
    eq('key cell shows Major', vm.rows[1][1].displayValue, 'Major');
    eq('mode cell shows Chromatic', vm.rows[1][2].displayValue, 'Chromatic');
    eq('layout cell shows Fourths', vm.rows[1][3].displayValue, 'Fourths');
    eq('toast names tempo', vm.toast.fullName, 'Tempo');
    eq('tempo toast value', vm.toast.value, '120 bpm');

    // Layout options follow mode.
    keyboardState.mode = 1;
    vm = buildMainPageVM();
    eq('in-key mode cell', vm.rows[1][2].displayValue, 'In Key');
    eq('in-key layout options', JSON.stringify(vm.rows[1][3].options), '["Fourths","Inline"]');
    keyboardState.mode = 0;

    // Overlays: one generic mechanism for KEY, MODE and LAYOUT.
    mainPageState.overlayKnob = 5; mainPageState.overlaySel = 1; mainPageState.touchedKnob = 5;
    vm = buildMainPageVM();
    eq('key overlay carries 13 scales', vm.overlay && vm.overlay.options.length, 13);
    eq('key overlay selection', vm.overlay?.selected, 1);
    eq('key overlay targets knob 5', vm.overlay?.slot, 5);

    mainPageState.overlayKnob = 6; mainPageState.overlaySel = 1; mainPageState.touchedKnob = 6;
    vm = buildMainPageVM();
    eq('mode overlay options', JSON.stringify(vm.overlay?.options), '["Chromatic","In Key"]');
    eq('mode overlay targets knob 6', vm.overlay?.slot, 6);

    mainPageState.overlayKnob = 7; mainPageState.overlaySel = 1; mainPageState.touchedKnob = 7;
    vm = buildMainPageVM();
    eq('layout overlay options', JSON.stringify(vm.overlay?.options), '["Fourths","Piano"]');
    resetMainPage();
}
```

Finally, in the `root change does not paint pads directly` section, change `mainPageKnob(2, 8)` to `mainPageKnob(4, 8)` and the assertion to `eq('root knob turn changes rootPc', keyboardState.rootPc, 1);` (with `keyboardState.rootPc = 0;` in the setup instead of `rootNote = 48`).

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `mainPageState.overlayKnob` is `undefined`, knob 2 does not drive LINK.

- [ ] **Step 3: Rewrite `src/seq/main-page.ts`**

Keep the existing imports, swapping `setRoot` for `setRootPc` and adding the layout names:

```ts
import { SCALE_NAMES } from './scales.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { setRootPc } from '../keyboard/handler.js';
```

Replace `mainPageState`, `accum` and the four handlers:

```ts
const BPM_MIN_X100 = 2000, BPM_MAX_X100 = 30000;
const SWING_MIN = 50, SWING_MAX = 80;

/* Knob map: 0 TEMPO, 1 SWING, 2 LINK, 3 unused, 4 ROOT, 5 KEY, 6 MODE,
 * 7 LAYOUT — the four musical params share the bottom row. */
const K_TEMPO = 0, K_SWING = 1, K_LINK = 2, K_ROOT = 4, K_KEY = 5, K_MODE = 6, K_LAYOUT = 7;
const OVERLAY_KNOBS = [K_KEY, K_MODE, K_LAYOUT];

export const mainPageState = {
    active: false,
    origin: 0,                          // view to restore on Back
    touchedKnob: -1,                    // 0..7 drives the top toast; -1 none
    overlayKnob: -1,                    // knob whose enum list is open; -1 closed
    overlaySel: 0,                      // highlighted entry while the list is open
};

const accum = [0, 0, 0, 0, 0, 0, 0, 0];

/** Options behind an overlay knob. LAYOUT's list depends on the current mode. */
export function overlayOptions(k: number): string[] {
    if (k === K_KEY) return SCALE_NAMES;
    if (k === K_MODE) return MODE_NAMES;
    return layoutNames(keyboardState.mode);
}

function overlayCurrent(k: number): number {
    if (k === K_KEY) return keyboardState.scale;
    if (k === K_MODE) return keyboardState.mode;
    return Math.min(keyboardState.layout, layoutNames(keyboardState.mode).length - 1);
}

function overlayCommit(k: number, sel: number): void {
    if (k === K_KEY) keyboardState.scale = sel;
    else if (k === K_MODE) {
        keyboardState.mode = sel;
        // Chromatic and In Key both offer two layouts, so the index carries
        // over; the clamp is here so adding a third option later can't strand it.
        keyboardState.layout = Math.min(keyboardState.layout, layoutNames(sel).length - 1);
    } else keyboardState.layout = sel;
    markUiStateDirty();
}
```

`openMainPage` / `closeMainPage` / `resetMainPage` set `overlayKnob = -1; overlaySel = 0;` wherever they previously set `scaleOverlay = false; scaleSel = 0;`.

```ts
export function mainPageTouch(k: number, down: boolean): void {
    mainPageState.touchedKnob = down ? k : -1;
    if (down && OVERLAY_KNOBS.indexOf(k) >= 0) {
        mainPageState.overlayKnob = k;
        mainPageState.overlaySel = overlayCurrent(k);
        accum[k] = 0;
    }
}

export function mainPageRelease(k: number): void {
    if (mainPageState.overlayKnob === k) {
        overlayCommit(k, mainPageState.overlaySel);
        mainPageState.overlayKnob = -1;
    }
    if (mainPageState.touchedKnob === k) mainPageState.touchedKnob = -1;
}

export function mainPageKnob(k: number, delta: number): void {
    mainPageState.touchedKnob = k;
    const n = countDetents(accum, k, delta);
    if (n === 0) return;
    if (k === K_TEMPO) {
        const next = Math.max(BPM_MIN_X100, Math.min(BPM_MAX_X100, seqState.bpmX100 + n * 100));
        if (next !== seqState.bpmX100) {
            seqState.bpmX100 = next;
            seqCmd('bpm ' + next);
            // Also drive Move's device-wide tempo via the Link override, so a
            // following Move tracks the knob (design §7 Phase 3).
            scheduleTempoOverride(next);
        }
    } else if (k === K_SWING) {
        const next = Math.max(SWING_MIN, Math.min(SWING_MAX, seqState.swingPct + n));
        if (next !== seqState.swingPct) { seqState.swingPct = next; seqCmd('swing ' + next); }
    } else if (k === K_LINK) {
        // LINK toggle: turn right = ON, left = OFF. Persisted per set.
        const on = n > 0;
        if (on !== seqState.linkEnabled) {
            seqState.linkEnabled = on;
            seqCmd('link ' + (on ? 1 : 0));
            markUiStateDirty();
        }
    } else if (k === K_ROOT) {
        // Cycles the pitch class, wrapping B↔C; the +/- buttons own the octave.
        setRootPc(keyboardState.rootPc + n);
    } else if (mainPageState.overlayKnob === k) {
        const max = overlayOptions(k).length - 1;
        mainPageState.overlaySel = Math.max(0, Math.min(max, mainPageState.overlaySel + n));
    }
}
```

- [ ] **Step 4: Rewrite `src/seq/main-page-vm.ts`**

Swap `rootName()` to read the tonic pitch class, add the two cells, and rearrange the rows:

```ts
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { mainPageState, overlayOptions } from './main-page.js';

/* Tonic name without an octave suffix — midiNoteName(0) is 'C-1'. */
function rootName(): string {
    return midiNoteName(keyboardState.rootPc).replace(/-?\d+$/, '');
}
```

Cells (keep `tempo`, `sw`, `root`, `key`, `link` as they are apart from `root`'s `rootName()` source, then add):

```ts
    const mode = cell({
        shortName: 'MODE', fullName: 'Note Mode', type: 'enum',
        options: MODE_NAMES, isLongEnum: true,
        enumIndex: keyboardState.mode, displayValue: MODE_NAMES[keyboardState.mode],
        normalizedValue: keyboardState.mode / (MODE_NAMES.length - 1),
    });
    const lNames = layoutNames(keyboardState.mode);
    const li = Math.min(keyboardState.layout, lNames.length - 1);
    const layout = cell({
        shortName: 'LAYOUT', fullName: 'Pad Layout', type: 'enum',
        options: lNames, isLongEnum: true,
        enumIndex: li, displayValue: lNames[li],
        normalizedValue: lNames.length > 1 ? li / (lNames.length - 1) : 0,
    });
```

Toast indexing must be **knob-indexed**, not cell-order-indexed, now that knob 3 is empty:

```ts
    const cells = [tempo, sw, link, null, root, key, mode, layout];
    const tk = mainPageState.touchedKnob;
    let toast = null;
    const touched = tk >= 0 && tk < cells.length ? cells[tk] : null;
    if (touched) {
        touched.touched = true;
        // Tempo's toast carries the unit; the others mirror the cell value.
        toast = {
            fullName: touched.fullName,
            value: tk === 0 ? bpm + ' bpm' : touched.displayValue,
            browseHint: false,
        };
    }

    const overlay = mainPageState.overlayKnob >= 0
        ? {
            slot: mainPageState.overlayKnob,
            options: overlayOptions(mainPageState.overlayKnob),
            selected: mainPageState.overlaySel,
          }
        : null;
```

and the returned rows:

```ts
        rows: [[tempo, sw, link, null], [root, key, mode, layout]],
```

- [ ] **Step 5: Run the logic tests**

```bash
npm run build:browser && npm run typecheck && node browser-test/logic.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 6: Update the screenshot scenes**

In `browser-test/screenshot.mjs`, every `main-*` scene sets `keyboardState.rootNote = N` — replace with `keyboardState.rootPc = N % 12; keyboardState.octave = [4,4,4,4];` and add `keyboardState.mode = 0; keyboardState.layout = 0;`. Update `main-root-touched` to `touchedKnob = 4` (root moved from knob 2 to knob 4) and `main-key-overlay` to `mainPageState.overlayKnob = 5; mainPageState.overlaySel = 1;`. Then add two scenes next to `main-key-overlay`, following the exact shape of the surrounding cases:

```js
        case 'main-mode-overlay': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.scale = 0;
            keyboardState.mode = 0; keyboardState.layout = 0;
            keyboardState.octave = [4, 4, 4, 4];
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.overlayKnob = 6; mainPageState.overlaySel = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-layout-overlay': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.scale = 0;
            keyboardState.mode = 1; keyboardState.layout = 0;   // In Key: Fourths/Inline
            keyboardState.octave = [4, 4, 4, 4];
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.overlayKnob = 7; mainPageState.overlaySel = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
```

Register both names in the scene list the file iterates (find it by `grep -n "main-key-overlay" browser-test/screenshot.mjs` — the name appears both in the `switch` and in the array of scene names).

- [ ] **Step 7: Regenerate and eyeball the baselines**

```bash
node browser-test/screenshot.mjs --update
node browser-test/screenshot.mjs
```

Expected: 0 failures. Then **look at** `browser-test/screenshots/baseline/main-page.png`, `main-mode-overlay.png` and `main-layout-overlay.png` with the Read tool and confirm the bottom row reads `ROOT KEY MODE LAYOUT` and both overlays list the right options. A baseline update that encodes a rendering bug is worse than no baseline.

- [ ] **Step 8: Fix the perf scenes**

`browser-test/perf.mjs` Test 4b/4c set `rootNote` and `scaleOverlay`. Apply the same substitutions (`rootPc`/`octave`, `overlayKnob = 5; overlaySel = 1`). Then:

```bash
node browser-test/perf.mjs
```

Expected: all budgets green. The page gained two cells, so `fill_rect calls (main params page)` will rise; if it crosses `FILL_RECT_PER_RENDER_MAX = 1500`, report the number rather than silently raising the ceiling.

- [ ] **Step 9: Commit**

```bash
git add src/seq/main-page.ts src/seq/main-page-vm.ts browser-test/logic.mjs browser-test/screenshot.mjs browser-test/perf.mjs browser-test/screenshots/baseline
git commit -m "Add MODE and LAYOUT to the SET PARAMETERS page

Rearranges the page to TEMPO/SWING/LINK over ROOT/KEY/MODE/LAYOUT and
generalises the single-purpose scale overlay into one overlay mechanism
shared by all three enum knobs."
```

---

### Task 5: Persistence and legacy-blob migration

**Files:**
- Modify: `src/seq/persist.ts:40-63`
- Test: `browser-test/logic.mjs` (the `UI-state persistence round-trip` section, ~line 4456)

**Interfaces:**
- Consumes: `keyboardState` (Task 2), `MODE_NAMES`/`layoutNames` (Task 1).
- Produces: no new exports; `serializeUiState()` / `applyUiState()` keep their signatures.

- [ ] **Step 1: Write the failing test**

Replace the body of the `UI-state persistence round-trip` section with:

```js
/* ── UI-state persistence round-trip ──────────────────────────────────── */
{
    _log('\nUI-state persistence round-trip:');
    const { serializeUiState, applyUiState } = await import('../dist/esm/seq/persist.js');
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');

    keyboardState.rootPc = 2; keyboardState.scale = 2;
    keyboardState.mode = 1; keyboardState.layout = 1;
    keyboardState.octave = [3, 5, 4, 6];
    const blob = serializeUiState();

    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
    applyUiState(blob);
    eq('root pc restored', keyboardState.rootPc, 2);
    eq('scale restored', keyboardState.scale, 2);
    eq('mode restored', keyboardState.mode, 1);
    eq('layout restored', keyboardState.layout, 1);
    eq('per-track octaves restored', JSON.stringify(keyboardState.octave), '[3,5,4,6]');

    // A legacy blob has one absolute `root` and no oct/mode/layout: derive the
    // tonic and give every track that octave. Existing sets must keep working.
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 1; keyboardState.layout = 1;
    keyboardState.octave = [1, 1, 1, 1];
    applyUiState(JSON.stringify({ root: 50, scale: 3 }));
    eq('legacy root gives pitch class', keyboardState.rootPc, 2);
    eq('legacy root fills every octave', JSON.stringify(keyboardState.octave), '[4,4,4,4]');
    eq('legacy scale restored', keyboardState.scale, 3);
    eq('legacy blob resets mode', keyboardState.mode, 0);
    eq('legacy blob resets layout', keyboardState.layout, 0);

    // Out-of-range values are clamped, never trusted.
    applyUiState(JSON.stringify({ rootPc: 99, oct: [-3, 99, 4, 4], scale: 999, mode: 7, layout: 7 }));
    eq('rootPc clamped into 0..11', keyboardState.rootPc, 3);
    eq('octave clamped low', keyboardState.octave[0], 0);
    eq('octave clamped high', keyboardState.octave[1], 8);
    eq('scale clamped', keyboardState.scale, 12);
    eq('mode clamped', keyboardState.mode, 1);
    eq('layout clamped', keyboardState.layout, 1);

    // Corrupt input must not throw or mutate.
    keyboardState.rootPc = 5;
    applyUiState('{not json');
    eq('corrupt blob leaves state alone', keyboardState.rootPc, 5);

    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
}
```

Note `99 % 12 = 3`, and scale index 999 clamps to `SCALES.length - 1 = 12`.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `mode restored` etc., since `serializeUiState` writes neither `mode` nor `oct`.

- [ ] **Step 3: Implement**

In `src/seq/persist.ts`, add the import and replace the three functions:

```ts
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { keyboardState, OCT_MIN, OCT_MAX } from '../keyboard/state.js';

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
    typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v | 0)) : dflt;

/** JSON of the persisted UI keyboard state (tonic, scale, layout, octaves). */
export function serializeUiState(): string {
    return JSON.stringify({
        // `root` is kept as track 0's absolute base so an older build reading a
        // newer file still lands on a sane note.
        root:   keyboardState.octave[0] * 12 + keyboardState.rootPc,
        rootPc: keyboardState.rootPc,
        scale:  keyboardState.scale,
        mode:   keyboardState.mode,
        layout: keyboardState.layout,
        oct:    keyboardState.octave.slice(),
        mutes:  mutesSnapshot(),
    });
}

/** Apply a serialized UI-state blob (tolerant of missing/invalid fields). */
export function applyUiState(blob: string): void {
    try {
        const o = JSON.parse(blob);
        if (Array.isArray(o.oct)) {
            for (let t = 0; t < 4; t++)
                keyboardState.octave[t] = clampInt(o.oct[t], OCT_MIN, OCT_MAX, 4);
            keyboardState.rootPc = ((clampInt(o.rootPc, -1e6, 1e6, 0) % 12) + 12) % 12;
        } else if (typeof o.root === 'number') {
            // Legacy blob: one absolute note carried both tonic and octave.
            const r = clampInt(o.root, 0, 103, 48);
            keyboardState.rootPc = r % 12;
            const oct = clampInt(Math.floor(r / 12), OCT_MIN, OCT_MAX, 4);
            for (let t = 0; t < 4; t++) keyboardState.octave[t] = oct;
        }
        keyboardState.scale  = clampInt(o.scale,  0, SCALES.length - 1, keyboardState.scale);
        keyboardState.mode   = clampInt(o.mode,   0, MODE_NAMES.length - 1, 0);
        keyboardState.layout = clampInt(o.layout, 0, layoutNames(keyboardState.mode).length - 1, 0);
        if (o.mutes) restoreMutes(o.mutes);
    } catch { /* corrupt file → keep defaults */ }
}

/* Defaults match init(): C tonic, Major, Chromatic/Fourths, C3 on every track. */
function resetUiState(): void {
    keyboardState.rootPc = 0;
    keyboardState.scale = 0;
    keyboardState.mode = 0;
    keyboardState.layout = 0;
    for (let t = 0; t < 4; t++) keyboardState.octave[t] = 4;
    resetTrackMutes();
}
```

`clampInt`'s `dflt` fires for absent fields, which is why `mode`/`layout` default to 0 on a legacy blob and `scale` defaults to its current value (preserving today's behaviour where a missing `scale` was left untouched).

- [ ] **Step 4: Run tests**

```bash
npm run build:browser && npm run typecheck && node browser-test/logic.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 5: Prove the tests have teeth**

Temporarily delete the `else if (typeof o.root === 'number')` branch, rebuild, run. Expected: `legacy root gives pitch class` and `legacy root fills every octave` FAIL. Restore and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/seq/persist.ts browser-test/logic.mjs
git commit -m "Persist mode, layout and per-track octave

Writes oct[4] + rootPc alongside the legacy absolute root, and migrates
blobs written before the split by deriving the tonic and filling every
track's octave. Per-set files already survive a device restart."
```

---

### Task 6: Full verification, device run, docs

**Files:**
- Modify: `MANUAL.md`, `README.md`, `CHANGELOG.md`
- Create: `docs/assets/main-mode-overlay.png`, `docs/assets/main-layout-overlay.png` (generated)

- [ ] **Step 1: Run every local suite**

```bash
cd /Users/dake/git/cld/movy
npm run typecheck
npm test
```

`npm test` builds then runs `logic.mjs`, `dump-replay.mjs`, `app-loop.mjs`, `screenshot.mjs` and `perf.mjs`. Expected: 0 failures in all five. The Rust engine is untouched, so `cargo test` is not required.

- [ ] **Step 2: Generate the doc screenshots**

```bash
node scripts/make-doc-assets.mjs main-page main-mode-overlay main-layout-overlay
```

- [ ] **Step 3: Update `MANUAL.md`**

Read the surrounding sections first and match their voice. Add a **Pad layouts** subsection to the keyboard chapter covering:

- `MODE` (`Chromatic` / `In Key`) and `LAYOUT` on the SET PARAMETERS page (`Shift` + Step 5/7/9), with the `docs/assets/main-mode-overlay.png` and `main-layout-overlay.png` screenshots.
- The four combinations and their grids: Chromatic Fourths (fourth per row, **root on the 4th pad of the bottom row**), Chromatic Piano (whites on rows 1 and 3, blacks above shifted right, three dead pads per black row, two octaves), In Key Fourths (three scale degrees per row, root bottom-left), In Key Inline (one scale octave per row, root bottom-left).
- That In Key Inline steps by the scale's degree count, so pentatonic rows overlap.
- That the piano layout still honours `KEY` for colouring — pick the `Chromatic` scale to light the whole keyboard.
- That `+` / `−` now shift **only the active track's** octave, and each track remembers its own octave per set, across a device restart.

Add rows to the Controls reference (section 8) for `MODE`, `LAYOUT`, and the revised `+`/`−`. Update the existing `ROOT`/`KEY` rows for their new knob positions (4 and 5) and `LINK` for knob 2.

- [ ] **Step 4: Update `README.md`**

One bullet in *Features*, in the existing voice, e.g. "**Scales & pad layouts** — chromatic fourths or piano, or fold the grid in-key (fourths or inline); per-track octave." with the `docs/assets/main-page.png` screenshot.

- [ ] **Step 5: Update `CHANGELOG.md`**

Follow the existing entry format. Cover: four selectable pad layouts, the chromatic root moving to column 4, per-track persistent octave, the SET PARAMETERS row rearrangement, and the legacy-blob migration (call out that existing sets keep their root and gain the same octave on all four tracks).

- [ ] **Step 6: Commit the docs**

```bash
git add MANUAL.md README.md CHANGELOG.md docs/assets
git commit -m "Document pad layouts and per-track octave"
```

- [ ] **Step 7: Device verification**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

If the device is offline, **report that to the user in CAPS**. If it is reachable, also confirm by hand on the real screen:

```bash
node scripts/grab-screen.mjs /tmp/layouts.png move.local
```

Read the PNG and check the SET PARAMETERS bottom row shows `ROOT KEY MODE LAYOUT`. Any device failure gets fixed before the push — and re-run the suite before calling a failure pre-existing.

- [ ] **Step 8: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:** §2 state model → Task 2. §3 layouts module → Task 1. §4 colouring → Task 3. §5 SET PARAMETERS page → Task 4. §6 persistence + migration → Task 5. §7 files touched → spread across Tasks 2–5 (every row of the spec's table appears in a task's Files block). §8 tests → Tasks 1, 3, 4, 5 (logic + app-loop + screenshot + perf), plus the full run in Task 6. §9 docs → Task 6. §10 out of scope → nothing planned against it.

**Naming consistency:** `padPitch` / `padColor` / `padMapFor` / `baseNoteFor` / `setRootPc` / `changeOctave` / `overlayKnob` / `overlaySel` / `overlayOptions` are used identically wherever they appear across tasks.

**Known ordering constraint:** Task 2 leaves `src/` in a non-compiling state until Task 3 lands (`pads.ts`, `tick.ts`, `handler.ts`, `keys-view.ts` and `persist.ts` still reference `rootNote`). Task 2 Step 6 says so explicitly and offers merging the two commits as the alternative.
