# Synth-track Step Gesture Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four synth-track step-sequencer gestures: visible note-length tail while holding a step, entering all selected notes on a step press, two-empty-steps multi-entry, and an occupancy-gated hold-A+press-B length gesture with an end/start toggle.

**Architecture:** All changes are UI-side in `src/seq/`. No engine changes — the Rust `slen` command, `hlen` readback, and `hold` query already provide everything. The length tail is an LED color change; multi-entry reuses the existing drum `coPressed` path; the length gesture is gated on the optimistic occupancy mirror.

**Tech Stack:** TypeScript (esbuild → `ui.js` / `dist/esm`), Node test harnesses (`browser-test/*.mjs`), Rust seq-core (unchanged here).

**Spec:** `plans/2026-06-19-synth-step-gesture-fixes.md`

**Pre-flight (run once before Task 1):**
```bash
cd /Users/dake/git/cld/movy
npm run build:browser   # ensure dist/esm is fresh before any .mjs test run
```

---

### Task 1: Visible length tail (Feature 1)

The length-span overlay already exists and is already painted before the
playhead/occupied checks (so it overrides white steps) and already returns `-1`
for 1-step notes. The only defect: it uses `trackColorDim(track)`, identical to
in-clip empty steps, so it's invisible. Change it to a distinct light grey.

**Files:**
- Modify: `src/seq/colors.ts` (add `C_LIGHTGREY`)
- Modify: `src/seq/leds.ts:124-128` (`lengthSpanColor` return), `leds.ts:5` (import)
- Test: `browser-test/logic.mjs` (unit test on `lengthSpanColor`), `browser-test/app-loop.mjs` (LED capture)

- [ ] **Step 1: Write the failing unit test**

Append to `browser-test/logic.mjs` after the existing `seq router:` block (before the final `process.exit`):

```javascript
{
    _log('\nseq length tail:');
    const { lengthSpanColor } = await import('../dist/esm/seq/leds.js');
    const { C_LIGHTGREY } = await import('../dist/esm/seq/colors.js');
    const { trackColorDim, C_DARKGREY } = await import('../dist/esm/seq/colors.js');
    // hold step 2, note length 3 steps → steps 3 and 4 are the tail.
    eq('tail step lights light-grey', lengthSpanColor(3, 2, 3, 0), C_LIGHTGREY);
    eq('last tail step lights light-grey', lengthSpanColor(4, 2, 3, 0), C_LIGHTGREY);
    eq('step beyond tail is not a span', lengthSpanColor(5, 2, 3, 0), -1);
    eq('held step itself is not a span', lengthSpanColor(2, 2, 3, 0), -1);
    eq('1-step note has no tail', lengthSpanColor(3, 2, 1, 0), -1);
    eq('no hold → no span', lengthSpanColor(3, -1, 0, 0), -1);
    eq('tail grey differs from in-clip dim', C_LIGHTGREY !== trackColorDim(0), true);
    eq('tail grey differs from out-of-clip dark-grey', C_LIGHTGREY !== C_DARKGREY, true);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node browser-test/logic.mjs`
Expected: FAIL — `C_LIGHTGREY` is `undefined`, so the import/eq checks fail.

- [ ] **Step 3: Add the color constant**

In `src/seq/colors.ts`, after the `C_DARKGREY` line:

```typescript
export const C_LIGHTGREY = 118; // schwung LightGrey ("dim white"): note-length tail — brighter than C_DARKGREY, distinct from colored track-dim
```

- [ ] **Step 4: Use it in the span overlay**

In `src/seq/leds.ts`, add `C_LIGHTGREY` to the existing import from `./colors.js` (line 5).

Then change `lengthSpanColor` (currently returns `trackColorDim(track)`):

```typescript
export function lengthSpanColor(absStep: number, holdStep: number, holdLen: number, track: number): number {
    if (holdStep < 0 || holdLen <= 1) return -1;
    if (absStep > holdStep && absStep <= holdStep + holdLen - 1) return C_LIGHTGREY;
    return -1;
}
```

The `track` parameter is now unused; keep the signature (callers pass it) and add a leading underscore is NOT needed — leave the name, the lint config tolerates it. If `npm run typecheck` flags it, rename the param to `_track`.

- [ ] **Step 5: Run unit test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — all `seq length tail:` checks green, zero failures overall.

- [ ] **Step 6: Add the LED-capture test in app-loop**

Append to `browser-test/app-loop.mjs` after the last seq scenario (before the failures summary). This verifies the painted step LED, not just the pure function:

```javascript
{
    _log('\nlength tail LED:');
    resetApp();
    seqState.watchLane = -1;          // melodic
    seqState.lenSteps = 16;
    seqState.holdStep = 2;
    seqState.holdLen = 3;             // note spans steps 2..4
    advance(2);                       // let the LED frame budget paint the step row
    eq('tail step 3 LED = light-grey (118)', padColor(16 + 3), 118);
    eq('tail step 4 LED = light-grey (118)', padColor(16 + 4), 118);
    seqState.holdStep = -1; seqState.holdLen = 0;
}
```

If `resetApp`/`seqState`/`advance`/`padColor` are not already in scope at that point in the file, move the block above the summary where they are (they are module-level in app-loop.mjs).

- [ ] **Step 7: Run app-loop to verify it passes**

Run: `node browser-test/app-loop.mjs`
Expected: PASS — `length tail LED:` checks green. (May need `advance(3)` instead of `advance(2)` if the FRAME_BUDGET defers the step row; bump until the step LED is set, this is expected harness behavior.)

- [ ] **Step 8: Commit**

```bash
git add src/seq/colors.ts src/seq/leds.ts browser-test/logic.mjs browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
Make held-step note-length tail visible (light grey)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Step press enters all selected (white) notes (Feature 2)

`toggleStep` falls back to a single `lastPitch` when no pads are held. The
white-selected set already lives in `held.ts` as `lastHeld`; enter that whole set.

**Files:**
- Modify: `src/seq/held.ts` (add `heldSetList`)
- Modify: `src/seq/router.ts` (import + `toggleStep` fallback, ~line 283)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs` inside a new block after the `seq length tail:` block:

```javascript
{
    _log('\nseq selected-note entry:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { setHeldSet } = await import('../dist/esm/seq/held.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); seqEngineTick();
    seqState.lenSteps = 16;
    const lastOp = () => engine.ops[engine.ops.length - 1];

    // Select a 3-note chord (white selection), then release the pads.
    setHeldSet(0, [60, 64, 67]);
    seqState.lastVel[0] = 100;
    seqState.lastPitch[0] = 60;
    // Tap an empty step with NO pads currently held → all selected notes entered.
    seqHandleMidi([0x90, 16 + 2, 127], false);
    seqHandleMidi([0x80, 16 + 2, 0], false);
    seqEngineTick();
    eq('step press enters full selection', lastOp(), 'tog 0 2 60 100 64 100 67 100');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node browser-test/logic.mjs`
Expected: FAIL — `lastOp()` is `tog 0 2 60 100` (only the single `lastPitch`).

- [ ] **Step 3: Add `heldSetList` to held.ts**

In `src/seq/held.ts`, after `noteHeld`:

```typescript
export function heldSetList(track: number): number[] {
    if (track < 0 || track > 3) return [];
    return [...lastHeld[track]];
}
```

- [ ] **Step 4: Use it in toggleStep**

In `src/seq/router.ts`, add `heldSetList` to the existing import from `./held.js` (currently `import { setHeldSet } from './held.js';`):

```typescript
import { heldSetList, setHeldSet } from './held.js';
```

Then in `toggleStep`, change the melodic pitches fallback:

```typescript
        /* Melodic: place the currently-held chord, else the full selected
         * (white) note set, else the last-played note; an occupied step clears. */
        const selected = heldSetList(t);
        const pitches = heldChord.size > 0
            ? [...heldChord.values()]
            : (selected.length > 0 ? selected : [seqState.lastPitch[t]]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — `step press enters full selection` green.

- [ ] **Step 6: Commit**

```bash
git add src/seq/held.ts src/seq/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Enter all selected (white) notes on a synth step press

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Two empty synth steps → notes on both (Feature 3)

Generalize the drum `coPressed` multi-entry exemption to synth by dropping the
`watchLane >= 0` gate. This path is only reached for synth when the anchor is
empty (Task 4 gates the length gesture on occupancy), so the two never collide.
NOTE: implement Task 3 and Task 4 together — the Task 3 test depends on the
Task 4 router gating to fall through to `editStepDown`. Write both, then run.

**Files:**
- Modify: `src/seq/step-edit.ts:54-66` (`editStepDown` coPressed gate)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs` in a new block:

```javascript
{
    _log('\nseq synth multi-entry:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');
    const { setHeldSet } = await import('../dist/esm/seq/held.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); seqEngineTick();
    seqState.lenSteps = 16;
    seqState.watchLane = -1;          // melodic
    setHeldSet(0, [60]); seqState.lastVel[0] = 100; seqState.lastPitch[0] = 60;

    // Two EMPTY steps pressed together → BOTH get notes, no length gesture.
    seqHandleMidi([0x90, 16 + 4, 127], false);   // press empty step 4
    seqHandleMidi([0x90, 16 + 6, 127], false);   // press empty step 6 while 4 held
    seqHandleMidi([0x80, 16 + 6, 0], false);     // release → step 6 toggles on
    seqHandleMidi([0x80, 16 + 4, 0], false);     // release → step 4 toggles on
    eq('synth multi: step 4 entered', occHasStep(4), true);
    eq('synth multi: step 6 entered', occHasStep(6), true);
    eq('synth multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node browser-test/logic.mjs`
Expected: FAIL — current code treats hold-4 + press-6 as a length gesture (`slen` emitted, step 6 not entered).

- [ ] **Step 3: Generalize the coPressed exemption**

In `src/seq/step-edit.ts`, change the gate in `editStepDown` (currently
`if (seqState.watchLane >= 0 && heldRanges.size >= 2) {`):

```typescript
    // Two+ steps held together are independent entries (drum lanes, or empty
    // synth steps — the length gesture is gated on an occupied anchor in the
    // router, so it never reaches here). Exempt them from the solo-hold
    // automation timer and undo any promotion that already happened, so each
    // still toggles on release.
    if (heldRanges.size >= 2) {
        for (const b of heldRanges.keys()) {
            coPressed.add(b);
            gestured.delete(b);
        }
        if (seqState.stepAutoMode) endStepAutomation(); // cancel solo-hold promotion
    }
```

(This step alone does not make the test pass — the router still intercepts the
press as a length gesture. Proceed to Task 4, then run.)

- [ ] **Step 4: Commit after Task 4 passes** (see Task 4 Step 6 — committed together).

---

### Task 4: Occupancy-gated length gesture with end/start toggle (Feature 4)

Length gesture fires only when the held anchor has a note (forward only). First
press of a given B ends the note at the END of B; pressing the same B again
trims to the START of B; each repeat flips.

**Files:**
- Modify: `src/seq/router.ts:108-125` (step note-on branch)
- Modify: `src/seq/step-edit.ts` (`setLengthTo` toggle, `editStepUp` reset, `resetStepEdit` reset)
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `browser-test/logic.mjs` in a new block:

```javascript
{
    _log('\nseq length gesture (occupancy + toggle):');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep, occToggleStep } =
        await import('../dist/esm/seq/state.js');

    const engine = installMockEngine();
    const TPS = 24; // ticks per step
    const slenOps = () => engine.ops.filter((o) => o.startsWith('slen'));
    const press = (b) => seqHandleMidi([0x90, 16 + b, 127], false);
    const release = (b) => seqHandleMidi([0x80, 16 + b, 0], false);

    // ── Occupied anchor: first press B=3 → note ends at END of step 3 (4 steps).
    resetSeqEngine(); resetSeqState(); seqEngineTick();
    engine.reset(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;
    occToggleStep(0);                 // step 0 has a note (occupied anchor)
    press(0);                          // hold occupied step 0
    press(3);                          // press step 3 → length to END of 3
    eq('length end-of-B: slen = 4 steps', slenOps().at(-1), `slen 0 0 0 -1 ${4 * TPS}`);
    eq('length gesture: B not entered', occHasStep(3), false);

    // Press same B=3 again (still holding A) → trim to START of step 3 (3 steps).
    release(3);
    press(3);
    eq('length toggle: slen = 3 steps', slenOps().at(-1), `slen 0 0 0 -1 ${3 * TPS}`);
    // Press again → back to END (4 steps).
    release(3);
    press(3);
    eq('length toggle back: slen = 4 steps', slenOps().at(-1), `slen 0 0 0 -1 ${4 * TPS}`);
    release(3); release(0);

    // ── Backward press (B <= A) on an occupied anchor → no-op, no entry.
    engine.reset(); seqEngineTick();
    occToggleStep(5);                 // ensure step 5 occupied (anchor)
    if (!occHasStep(5)) occToggleStep(5);
    press(5);
    press(2);                          // B < A
    eq('backward press: no slen', slenOps().length, 0);
    eq('backward press: step 2 not entered', occHasStep(2), false);
    release(2); release(5);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node browser-test/logic.mjs`
Expected: FAIL — current `setLengthTo` emits `(B−A)` steps (3 steps, not 4) on the first press, no toggle, and fires regardless of anchor occupancy.

- [ ] **Step 3: Add the toggle + occupancy reset to step-edit.ts**

In `src/seq/step-edit.ts`, add module state near the other top-level maps
(after `const coPressed = new Set<number>();`):

```typescript
/* Last hold-A + press-B length target, for the end/start toggle. atEnd=true
 * means the note ends at the END of step b ((b-a+1) steps); false trims to the
 * START of b ((b-a) steps). Reset when the anchor (A) is released. */
let lastLenTarget: { a: number; b: number; atEnd: boolean } | null = null;
```

Replace `setLengthTo`:

```typescript
/* Hold A (an occupied step) + press B → set A's note length. First press of a
 * given B ends the note at the END of B; pressing the same B again trims to the
 * START of B; each repeat flips. Returns true if a length-set was emitted. The
 * router only calls this when A is occupied; B <= A is a no-op (returns false,
 * but the router still consumes the press so B is not entered). */
export function setLengthTo(absB: number): boolean {
    const a = heldStepAbs();
    if (a < 0 || absB <= a) return false;
    markGestured();
    let atEnd = true;
    if (lastLenTarget && lastLenTarget.a === a && lastLenTarget.b === absB) {
        atEnd = !lastLenTarget.atEnd;
    }
    lastLenTarget = { a, b: absB, atEnd };
    const steps = atEnd ? (absB - a + 1) : (absB - a);
    const ticks = steps * TICKS_PER_STEP;
    seqCmd(`slen ${seqState.watchTrack} ${a} ${a} ${lane()} ${ticks}`);
    seqToast('Length ' + steps);
    return true;
}
```

In `editStepUp`, reset the toggle when a real held step (the anchor) is released
— add the reset at the top, before the existing body:

```typescript
export function editStepUp(button: number): boolean {
    if (heldRanges.has(button)) lastLenTarget = null; // anchor released → reset toggle
    const wasTap = heldRanges.has(button) && !gestured.has(button);
    heldRanges.delete(button);
    gestured.delete(button);
    coPressed.delete(button);
    pressMs.delete(button);
    return wasTap;
}
```

In `resetStepEdit`, add the reset:

```typescript
export function resetStepEdit(): void {
    heldRanges.clear();
    gestured.clear();
    coPressed.clear();
    pressMs.clear();
    lastLenTarget = null;
}
```

- [ ] **Step 4: Gate the router branch on occupancy**

In `src/seq/router.ts`, replace the step note-on `else if (on)` body
(lines ~108-125, the block that currently contains the
`if (!seqState.loopMode && seqState.watchLane < 0 && heldStepAbs() >= 0 && absB !== heldStepAbs() && setLengthTo(absB))`
length-gesture conditional) with:

```typescript
        } else if (on) {
            const absB = seqState.barOffset * NUM_STEP_BUTTONS + button;
            // Melodic anchor: exactly one synth step held in Note Mode.
            const anchor = (!seqState.loopMode && seqState.watchLane < 0)
                ? heldStepAbs() : -1;
            if (anchor >= 0 && absB !== anchor && occHasStep(anchor)) {
                // Occupied anchor → length gesture (forward only). B is never
                // registered as a held step, so multi-entry can't fire here and
                // B does not toggle. setLengthTo handles the end/start toggle;
                // B <= anchor is a consumed no-op.
                setLengthTo(absB);
            } else {
                editStepDown(button);
                if (seqState.loopMode) loopStepOn(button);
                if (!seqState.loopMode && seqState.watchLane < 0 && heldStepAbs() >= 0) {
                    seqState.holdStep = heldStepAbs();
                    seqState.holdNotes = [];
                    seqCmd('hold ' + seqState.watchTrack + ' ' + seqState.holdStep);
                }
            }
        }
```

- [ ] **Step 5: Run all logic tests to verify they pass**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — the `seq length gesture (occupancy + toggle):` AND
`seq synth multi-entry:` (Task 3) blocks are green, and the EXISTING
`seq router:` multi-step assertions still pass:
- `melodic hold+press: B not entered` (now the anchor must be occupied — see Step 5a)
- `melodic hold+press: emits slen`

- [ ] **Step 5a: Fix the pre-existing melodic hold+press test for occupancy**

The existing test at `browser-test/logic.mjs` (the `seq router:` block,
"Melodic: hold step A + press step B is the length gesture") holds an EMPTY
step 0. With the new occupancy gate, that is now multi-entry, not a length
gesture. Update that test so the anchor is occupied first:

Find:
```javascript
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 → length gesture
    seqHandleMidi([0x80, 16 + 3, 0], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    seqEngineTick();
    eq('melodic hold+press: B not entered', occHasStep(3), false);
    eq('melodic hold+press: emits slen', engine.ops.some((o) => o.startsWith('slen')), true);
```

Replace with (occupy step 0 first so it's a length anchor):
```javascript
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    occToggleStep(0);                            // step 0 occupied → length anchor
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold occupied step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 → length gesture
    seqHandleMidi([0x80, 16 + 3, 0], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    seqEngineTick();
    eq('melodic hold+press: B not entered', occHasStep(3), false);
    eq('melodic hold+press: emits slen', engine.ops.some((o) => o.startsWith('slen')), true);
```

`occToggleStep` is already imported in the `seq router:` block (line 584). Re-run:

Run: `node browser-test/logic.mjs`
Expected: PASS — zero failures.

- [ ] **Step 6: Commit Tasks 3 + 4 together**

```bash
git add src/seq/router.ts src/seq/step-edit.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Synth multi-entry + occupancy-gated length gesture with end/start toggle

Two empty synth steps pressed together now enter notes on both. The hold-A +
press-B length gesture fires only when the anchor has a note; the first press
of B ends the note at the end of B, pressing the same B again trims to the
start of B (toggles each repeat).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full local test sweep + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: zero errors. (If `lengthSpanColor`'s now-unused `track` param errors, rename it to `_track` and re-run.)

- [ ] **Step 2: Build + run all four local suites**

Run:
```bash
npm run build:browser
node browser-test/logic.mjs
node browser-test/app-loop.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
```
Expected: each reports 0 failures. (Or `npm test`.)

If `screenshot.mjs` fails: the OLED framebuffer is unchanged by these LED-only
edits, so a diff means an unintended render change — investigate, do NOT blindly
`--update`. The length tail is an LED, not a screen pixel, so no baseline change
is expected.

- [ ] **Step 3: Device tests (only if reachable)**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: PASS, or report `DEVICE OFFLINE` to the user IN CAPS if unreachable.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin synth-step-gesture-fixes
```

---

## Self-Review notes

- **Spec coverage:** Feature 1 → Task 1; Feature 2 → Task 2; Feature 3 → Task 3;
  Feature 4 → Task 4 (occupancy gate + toggle). Verification → Task 5.
- **Cross-task consistency:** Task 3's test passes only after Task 4's router
  gate is in place (called out explicitly in Task 3 Step 3 and the shared
  Task 3+4 commit). `setLengthTo` keeps its `(absB)` signature; `lastLenTarget`
  reset is wired in both `editStepUp` and `resetStepEdit`.
- **Naming:** `heldSetList` (held.ts) used by router; `C_LIGHTGREY` (colors.ts)
  used by leds.ts; `lastLenTarget` private to step-edit.ts.
- **No engine changes:** `slen` and `hlen` already exist; no `cargo test` needed
  unless `engine/` is touched (it is not).
