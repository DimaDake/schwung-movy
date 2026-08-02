# Step Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold **Rec** while stopped and play the pads to enter notes one step at a time — OP-Z / OP-XY / KeyStep style step recording, on melodic and drum tracks.

**Architecture:** A new UI-layer module `src/seq/step-rec.ts` owns the whole mode: head position, the open chord, grow-vs-wrap, and the preview ledger. Every other file only calls into it. No Rust changes — the engine's existing `addp` / `del` / `slen` / `clen` / `hold` commands cover everything.

**Tech Stack:** TypeScript → `dist/esm` (`npm run build:browser`), tested by `browser-test/*.mjs` against `mock-engine.mjs`; device e2e via `scripts/test-seq.sh`.

**Design doc:** `plans/2026-08-02-step-record-design.md`

## Global Constants

Copy these verbatim; several already exist in the codebase.

- `CC_REC = 86` — exported from `src/seq/constants.ts`
- `CC_LEFT = 62`, `CC_RIGHT = 63`, `CC_PLAY = 85` — module-local consts in `src/seq/router.ts`
- `NUM_STEP_BUTTONS = 16`, `STEP_NOTE_BASE = 16` — `src/seq/constants.ts`
- `TICKS_PER_STEP = 24` (96 PPQN ÷ 4) — mirror of seq-core, redeclare locally as other seq files do
- `MAX_STEPS = 256` — 16 bars, the engine's ceiling
- `TAP_MS = 500` — the tap-vs-hold threshold, matching `momentary.ts`'s `HOLD_MS`
- `PREVIEW_MS = 150` — `←` preview note duration
- Engine command grammar (already implemented in `engine/crates/seq-core/src/command.rs`):
  - `del <t> <s0> <s1> <pitch|-1>`
  - `addp <t> <s0> <s1> <pitch> <vel>`
  - `slen <t> <s0> <s1> <lane|-1> <ticks>`
  - `clen <t> <steps>`
  - `hold <t> <step|-1>`
- Commit trailer for every commit in this plan:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
  ```
- All work happens in `/Users/dake/git/cld/movy`. Rebuild with `npm run build:browser` before running any `.mjs` suite — the tests import `dist/esm`, not `src`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/seq/step-rec.ts` | **new** — the entire mode: state, head movement, note writing, tie, preview ledger, header text |
| `src/seq/router.ts` | modify — Rec branch, step-button branch, arrow branch, Play branch, pad on/off |
| `src/seq/leds.ts` | modify — blinking red head on the step row |
| `src/app/tick.ts` | modify — call `stepRecTick()` each tick |
| `src/app/input-reset.ts` | modify — call `resetStepRec()` |
| `browser-test/logic.mjs` | modify — the mode's unit tests |
| `browser-test/app-loop.mjs` | modify — full input→LED integration test |
| `browser-test/screenshot.mjs` | modify — header-band baseline |
| `scripts/test-seq.sh` | modify — one device section |
| `MANUAL.md`, `README.md`, `CHANGELOG.md` | modify — docs |

---

### Task 1: The mode core — entry, exit, note entry, advance

Head movement, chord accumulation, melodic-replace vs drum-add, grow-vs-wrap, and the Rec tap fallthrough. Arrows, step taps, LEDs, header and preview come later — this task ends with a mode you can hold Rec and play notes into.

**Files:**
- Create: `src/seq/step-rec.ts`
- Modify: `src/seq/router.ts` (Rec branch ~line 233; `seqNotePadPlayed` ~line 379; `seqNotePadReleased` ~line 400)
- Modify: `src/app/input-reset.ts` (imports + `resetHeldInput`)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `seqCmd` (`seq/engine.js`), `seqState`, `occHasStep`, `occToggleStep` (`seq/state.js`), `NUM_STEP_BUTTONS` (`seq/constants.js`)
- Produces, all from `src/seq/step-rec.ts`:
  - `stepRecActive(): boolean`
  - `stepRecHead(): number`
  - `stepRecDownAt(nowMs: number): boolean` / `stepRecDown(nowMs?): boolean` — true = mode entered (caller must NOT emit `rec`)
  - `stepRecUpAt(nowMs: number): boolean` / `stepRecUp(nowMs?): boolean` — true = caller should emit `rec` (tap fallthrough)
  - `stepRecPad(padNote: number, pitch: number, vel: number): boolean` — true = consumed
  - `stepRecPadRelease(padNote: number): boolean` — true = consumed
  - `stepRecEnd(): void` — leave the mode without the tap rule (used by Play in Task 3)
  - `resetStepRec(): void`
  - `stepRecGrowMode(): boolean` — test hook
  - Task 2 adds `stepRecArrow`, Task 3 adds `stepRecStepTap`, Task 5 adds `stepRecHeaderText`, Task 6 adds `stepRecTick`.

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic.mjs`, immediately before the final failure-count summary block (find it with `grep -n "failures" browser-test/logic.mjs | tail -3`):

```javascript
/* ── step recording: entry, chords, advance, grow/wrap ───────────────────── */
{
    _log('\nstep record — core:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, seqSetLane } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');
    const {
        stepRecActive, stepRecHead, stepRecGrowMode, resetStepRec,
    } = await import('../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    const boot = () => { engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); seqEngineTick(); };
    /* Rec is CC 86. Time is stubbed so tap-vs-hold is deterministic. */
    const recDown = () => seqHandleMidi([0xB0, 86, 127], false);
    const recUp   = () => seqHandleMidi([0xB0, 86, 0], false);
    /* Pad 80 → note 72, pad 81 → note 76, pad 82 → note 79 (values are the
     * caller's; the router takes the resolved midi note from midi/router.ts). */
    const padOn  = (pad, note, vel = 100) => seqNotePadPlayed(0, pad, note, vel);
    const padOff = (pad) => seqNotePadReleased(pad, 0);

    const realNow = Date.now;
    let t = 50000;
    Date.now = () => t;

    // ── entering the mode while stopped ───────────────────────────────────
    boot();
    seqState.playing = false;
    recDown();
    eq('Rec down while stopped enters step record', stepRecActive(), true);
    eq('head starts at step 1', stepRecHead(), 0);
    eq('empty clip → grow mode', stepRecGrowMode(), true);
    seqEngineTick();
    eq('no rec arm emitted on entry', engine.ops.includes('rec 0'), false);
    eq('head announced to the engine', engine.ops.includes('hold 0 0'), true);

    // ── a chord lands on one step, release advances ───────────────────────
    engine.ops.length = 0;
    padOn(80, 72, 100);
    padOn(81, 76, 100);
    seqEngineTick();
    eq('melodic first pad clears the step first', engine.ops[0], 'del 0 0 0 -1');
    eq('melodic first pad writes', engine.ops[1], 'addp 0 0 0 72 100');
    eq('second pad joins the same step', engine.ops[2], 'addp 0 0 0 76 100');
    eq('head has not moved while pads are down', stepRecHead(), 0);
    padOff(80);
    eq('head waits for the LAST pad', stepRecHead(), 0);
    padOff(81);
    eq('all pads up → head advances', stepRecHead(), 1);
    eq('grow mode set the clip to what was played', seqState.lenSteps, 1);
    seqEngineTick();
    eq('clen trims the engine bar-rounding', engine.ops.includes('clen 0 1'), true);
    eq('occupancy mirrored for the LED', occHasStep(0), true);

    // ── non-overlapping taps advance one step each ────────────────────────
    padOn(80, 72, 100); padOff(80);
    eq('second note advanced again', stepRecHead(), 2);
    padOn(80, 74, 100); padOff(80);
    eq('third note advanced again', stepRecHead(), 3);
    eq('clip grew per step, not per bar', seqState.lenSteps, 3);

    // ── melodic replace: re-entering a step wipes it first ────────────────
    engine.ops.length = 0;
    seqState.holdStep = 0;
    resetStepRec();
    boot();
    seqState.playing = false; seqState.lenSteps = 16;   // existing clip
    recDown();
    eq('non-empty clip → wrap mode', stepRecGrowMode(), false);
    engine.ops.length = 0;
    padOn(80, 72, 100); padOff(80);
    seqEngineTick();
    eq('melodic overwrite deletes then adds', engine.ops[0], 'del 0 0 0 -1');
    eq('existing clip length untouched', seqState.lenSteps, 16);

    // ── drums add, never delete ───────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    seqSetLane(38);                       // drum lane → watchLane >= 0
    recDown();
    engine.ops.length = 0;
    padOn(80, 36, 120); padOff(80);
    seqEngineTick();
    eq('drum pad never deletes the step', engine.ops.some((o) => o.startsWith('del')), false);
    eq('drum pad adds its own lane', engine.ops.includes('addp 0 0 0 36 120'), true);
    seqSetLane(-1);

    // ── wrap at the clip end ──────────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 4; seqState.loopStart = 0;
    recDown();
    for (let i = 0; i < 3; i++) { padOn(80, 72, 100); padOff(80); }
    eq('head at the last step', stepRecHead(), 3);
    padOn(80, 72, 100); padOff(80);
    eq('past the end wraps to the loop start', stepRecHead(), 0);
    eq('wrap mode never grows the clip', seqState.lenSteps, 4);

    // ── exit: tap falls through to arm, hold does not ─────────────────────
    boot();
    seqState.playing = false;
    recDown();
    t += 100;                              // quick tap, nothing entered
    recUp();
    seqEngineTick();
    eq('empty tap still arms live record', engine.ops.includes('rec 0'), true);
    eq('mode left', stepRecActive(), false);

    boot();
    seqState.playing = false;
    recDown();
    t += 100;
    padOn(80, 72, 100); padOff(80);        // something happened
    recUp();
    seqEngineTick();
    eq('a tap that entered notes does not also arm', engine.ops.includes('rec 0'), false);

    boot();
    seqState.playing = false;
    recDown();
    t += 900;                              // a long hold, nothing entered
    recUp();
    seqEngineTick();
    eq('a long hold does not arm', engine.ops.includes('rec 0'), false);
    eq('exit releases the engine hold', engine.ops.includes('hold 0 -1'), true);

    // ── while playing, Rec is unchanged ───────────────────────────────────
    boot();
    seqState.playing = true;
    recDown();
    eq('Rec while playing does not enter step record', stepRecActive(), false);
    seqEngineTick();
    eq('Rec while playing arms immediately', engine.ops.includes('rec 0'), true);
    recUp();
    seqEngineTick();
    eq('the release does not arm a second time',
        engine.ops.filter((o) => o === 'rec 0').length, 1);

    Date.now = realNow;
    seqState.playing = false;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `Cannot find module '.../dist/esm/seq/step-rec.js'`.

- [ ] **Step 3: Create `src/seq/step-rec.ts`**

```typescript
/* Step recording (manual §5): hold Rec while the transport is stopped and play
 * the pads to fill the sequencer one step at a time — OP-Z / OP-XY / KeyStep
 * step entry, for melodic and drum tracks alike.
 *
 * Chord accumulation is KeyStep's: notes that overlap in time land on the same
 * step, and the head advances only when the LAST pad comes up. So a chord needs
 * no modifier, and a single-finger run still advances one note per step.
 *
 * The mode owns the head; the engine's `hold` command is pointed at it on every
 * move, which is what makes the rest cheap — the status reply already drives the
 * pad LEDs (app/tick.ts) and the note-length span on the step row (leds.ts), and
 * supplies the header's note names and the back-step preview's pitches. */

import { NUM_STEP_BUTTONS } from './constants.js';
import { seqCmd } from './engine.js';
import { occHasStep, occToggleStep, seqState } from './state.js';

const TICKS_PER_STEP = 24;   // 96 PPQN / 4 (mirror of seq-core)
const MAX_STEPS = 256;       // 16 bars — the engine's clip ceiling
const TAP_MS = 500;          // tap-vs-hold, matching momentary.ts

/* The chord currently under the fingers. `anchor` is the step it was written
 * to, which stays fixed while a tie moves the head forward. */
interface OpenChord { pitches: number[]; anchor: number; tieSteps: number; }

let active = false;
let head = 0;
/* Latched at entry, never re-derived: entering the first note on an empty clip
 * makes it non-empty, and re-deriving would turn it into a one-step clip that
 * wraps immediately. */
let growMode = false;
let touched = false;         // anything at all happened during this hold
let pressMs = 0;
/* No note has been written at the head since the head arrived here. The first
 * melodic write at a fresh head clears the step, later ones stack. */
let fresh = true;
let chord: OpenChord | null = null;
const heldPads = new Map<number, number>();   // padNote → pitch

export function stepRecActive(): boolean { return active; }
export function stepRecHead(): number { return head; }
export function stepRecGrowMode(): boolean { return growMode; }

function isDrum(): boolean { return seqState.watchLane >= 0; }

/* Rec down. Returns true when step recording took the press, so the caller
 * must not also arm live recording. Stopped-transport only — Rec while playing
 * keeps its existing meaning. */
export function stepRecDownAt(nowMs: number): boolean {
    if (active || seqState.playing) return false;
    active = true;
    touched = false;
    pressMs = nowMs;
    growMode = seqState.lenSteps === 0;
    chord = null;
    heldPads.clear();
    setHead(0);
    return true;
}

export function stepRecDown(nowMs: number = Date.now()): boolean {
    return stepRecDownAt(nowMs);
}

/* Rec up. Returns true when the press was a bare quick tap, so the caller
 * should apply the old meaning (toggle the live-record arm) — nothing is lost
 * by putting step recording on the same button. */
export function stepRecUpAt(nowMs: number): boolean {
    if (!active) return false;
    const wasTap = !touched && nowMs - pressMs < TAP_MS;
    stepRecEnd();
    return wasTap;
}

export function stepRecUp(nowMs: number = Date.now()): boolean {
    return stepRecUpAt(nowMs);
}

/* Leave the mode. Separate from stepRecUp so Play can end it without the
 * tap rule ever firing. */
export function stepRecEnd(): void {
    if (!active) return;
    active = false;
    chord = null;
    heldPads.clear();
    seqState.holdStep = -1;
    seqState.holdNotes = [];
    seqCmd('hold ' + seqState.watchTrack + ' -1');
}

/* Move the head and re-point everything that follows it. holdNotes is cleared
 * optimistically so a status reply still describing the PREVIOUS step can never
 * be read as this step's content. */
function setHead(step: number): void {
    head = step;
    fresh = true;
    seqState.barOffset = Math.min(Math.floor(head / NUM_STEP_BUTTONS), 15);
    seqState.holdStep = head;
    seqState.holdNotes = [];
    seqCmd('hold ' + seqState.watchTrack + ' ' + head);
}

/* Grow mode only: take `step` into the clip. The engine rounds a clip up to the
 * bar end when a note lands outside the current window (Clip::extend_to_step),
 * so this must be queued AFTER the write that caused it — it trims the rounding
 * back to the per-step length the user actually played. Never shrinks. */
function growTo(step: number): void {
    if (!growMode) return;
    const want = Math.min(step + 1, MAX_STEPS);
    if (want <= seqState.lenSteps) return;
    seqState.lenSteps = want;
    seqCmd('clen ' + seqState.watchTrack + ' ' + want);
}

function advanceHead(): void {
    growTo(head);                        // the step being left joins the clip
    let next = head + 1;
    if (growMode) {
        if (next >= MAX_STEPS) next = 0;
    } else if (next >= seqState.lenSteps) {
        next = seqState.loopStart;
    }
    setHead(next);
}

/* A pad played while the mode is active. Returns true when consumed, so the
 * caller skips the normal chord/live-capture path. The note has already been
 * sounded by midi/router.ts — this only writes it. */
export function stepRecPad(padNote: number, pitch: number, vel: number): boolean {
    if (!active) return false;
    touched = true;
    heldPads.set(padNote, pitch);
    const t = seqState.watchTrack;
    if (!chord) chord = { pitches: [], anchor: head, tieSteps: 0 };
    /* Melodic replaces because the head is the user's cursor: stepping back and
     * replaying has to overwrite cleanly. Drums only ever add, so a kick pass
     * followed by a snare pass builds a kit instead of erasing one. */
    if (fresh && !isDrum()) seqCmd(`del ${t} ${head} ${head} -1`);
    fresh = false;
    seqCmd(`addp ${t} ${head} ${head} ${pitch} ${vel}`);
    chord.pitches.push(pitch);
    if (!occHasStep(head)) occToggleStep(head);
    if (growMode && head + 1 > seqState.lenSteps) seqState.lenSteps = head + 1;
    return true;
}

/* A pad released. The head advances only once every pad is up (KeyStep). */
export function stepRecPadRelease(padNote: number): boolean {
    if (!active) return false;
    if (!heldPads.delete(padNote)) return true;   // not ours, but still consumed
    if (heldPads.size > 0) return true;           // chord still open
    chord = null;
    advanceHead();
    return true;
}

export function resetStepRec(): void {
    active = false;
    head = 0;
    growMode = false;
    touched = false;
    pressMs = 0;
    fresh = true;
    chord = null;
    heldPads.clear();
}
```

- [ ] **Step 4: Wire the Rec button in `src/seq/router.ts`**

Add to the import block that already pulls from `./step-edit.js` (keep imports grouped as the file does):

```typescript
import {
    stepRecActive, stepRecDown, stepRecPad, stepRecPadRelease, stepRecUp,
} from './step-rec.js';
```

Replace the Rec branch (currently `/* Rec: toggle recording (engine arms a one-bar count-in). */`):

```typescript
    /* Rec: held while stopped = step recording (step-rec.ts); a bare quick tap
     * keeps the old meaning, toggling live recording with its one-bar count-in. */
    if (d1 === CC_REC) {
        if (d2 > 0) {
            if (!stepRecDown()) seqCmd('rec ' + seqState.watchTrack);
        } else if (stepRecUp()) {
            seqCmd('rec ' + seqState.watchTrack);
        }
        return true;
    }
```

- [ ] **Step 5: Route pads through the mode in `src/seq/router.ts`**

In `seqNotePadPlayed`, insert the step-record claim directly after the `lastPitch`/`lastVel` update and before the `deleteActive()` check:

```typescript
    if (stepRecPad(padNote, midiNote, vel)) return;
```

In `seqNotePadReleased`, insert as the first statement of the body:

```typescript
    if (stepRecPadRelease(padNote)) return;
```

- [ ] **Step 6: Add the reset in `src/app/input-reset.ts`**

Add the import next to the other `seq/` resets:

```typescript
import { resetStepRec } from '../seq/step-rec.js';
```

and the call inside `resetHeldInput`, next to `resetSeqChord()`:

```typescript
    resetStepRec();       // Rec held for step recording
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS, 0 failures — including the pre-existing suites.

- [ ] **Step 8: Prove the tests have teeth**

Temporarily change `if (fresh && !isDrum())` to `if (false)` in `src/seq/step-rec.ts`, rebuild, and re-run. Expected: the `melodic first pad clears the step first` and `melodic overwrite deletes then adds` assertions FAIL. Restore the line, rebuild, confirm green again.

- [ ] **Step 9: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/step-rec.ts src/seq/router.ts src/app/input-reset.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Step recording: hold Rec and play the pads in, one step at a time

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
EOF
)"
```

---

### Task 2: Arrows — rests, back-stepping, and ties

`→` / `←` do double duty: with pads held they lengthen and shorten the open chord; with no pad held they move the head.

**Files:**
- Modify: `src/seq/step-rec.ts`
- Modify: `src/seq/router.ts` (the Left/Right branch, ~line 268)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: `stepRecArrow(dir: number): boolean` — `dir` is `+1` for Right, `-1` for Left; true = consumed. Also `stepRecPreviewPending(): boolean` (test hook, consumed by Task 6).

- [ ] **Step 1: Write the failing tests**

Append a new block to `browser-test/logic.mjs`, after the Task 1 block:

```javascript
/* ── step recording: arrows (rest, back-step, tie) ───────────────────────── */
{
    _log('\nstep record — arrows:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { stepRecHead, stepRecPreviewPending, resetStepRec } =
        await import('../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    const boot = () => { engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); seqEngineTick(); };
    const recDown = () => seqHandleMidi([0xB0, 86, 127], false);
    const right   = () => seqHandleMidi([0xB0, 63, 127], false);
    const left    = () => seqHandleMidi([0xB0, 62, 127], false);
    const padOn   = (pad, note, vel = 100) => seqNotePadPlayed(0, pad, note, vel);
    const padOff  = (pad) => seqNotePadReleased(pad, 0);

    const realNow = Date.now;
    let t = 60000;
    Date.now = () => t;

    // ── rest: → with no pad held leaves the step empty ────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    eq('right arrow claimed while step recording', seqHandleMidi([0xB0, 63, 127], false), true);
    eq('rest advanced the head', stepRecHead(), 1);
    engine.ops.length = 0;
    padOn(80, 72, 100); padOff(80);
    seqEngineTick();
    eq('the note landed after the rest', engine.ops.includes('addp 0 1 1 72 100'), true);

    // ── back-step ─────────────────────────────────────────────────────────
    eq('head moved on', stepRecHead(), 2);
    left();
    eq('left arrow steps back', stepRecHead(), 1);
    eq('back-step asks for a preview', stepRecPreviewPending(), true);
    left();
    left();
    eq('left arrow never goes below the first step', stepRecHead(), 0);

    // ── rest grows a new clip, one step at a time ─────────────────────────
    boot();
    seqState.playing = false;              // empty clip → grow mode
    recDown();
    padOn(80, 72, 100); padOff(80);        // step 1 has a note, head → 2
    right();                               // step 2 is a rest, head → 3
    eq('rest is part of a grown clip', seqState.lenSteps, 2);
    eq('head after the rest', stepRecHead(), 2);

    // ── tie: → while the chord is held ────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    padOn(80, 72, 100);
    padOn(81, 76, 100);
    engine.ops.length = 0;
    right();
    seqEngineTick();
    eq('tie lengthens every pitch in the chord',
        engine.ops.filter((o) => o.startsWith('slen')).length, 2);
    eq('tie sets two steps of gate', engine.ops.includes('slen 0 0 0 72 48'), true);
    eq('the head follows the end of the tied note', stepRecHead(), 1);
    right();
    seqEngineTick();
    eq('a second tie makes three steps', engine.ops.includes('slen 0 0 0 72 72'), true);
    eq('head at the end of a 3-step note', stepRecHead(), 2);
    left();
    seqEngineTick();
    eq('untie shortens back', engine.ops.includes('slen 0 0 0 72 48'), true);
    eq('head follows the untie', stepRecHead(), 1);
    padOff(80); padOff(81);
    eq('release lands past the tied note', stepRecHead(), 2);

    // ── untie stops at one step ───────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    padOn(80, 72, 100);
    engine.ops.length = 0;
    left();
    seqEngineTick();
    eq('untie below one step is a consumed no-op',
        engine.ops.some((o) => o.startsWith('slen')), false);
    eq('the head stays put', stepRecHead(), 0);

    Date.now = realNow;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `stepRecPreviewPending is not a function`, and the arrow assertions report a head that never moved.

- [ ] **Step 3: Add the arrow handling to `src/seq/step-rec.ts`**

Add the preview flag next to the other module state:

```typescript
/* A back-step wants to play what is on the step it lands on, but the pitches
 * come from the engine's next status reply — so the request is parked here and
 * Task 6's tick consumes it when the reply arrives. */
let previewPending = false;
export function stepRecPreviewPending(): boolean { return previewPending; }
```

Clear it in `setHead` (a new head move supersedes any pending preview), in `stepRecEnd` and in `resetStepRec`:

```typescript
    previewPending = false;
```

In `setHead`, place that line before the `head = step;` assignment; in `stepRecEnd` and `resetStepRec`, anywhere in the body.

Add the handler after `stepRecPadRelease`:

```typescript
/* Left/Right. With the chord still under the fingers they tie and untie it —
 * the notes grow into the following steps and the head rides along, which is
 * the KeyStep "Tap = tie" gesture without a spare button. With no pad held they
 * move the head: forward leaves a rest, backward re-opens the previous step for
 * editing. Returns true when consumed. */
export function stepRecArrow(dir: number): boolean {
    if (!active) return false;
    touched = true;
    const t = seqState.watchTrack;
    if (chord) {
        if (dir > 0) chord.tieSteps++;
        else if (chord.tieSteps > 0) chord.tieSteps--;
        else return true;              // already one step long: consumed no-op
        const ticks = (chord.tieSteps + 1) * TICKS_PER_STEP;
        /* Per pitch rather than lane -1: on a drum track a tie must only touch
         * the notes this chord entered, never what an earlier pass left on the
         * same step. */
        for (const p of chord.pitches) {
            seqCmd(`slen ${t} ${chord.anchor} ${chord.anchor} ${p} ${ticks}`);
        }
        const end = chord.anchor + chord.tieSteps;
        growTo(end);
        const openPitches = chord.pitches.slice();
        const openAnchor = chord.anchor;
        const openTie = chord.tieSteps;
        setHead(end);
        chord = { pitches: openPitches, anchor: openAnchor, tieSteps: openTie };
        return true;
    }
    if (dir > 0) {
        advanceHead();
    } else {
        setHead(Math.max(0, head - 1));
        previewPending = true;         // play what is there, ready to overwrite
    }
    return true;
}
```

Note: `setHead` clears `chord` indirectly nowhere — it does not touch `chord` — but it does reset `fresh`, and the tie must keep the chord open, hence the explicit re-assignment above guarding against future changes to `setHead`.

- [ ] **Step 4: Wire the arrows in `src/seq/router.ts`**

Add `stepRecArrow` to the `./step-rec.js` import list, then change the Left/Right branch so step recording gets first refusal:

```typescript
    /* Left/Right: step recording (tie / move the head) first; then nudge held
     * steps; else bar navigation (engine ready); else fall through to the
     * existing param page/chain nav. */
    if ((d1 === CC_LEFT || d1 === CC_RIGHT) && d2 > 0) {
        const dir = d1 === CC_RIGHT ? 1 : -1;
        if (stepRecArrow(dir)) return true;
        if (anyStepHeld()) return editNudge(dir, shiftHeld);
        if (engineReady()) { navigateBar(dir); return true; }
        return false;
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 6: Prove the tests have teeth**

Temporarily change `const ticks = (chord.tieSteps + 1) * TICKS_PER_STEP;` to `... * TICKS_PER_STEP * 2;`, rebuild, re-run. Expected: `tie sets two steps of gate` FAILS. Restore and confirm green.

- [ ] **Step 7: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/step-rec.ts src/seq/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Step recording: arrows leave rests, step back, and tie the held chord

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
EOF
)"
```

---

### Task 3: Step buttons jump the head; Play exits

While step recording is active a step button is a tap that moves the head (clearing that step if it had notes) — it never registers as a held range, so hold-step editing and step recording can't both claim the pads.

**Files:**
- Modify: `src/seq/step-rec.ts`
- Modify: `src/seq/router.ts` (step-button branch ~line 108; Play branch ~line 258)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: Task 1 + Task 2 output.
- Produces: `stepRecStepTap(button: number): boolean` — `button` is the physical 0-15 index; true = consumed.

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic.mjs`:

```javascript
/* ── step recording: step buttons and Play ───────────────────────────────── */
{
    _log('\nstep record — steps & Play:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep, occToggleStep } =
        await import('../dist/esm/seq/state.js');
    const { stepRecActive, stepRecHead, resetStepRec } =
        await import('../dist/esm/seq/step-rec.js');
    const { anyStepHeld } = await import('../dist/esm/seq/step-edit.js');

    const engine = installMockEngine();
    const boot = () => { engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); seqEngineTick(); };
    const recDown = () => seqHandleMidi([0xB0, 86, 127], false);
    const stepDown = (b) => seqHandleMidi([0x90, 16 + b, 127], false);
    const stepUp   = (b) => seqHandleMidi([0x80, 16 + b, 0], false);

    const realNow = Date.now;
    let t = 70000;
    Date.now = () => t;

    // ── a step tap jumps the head ─────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    stepDown(6); stepUp(6);
    eq('step tap moved the head', stepRecHead(), 6);
    eq('step press never registers as a hold', anyStepHeld(), false);

    // ── tapping an occupied step clears it ────────────────────────────────
    occToggleStep(9);                      // pretend step 10 has notes
    engine.ops.length = 0;
    stepDown(9); stepUp(9);
    seqEngineTick();
    eq('occupied step is cleared', engine.ops.includes('del 0 9 9 -1'), true);
    eq('occupancy mirror cleared', occHasStep(9), false);
    eq('head landed on the cleared step', stepRecHead(), 9);

    // ── a wrap-mode tap past the clip end is inert ────────────────────────
    seqState.lenSteps = 8;
    stepDown(12); stepUp(12);
    eq('tap past the clip end does not move the head', stepRecHead(), 9);

    // ── Play leaves the mode ──────────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    seqHandleMidi([0xB0, 85, 127], false);  // Play
    eq('Play exits step recording', stepRecActive(), false);
    eq('Play still started the transport', seqState.playing, true);
    seqHandleMidi([0xB0, 86, 0], false);    // the Rec release that follows
    seqEngineTick();
    eq('the trailing Rec release does not arm', engine.ops.includes('rec 0'), false);

    Date.now = realNow;
    seqState.playing = false;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — the step tap toggles a note the old way and `anyStepHeld()` is true during the press.

- [ ] **Step 3: Add `stepRecStepTap` to `src/seq/step-rec.ts`**

```typescript
/* A step button pressed while the mode is active: jump the head there. An
 * occupied step is also cleared, which is the "tap it to remove it" escape from
 * a wrong note. Steps past the end of an existing clip are not part of the
 * pattern, so they are inert — but in grow mode the tap extends the clip to
 * reach the step you asked for. */
export function stepRecStepTap(button: number): boolean {
    if (!active) return false;
    touched = true;
    const step = seqState.barOffset * NUM_STEP_BUTTONS + button;
    if (!growMode && step >= seqState.lenSteps) return true;
    if (occHasStep(step)) {
        const ln = isDrum() ? seqState.watchLane : -1;
        seqCmd(`del ${seqState.watchTrack} ${step} ${step} ${ln}`);
        occToggleStep(step);
    }
    growTo(step);
    setHead(step);
    return true;
}
```

- [ ] **Step 4: Claim the step buttons in `src/seq/router.ts`**

Add `stepRecStepTap` and `stepRecEnd` to the `./step-rec.js` import list. Then, inside the step-button branch, insert this as the very first statement after `const on = statusType === 0x90 && d2 > 0;`:

```typescript
        /* Step recording owns the row while it is active: a press moves the
         * head, and nothing registers as a held range — so hold-step editing
         * and step recording can never both be claiming the pads. */
        if (stepRecActive()) {
            if (on) stepRecStepTap(button);
            return true;
        }
```

- [ ] **Step 5: Make Play exit the mode in `src/seq/router.ts`**

Replace the Play branch body:

```typescript
    if (d1 === CC_PLAY) {
        if (d2 > 0) {
            stepRecEnd();   // step recording is a stopped-transport mode
            seqCmd(seqState.playing ? 'stop' : 'play');
            seqState.playing = !seqState.playing;
        }
        return true;
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 7: Prove the tests have teeth**

Temporarily remove the `if (stepRecActive()) { ... }` block from the step-button branch, rebuild, re-run. Expected: `step press never registers as a hold` and `step tap moved the head` FAIL. Restore and confirm green.

- [ ] **Step 8: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/step-rec.ts src/seq/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Step recording: step buttons jump the head, Play leaves the mode

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
EOF
)"
```

---

### Task 4: The head LED

The head blinks red on the step row, above every other step colour.

**Files:**
- Modify: `src/seq/leds.ts` (the step-row loop in `seqLedsTick`, ~line 195)
- Test: `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `stepRecActive()`, `stepRecHead()` from Task 1.
- Produces: nothing new — the LED is observable through `setLED`.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/app-loop.mjs`, before the final summary block:

```javascript
_log('\napp-loop: step recording paints a blinking red head');
{
    resetApp();
    const { C_REC_RED } = await import('../dist/esm/seq/colors.js');
    const { STEP_NOTE_BASE } = await import('../dist/esm/seq/constants.js');
    const { stepRecActive } = await import('../dist/esm/seq/step-rec.js');

    seqState.playing = false;
    seqState.lenSteps = 16;
    sendMidi([0xB0, 86, 127]);                 // hold Rec
    advance(2);
    eq('step recording entered from a real Rec press', stepRecActive(), true);

    /* blinkPhase() is engineTick/24 % 2, so drive the mirrored tick to both
     * halves of the blink rather than waiting on wall time. */
    seqState.engineTick = 0;
    advance(1);
    eq('head lit red on the bright half', ledByPad[STEP_NOTE_BASE + 0], C_REC_RED);

    seqState.engineTick = 24;
    advance(1);
    eq('head dark on the other half', ledByPad[STEP_NOTE_BASE + 0] !== C_REC_RED, true);

    /* Move the head with a rest and confirm the red follows it. */
    seqState.engineTick = 0;
    sendMidi([0xB0, 63, 127]);                 // Right = rest
    advance(2);
    eq('the red head followed the rest', ledByPad[STEP_NOTE_BASE + 1], C_REC_RED);

    sendMidi([0xB0, 86, 0]);                   // release Rec
    advance(2);
    eq('mode left on release', stepRecActive(), false);
    seqState.lenSteps = 0;
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/app-loop.mjs
```

Expected: FAIL — `head lit red on the bright half` (the step shows the dim track colour, not red).

- [ ] **Step 3: Paint the head in `src/seq/leds.ts`**

Add the import next to the other `./` seq imports:

```typescript
import { stepRecActive, stepRecHead } from './step-rec.js';
```

In `seqLedsTick`, just above the `for (let i = 0; i < NUM_STEP_BUTTONS; i++)` step loop:

```typescript
    // The step-record head outranks every other step colour, including the
    // past-the-clip-length blackout — in grow mode the head legitimately sits
    // on a step the clip has not reached yet.
    const recHead = stepRecActive() ? stepRecHead() : -1;
    const headBlink = blinkPhase();
```

and inside the loop, make the head the first case:

```typescript
        if (step === recHead) {
            color = headBlink ? C_REC_RED : C_BLACK;
        } else if (emptyMetro) {
```

(the existing `if (emptyMetro)` becomes this `else if`; the rest of the chain is unchanged).

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/app-loop.mjs && node browser-test/logic.mjs
```

Expected: PASS, 0 failures in both.

- [ ] **Step 5: Refresh the screenshot baselines and check nothing else moved**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs
```

Expected: PASS, 0 failures — no scene enters step-record mode yet, so no baseline should change. If any diff appears, the LED change leaked into a rendered view; fix that rather than updating the baseline.

- [ ] **Step 6: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/leds.ts browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
Step recording: the record head blinks red on the step row

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
EOF
)"
```

---

### Task 5: The header band

A persistent inverted band showing the head position and the notes on it, over the still-visible parameter page.

**Files:**
- Modify: `src/seq/step-rec.ts` (header text + the tick that keeps the band alive)
- Modify: `src/app/tick.ts` (call `stepRecTick()`)
- Test: `browser-test/logic.mjs` (text), `browser-test/screenshot.mjs` (pixels)

**Interfaces:**
- Consumes: `seqHeaderAnnounce` (`seq/render.js`), `midiNoteName` (`keyboard/notes.js`), `fontWidth` (`font/index.js`), `W` (`renderer/layout.js`).
- Produces:
  - `stepRecHeaderText(): string`
  - `stepRecTick(): void` — Task 6 extends the same function with the preview.

- [ ] **Step 1: Write the failing text tests**

Append to `browser-test/logic.mjs`:

```javascript
/* ── step recording: header text ─────────────────────────────────────────── */
{
    _log('\nstep record — header:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { stepRecHeaderText, stepRecTick, resetStepRec } =
        await import('../dist/esm/seq/step-rec.js');
    const { seqHeaderActive, resetSeqHeader } = await import('../dist/esm/seq/render.js');

    const engine = installMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); resetSeqHeader();
    seqEngineTick();

    const realNow = Date.now;
    let t = 80000;
    Date.now = () => t;

    seqState.playing = false; seqState.lenSteps = 16;
    seqHandleMidi([0xB0, 86, 127], false);
    eq('header names the mode and the position', stepRecHeaderText(), 'STEP REC 1/16');

    seqState.holdNotes = [60, 64, 67];
    eq('header lists the notes on the head', stepRecHeaderText(), 'STEP REC 1/16 C4 E4 G4');

    /* Transposed clips play back shifted, so the header has to show what will
     * be heard, not what is stored. */
    seqState.clipTranspose = 2;
    eq('header shows the transposed pitches', stepRecHeaderText(), 'STEP REC 1/16 D4 F#4 A4');
    seqState.clipTranspose = 0;

    /* Long chords must not run off a 128px screen. */
    seqState.holdNotes = [60, 62, 64, 65, 67, 69, 71];
    const { fontWidth } = await import('../dist/esm/font/index.js');
    eq('header is clipped to the display width', fontWidth(stepRecHeaderText()) <= 124, true);

    seqState.holdNotes = [];
    seqState.lenSteps = 0;                 // empty clip in grow mode
    resetStepRec();
    seqHandleMidi([0xB0, 86, 0], false);
    seqHandleMidi([0xB0, 86, 127], false);
    eq('an empty clip has no length to show yet', stepRecHeaderText(), 'STEP REC 1/--');

    /* The band is kept alive by the tick, and dies with the mode. */
    resetSeqHeader();
    stepRecTick();
    eq('the tick keeps the band up', seqHeaderActive(), true);
    seqHandleMidi([0xB0, 86, 0], false);
    resetSeqHeader();
    stepRecTick();
    eq('no band once the mode is gone', seqHeaderActive(), false);

    Date.now = realNow;
    resetStepRec(); resetSeqState(); resetSeqEngine(); resetSeqHeader();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `stepRecHeaderText is not a function`.

- [ ] **Step 3: Add the header to `src/seq/step-rec.ts`**

Add the imports at the top of the file:

```typescript
import { fontWidth } from '../font/index.js';
import { midiNoteName } from '../keyboard/notes.js';
import { W } from '../renderer/layout.js';
import { seqHeaderAnnounce } from './render.js';
```

and the implementation at the end of the file:

```typescript
const HEADER_TTL = 2;        // ticks — re-armed every tick, so it dies with the mode

/* `STEP REC 5/16  C3 E3 G3`. The notes come from the engine's reply for the
 * head step and are shown as they will SOUND (clip transpose applied), so the
 * header agrees with the pads and with playback. Names are dropped from the end
 * until the line fits — a 128 px display cannot show a seven-note chord. */
export function stepRecHeaderText(): string {
    const len = seqState.lenSteps > 0 ? String(seqState.lenSteps) : '--';
    const base = `STEP REC ${head + 1}/${len}`;
    const names = seqState.holdNotes.map(
        (p) => midiNoteName(Math.max(0, Math.min(127, p + seqState.clipTranspose))),
    );
    let text = names.length > 0 ? `${base} ${names.join(' ')}` : base;
    while (names.length > 0 && fontWidth(text) > W - 4) {
        names.pop();
        text = names.length > 0 ? `${base} ${names.join(' ')}` : base;
    }
    return text;
}

/* Per app tick. Re-arms the header band with a 2-tick life so it stays up for
 * the whole gesture and vanishes on its own the moment the mode ends. */
export function stepRecTick(): void {
    if (!active) return;
    seqHeaderAnnounce(stepRecHeaderText(), HEADER_TTL);
}
```

- [ ] **Step 4: Call it from `src/app/tick.ts`**

Add to the import that already pulls `stepAutoTick`:

```typescript
import { stepRecTick } from '../seq/step-rec.js';
```

and call it directly after the existing `stepAutoTick();` line:

```typescript
    stepRecTick(); // keep the step-record header band alive while Rec is held
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 6: Add the screenshot scene**

In `browser-test/screenshot.mjs`:

1. Add `'step_rec_header'` to the `PRESETS` array, next to `'step_indicator'`.
2. Add `step_rec_header: 'test8',` to the `BASE` map, next to `step_indicator`.
3. Add the case to `applyView`, next to the other seq cases (the `clip-*` block is a good neighbour):

```javascript
        case 'step_rec_header': {   // held Rec: the band over a live param page
            resetSeqState();
            const { resetStepRec, stepRecDownAt, stepRecTick } =
                await import('../dist/esm/seq/step-rec.js');
            const { resetSeqHeader, drawSeqHeader } = await import('../dist/esm/seq/render.js');
            resetStepRec(); resetSeqHeader();
            seqState.playing = false; seqState.lenSteps = 16;
            stepRecDownAt(1000);
            seqState.holdNotes = [60, 64, 67];
            stepRecTick();
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSeqHeader(); };
            lastRender();
            break;
        }
```

If `applyView` is not already `async`, hoist the two imports to the top of `screenshot.mjs` alongside the other static imports and drop the `await import` calls — check with `grep -n "function applyView" browser-test/screenshot.mjs`.

- [ ] **Step 7: Generate and review the baseline**

```bash
cd /Users/dake/git/cld/movy && node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs
```

Expected: the update writes `browser-test/screenshots/baseline/step_rec_header.png` and the re-run passes with 0 failures. **Open the PNG and look at it** — the band must read `STEP REC 1/16 C4 E4 G4` in white-on-black at the top, with the parameter page visible below. Confirm no other baseline changed:

```bash
cd /Users/dake/git/cld/movy && git status --short browser-test/screenshots/baseline
```

Expected: exactly one new file, no modified ones.

- [ ] **Step 8: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/step-rec.ts src/app/tick.ts browser-test/logic.mjs browser-test/screenshot.mjs browser-test/screenshots/baseline/step_rec_header.png
git commit -m "$(cat <<'EOF'
Step recording: a header band showing the head position and its notes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
EOF
)"
```

---

### Task 6: Back-step preview

`←` plays what is on the step it lands on, so you can hear the note you are about to overwrite.

**Files:**
- Modify: `src/seq/step-rec.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `emitNoteOff` (`keyboard/release.js`), `shadow_send_midi_to_dsp` + `MidiNoteOn` (schwung globals), `previewPending` from Task 2.
- Produces: `stepRecTickAt(nowMs: number): void`; `stepRecTick()` becomes a wrapper over it.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```javascript
/* ── step recording: back-step preview ───────────────────────────────────── */
{
    _log('\nstep record — preview:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { stepRecTickAt, resetStepRec } = await import('../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec();
    seqEngineTick();

    /* Capture what movy sends to the DSP; env.mjs's version is a no-op. */
    const sent = [];
    const realSend = globalThis.shadow_send_midi_to_dsp;
    globalThis.shadow_send_midi_to_dsp = (m) => sent.push(m.slice());

    const realNow = Date.now;
    let t = 90000;
    Date.now = () => t;

    seqState.playing = false; seqState.lenSteps = 16;
    seqHandleMidi([0xB0, 86, 127], false);      // hold Rec
    seqNotePadPlayed(0, 80, 72, 100);
    seqNotePadReleased(80, 0);                  // note on step 1, head → 2

    sent.length = 0;
    seqHandleMidi([0xB0, 62, 127], false);      // Left → back to step 1
    stepRecTickAt(t);
    eq('nothing sounds before the engine answers', sent.length, 0);

    /* The engine's reply for the head step arrives on the next poll. */
    seqState.holdNotes = [72];
    seqState.holdVel = 100;
    stepRecTickAt(t);
    eq('the note on the step is previewed', sent.length, 1);
    eq('preview is a note-on for that pitch', sent[0][1], 72);
    eq('preview goes out on the track channel', sent[0][0], 0x90);

    sent.length = 0;
    stepRecTickAt(t + 100);
    eq('the preview holds for its duration', sent.length, 0);
    stepRecTickAt(t + 200);
    eq('the preview releases itself', sent.length, 1);
    eq('release is a note-off', sent[0][0], 0x80);
    eq('release matches the pitch', sent[0][1], 72);

    /* Only once per back-step: a repeat poll must not retrigger. */
    sent.length = 0;
    stepRecTickAt(t + 300);
    eq('the preview does not repeat', sent.length, 0);

    /* Leaving the mode with a preview still sounding must not strand it. */
    seqHandleMidi([0xB0, 62, 127], false);
    seqState.holdNotes = [72];
    stepRecTickAt(t + 400);
    sent.length = 0;
    seqHandleMidi([0xB0, 86, 0], false);        // release Rec
    eq('exit releases a sounding preview', sent.some((m) => m[0] === 0x80 && m[1] === 72), true);

    globalThis.shadow_send_midi_to_dsp = realSend;
    Date.now = realNow;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `stepRecTickAt is not a function`.

- [ ] **Step 3: Implement the preview in `src/seq/step-rec.ts`**

Add the import:

```typescript
import { emitNoteOff } from '../keyboard/release.js';
```

Add the state next to the other module state:

```typescript
const PREVIEW_MS = 150;
const PREVIEW_GIVE_UP_MS = 500;   // no reply for the new head → drop the request

/* Notes sounded by a back-step. Deliberately NOT in the pad ledger
 * (keyboard/held-notes.ts): no pad is involved, so a preview can never be
 * mistaken for a real pad release and misdirect its note-off. */
const preview: { track: number; pitch: number }[] = [];
let previewUntilMs = 0;
let previewAskedMs = 0;
```

Set `previewAskedMs = nowMs` where `previewPending = true` is set. Since `stepRecArrow` has no clock argument, record it with `Date.now()` there:

```typescript
        setHead(Math.max(0, head - 1));
        previewPending = true;         // play what is there, ready to overwrite
        previewAskedMs = Date.now();
```

Add the flush plus the real tick, and rewrite `stepRecTick`:

```typescript
function flushPreview(): void {
    for (const n of preview) emitNoteOff(n.track, n.pitch);
    preview.length = 0;
    previewUntilMs = 0;
}

/* Per app tick, with an explicit clock so the preview window is testable. The
 * pitches for a back-step come from the engine, so the preview fires when the
 * status reply for the new head lands — not at the moment of the arrow. */
export function stepRecTickAt(nowMs: number): void {
    if (preview.length > 0 && nowMs >= previewUntilMs) flushPreview();
    if (!active) return;
    seqHeaderAnnounce(stepRecHeaderText(), HEADER_TTL);
    if (!previewPending) return;
    if (seqState.holdStep === head && seqState.holdNotes.length > 0) {
        previewPending = false;
        const t = seqState.watchTrack;
        const vel = seqState.holdVel > 0 ? seqState.holdVel : 100;
        for (const p of seqState.holdNotes) {
            const pitch = Math.max(0, Math.min(127, p + seqState.clipTranspose));
            shadow_send_midi_to_dsp([MidiNoteOn | t, pitch, vel]);
            preview.push({ track: t, pitch });
        }
        previewUntilMs = nowMs + PREVIEW_MS;
    } else if (nowMs - previewAskedMs > PREVIEW_GIVE_UP_MS) {
        previewPending = false;   // empty step, or the reply never came
    }
}

export function stepRecTick(): void { stepRecTickAt(Date.now()); }
```

Add `flushPreview()` to `stepRecEnd()` and to `resetStepRec()` so no preview can be stranded.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 5: Prove the test has teeth**

Temporarily remove `flushPreview();` from `stepRecEnd()`, rebuild, re-run. Expected: `exit releases a sounding preview` FAILS. Restore and confirm green.

- [ ] **Step 6: Run the whole local suite**

```bash
cd /Users/dake/git/cld/movy && npm test
```

Expected: all four suites pass with 0 failures. `perf.mjs` in particular must not regress — the mode adds no per-tick IPC when it is inactive.

- [ ] **Step 7: Commit**

```bash
cd /Users/dake/git/cld/movy
git add src/seq/step-rec.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Step recording: stepping back plays the note you are about to overwrite

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
EOF
)"
```

---

### Task 7: Device test and documentation

**Files:**
- Modify: `scripts/test-seq.sh`
- Modify: `MANUAL.md`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the finished feature.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Read the existing device script's recording section**

```bash
cd /Users/dake/git/cld/movy && sed -n '95,135p' scripts/test-seq.sh
```

Note the helper names (`info`, the `$INJECT` invocation form, and how the script asserts against the log / `seq-state.json`) — reuse them exactly rather than inventing new ones.

- [ ] **Step 2: Add a step-record section to `scripts/test-seq.sh`**

Insert after the existing "Recording:" section, following the same style as its neighbours:

```bash
info "Step record: hold Rec (CC 86), play pads, arrow, release..."
python3 "$INJECT" "$HOST" cc 86 127      # hold Rec → step record (transport stopped)
sleep 0.3
python3 "$INJECT" "$HOST" note 68 110    # pad 1 down
python3 "$INJECT" "$HOST" note 68 0      # pad 1 up  → step 1 written, head → 2
sleep 0.3
python3 "$INJECT" "$HOST" cc 63 127      # Right → rest, head → 3
sleep 0.3
python3 "$INJECT" "$HOST" note 69 110    # pad 2 down
python3 "$INJECT" "$HOST" note 69 0      # pad 2 up  → step 3 written
sleep 0.3
python3 "$INJECT" "$HOST" cc 86 0        # release Rec → leave step record
sleep 0.5
```

Then assert on the resulting clip the same way the neighbouring sections do — two occupied steps with an empty step between them. If the script reads `seq-state.json`, assert the two notes are at steps 0 and 2; if it greps the log, assert on the `hold`/entry lines. **Match whatever the surrounding sections already do** — do not add a new assertion mechanism.

Guard against the pipefail trap documented in `movy/CLAUDE.md`: a bare `grep` in a pipeline aborts the script silently, so no `✓`/`✗` output is NOT a pass.

- [ ] **Step 3: Run the device test if the device is reachable**

```bash
cd /Users/dake/git/cld/movy && ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

Expected: PASS. If the device is offline, report that to the user **in caps** so it is clear device verification was skipped.

- [ ] **Step 4: Document it in `MANUAL.md`**

In §5 ("The sequencer"), add a bullet to the aligned-with-Move list right after the **Live recording** bullet:

```markdown
- **Step recording** — hold **Rec** while stopped and play the pads to enter
  notes one step at a time; see [Step recording](#step-recording) below.
```

Then add a subsection after the sequencer list, before "Saving — there is no Save button":

```markdown
### Step recording

Hold **Rec** while the transport is stopped and play the pads: each note lands
on the record head and the head moves on. Nothing is timed, so a phrase you
could never play in real time goes in as fast as you can find the notes. It
works the same on melodic and drum tracks.

Notes that overlap land on the **same step** — hold a chord and it is entered as
a chord; the head only advances when the last finger lifts. Tap notes one at a
time and each gets its own step.

While Rec is held:

| | |
|---|---|
| **pads** | enter notes at the head |
| **→** | leave a rest (or, with pads held, **tie** the chord into the next step) |
| **←** | step back — the note there plays and its pads light, ready to be replaced (or, with pads held, **untie**) |
| **step button** | jump the head there; if that step had notes, it is cleared |
| **Rec release** | done |

The head blinks red on the step row and the screen shows the position and the
notes under it, with the module's parameters still visible underneath — so you
can keep tweaking the sound while you enter the part.

![Step recording](docs/assets/step_rec_header.png)

On an **empty clip** the clip grows to exactly what you play, one step at a
time, rests included — play seven notes and you get a seven-step clip. On a clip
that already has notes the head **wraps** at the end and overwrites, leaving the
length alone.

Entering notes **replaces** what is on the step on a melodic track, so stepping
back and replaying overwrites cleanly. On a drum track pads only **add** their
own lane, so you can lay the kick down in one pass and the snare in the next.

A quick **tap** of Rec still arms live recording as before — only holding it
starts step recording.
```

- [ ] **Step 5: Generate the manual screenshot**

```bash
cd /Users/dake/git/cld/movy && node scripts/make-doc-assets.mjs 2>&1 | tail -20
```

If the script takes an explicit list of baselines, add `step_rec_header` to it (`grep -n "step_indicator\|BASELINES\|SHOTS" scripts/make-doc-assets.mjs`). Confirm `docs/assets/step_rec_header.png` exists and looks right:

```bash
cd /Users/dake/git/cld/movy && ls -l docs/assets/step_rec_header.png
```

- [ ] **Step 6: Add the README line**

In the sequencer feature list in `README.md`, next to the live-recording entry:

```markdown
- **Step recording** — hold **Rec** while stopped and play notes or chords in one
  step at a time, with ties, rests and back-stepping.
```

- [ ] **Step 7: Add the CHANGELOG entry**

At the top of the unreleased section of `CHANGELOG.md`:

```markdown
- **Step recording.** Hold **Rec** while the transport is stopped and play the
  pads to enter notes step by step, on melodic and drum tracks. Chords go in as
  chords, **→** leaves a rest or ties the held chord, **←** steps back and plays
  what is there, and a step button jumps the head (clearing that step). An empty
  clip grows to exactly what you play; an existing one wraps and overwrites. A
  quick tap of Rec still arms live recording.
```

- [ ] **Step 8: Full verification**

```bash
cd /Users/dake/git/cld/movy && npm test && node browser-test/screenshot.mjs
```

Expected: every suite passes with 0 failures. Report the actual output — do not claim success without it.

- [ ] **Step 9: Commit and push**

```bash
cd /Users/dake/git/cld/movy
git add scripts/test-seq.sh MANUAL.md README.md CHANGELOG.md docs/assets/step_rec_header.png
git commit -m "$(cat <<'EOF'
Document step recording, and cover it in the device sequencer test

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AjRpouHYfjcJoroYKVPgDT
EOF
)"
git push
```

---

## Self-review notes

- **Spec coverage:** design §1 → Tasks 1-3; §2 (module boundary, head range) → Task 1; §3/§4 (commands, `hold` reuse) → Tasks 1-3; §5 (LEDs, header, preview) → Tasks 4-6; §6 (precedence) → Task 1 (pads), Task 3 (step buttons, Play); §7 (testing) → every task plus Task 7; §8 (docs) → Task 7.
- **Knob precedence** needs no code: `automation.ts` gates on `recording && playing`, and step recording only runs while stopped, so knobs keep editing parameters. Verified by reading `src/seq/automation.ts:187`.
- **Naming is consistent** across tasks: `stepRecActive/Head/Down/Up/Pad/PadRelease/Arrow/StepTap/HeaderText/Tick/TickAt/End/GrowMode/PreviewPending` and `resetStepRec`.
- **Known cosmetic edge:** pressing `→` at head 0 on an empty clip creates a one-step clip containing only a rest. `clen` on a clip with no notes leaves the slot's `exist` flag false, so nothing plays and nothing is shown — acceptable, and consistent with "rests count toward the length".
