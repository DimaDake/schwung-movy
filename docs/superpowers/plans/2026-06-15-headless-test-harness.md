# Headless app-loop test harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a node-runnable harness that drives the real `init()`/`onMidiMessageInternal()`/`tick()` loop against the mock engine and a drum preset, capturing `setLED` so the LED-affordance layer (green priority, per-tick drum grid, multi-step entry) gets real local coverage; plus device-test additions to assert drum multi-step on hardware later.

**Architecture:** Extract the duplicated Schwung global stubs into `browser-test/env.mjs`. Build a standalone `browser-test/app-loop.mjs` that loads the bundled app entry points (`app/globals.js`), installs the mock engine + a drum preset, and exposes `resetApp`/`advance`/`padColor`/log-capture helpers so tests assert the full input→LED pipeline. The mock engine's status serializer is generalized to emit arbitrary keys (so tests can inject `act=`). A single `mlog` on the discrete drum step-entry path lets the device test count multi-step writes.

**Tech Stack:** TypeScript → esbuild (`dist/esm/` bundled entry points), node ES modules for tests, bash + `schwung-midi-inject-ui.py` for device e2e.

Spec: `docs/superpowers/specs/2026-06-15-headless-test-harness-design.md`

---

## File Structure

- Create: `browser-test/env.mjs` — `installEnv()`: assigns all Schwung global stubs + palette color globals; returns an `env` with `setParams(preset)` / `params` getter over a closed-over param store.
- Modify: `browser-test/logic.mjs` — replace the inline global block with `installEnv()`; keep file-browser-specific globals (`os`, `mockFsEntries`, console filter).
- Modify: `browser-test/mock-engine.mjs` — serialize `engine.status` as `key=value` pairs over all keys (not just play/tick/bpm) so tests inject `act=` etc.
- Modify: `build/browser.mjs` — add `src/app/globals.ts` as a browser entry point so `dist/esm/app/globals.js` exists and wires `init`/`tick`/`onMidiMessageInternal` onto `globalThis`.
- Create: `browser-test/app-loop.mjs` — the integration harness + assertions.
- Modify: `src/seq/router.ts` — `mlog` one line on the drum-lane step-entry path in `toggleStep`.
- Modify: `scripts/test-seq.sh` — drum multi-step + LED-smoke steps and log assertions.
- Modify: `package.json` — `"test:app"` script.
- Modify: `CLAUDE.md` (repo root) and `movy/CLAUDE.md` — add `app-loop.mjs` to the local test-order checklist.

---

## Task 1: Extract shared test env (`env.mjs`) and refactor `logic.mjs`

**Files:**
- Create: `browser-test/env.mjs`
- Modify: `browser-test/logic.mjs:15-30` (global block), `:65` (`mockState = {...preset}`), `:278` (`mockState[...]` read)

- [ ] **Step 1: Create `browser-test/env.mjs`**

```js
/* browser-test/env.mjs — shared Schwung global stubs for node tests.
 *
 * installEnv() assigns the globals the bundled modules read at call time and
 * returns an `env` whose param store backs shadow_get/set_param. Color globals
 * mirror the real hardware palette indices (src/seq/colors.ts) so LED
 * assertions compare against the same values the device uses. */

export function installEnv() {
    let params = {};
    const env = {
        setParams(preset) { params = { ...preset }; },
        get params() { return params; },
    };

    globalThis.fill_rect          = () => {};
    globalThis.clear_screen       = () => {};
    globalThis.shadow_get_param   = (_s, key) => params[key] ?? null;
    globalThis.shadow_set_param   = (_s, key, val) => { params[key] = val; return true; };
    globalThis.shadow_get_ui_slot = () => 0;
    globalThis.shadow_send_midi_to_dsp = () => {};
    globalThis.host_read_file     = () => null;
    globalThis.host_write_file    = () => true;
    globalThis.setLED             = () => {};
    globalThis.setButtonLED       = () => {};
    globalThis.MoveKnob1          = 71;
    globalThis.MidiNoteOn         = 0x90;
    globalThis.MidiNoteOff        = 0x80;
    /* shadow_ui re-encodes wheel deltas (1-63 = +, 65-127 = -). */
    globalThis.decodeDelta        = (d2) => (d2 < 64 ? d2 : d2 - 128);
    /* RGB palette indices used by keyboard/leds.ts (mirror of seq/colors.ts). */
    globalThis.NeonGreen          = 11;   // C_GREEN
    globalThis.White              = 120;  // C_WHITE
    globalThis.Black              = 0;    // C_BLACK
    /* Pad note range: MovePads[0]=68 .. 99 (32 pads). */
    globalThis.MovePads           = Array.from({ length: 32 }, (_, i) => 68 + i);

    return env;
}
```

- [ ] **Step 2: Refactor `logic.mjs` to use `installEnv()`**

Replace lines 15-30 (the `let mockState` declaration through the `decodeDelta` global) with:

```js
import { installEnv } from './env.mjs';

const env = installEnv();
```

Then update the two remaining `mockState` references:
- Line ~65 inside `bootModel`: change `mockState = { ...preset };` to `env.setParams(preset);`
- Line ~278: change `mockState['synth:sample']` to `env.params['synth:sample']`

Leave the file-browser globals untouched (`mockFsEntries`, `globalThis.os`, the `console.log` filter at lines ~32-47).

- [ ] **Step 3: Build and run the existing logic suite (must stay green — this is a no-op refactor)**

Run:
```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: ends with `ALL LOGIC CHECKS PASSED`, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add browser-test/env.mjs browser-test/logic.mjs
git commit -m "test: extract shared Schwung global stubs into env.mjs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Generalize mock-engine status to emit arbitrary keys

**Files:**
- Modify: `browser-test/mock-engine.mjs:56-65` (the `status` branch of `host_module_get_param`)
- Test: `browser-test/logic.mjs` (the existing `seq engine plumbing` block, ~line 452)

- [ ] **Step 1: Write the failing test** — add to the `seq engine plumbing` block in `logic.mjs`, after the engine is installed and booted:

```js
    // Mock engine serializes arbitrary status keys so tests can inject act=.
    engine.status.act = '38';            // track 0 pitch 38 sounding
    seqEngineTick();                     // poll → parseStatus → activeFromStr
    const { activeHasNote } = await import('../dist/esm/seq/state.js');
    eq('injected act= populates activeNotes', activeHasNote(0, 38), true);
    delete engine.status.act;
```

(If `activeHasNote` is already imported in this block, drop the local import line.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep "injected act"`
Expected: FAIL — the mock status only emits `play/tick/bpm`, so `activeHasNote(0,38)` is false.

- [ ] **Step 3: Generalize the serializer** — in `mock-engine.mjs`, replace the `status` branch:

```js
        if (key === 'status') {
            if (engine.statusUnavailable) return null;
            return Object.entries(engine.status)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ');
        }
```

This still emits `play tick bpm` (they are the default keys) plus any added key like `act`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: `injected act= populates activeNotes ✓` and `ALL LOGIC CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add browser-test/mock-engine.mjs browser-test/logic.mjs
git commit -m "test: mock engine serializes arbitrary status keys (act=, etc.)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Expose app entry points to the browser build + harness skeleton

**Files:**
- Modify: `build/browser.mjs:17` (entryPoints — add `app/globals.ts`)
- Create: `browser-test/app-loop.mjs`

- [ ] **Step 1: Add `app/globals.ts` to the browser entry points** — in `build/browser.mjs`, add to the `entryPoints` array (after the `src/keyboard/state.ts` line added previously):

```js
        resolve(root, 'src/app/globals.ts'),
```

- [ ] **Step 2: Build and confirm the output exists**

Run: `npm run build:browser && ls dist/esm/app/globals.js`
Expected: prints `dist/esm/app/globals.js` (no error).

- [ ] **Step 3: Create `browser-test/app-loop.mjs` skeleton with the first assertion**

```js
#!/usr/bin/env node
/* browser-test/app-loop.mjs — headless integration harness.
 *
 * Drives the REAL app loop (init / onMidiMessageInternal / tick) against the
 * mock engine and a drum preset, capturing setLED so we can assert the full
 * input→LED pipeline — the layer the device cannot read back. Run from movy
 * root: node browser-test/app-loop.mjs */

import { installEnv } from './env.mjs';
import { installMockEngine } from './mock-engine.mjs';
import { MOCK_SYNTHS } from './mock-synth.mjs';

const env    = installEnv();
const engine = installMockEngine();

/* Capture LED writes (override env's no-op setLED). */
const ledByPad = {};                       // padNote → last color
globalThis.setLED = (note, color) => { ledByPad[note] = color; };

/* [movy] log capture (for the drum step-entry log assertion). */
const logs = [];
const _origLog = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) logs.push(a[0]); };

/* Bundled app entry points assign init/tick/onMidiMessageInternal to globalThis. */
await import('../dist/esm/app/globals.js');
const { appState }      = await import('../dist/esm/app/state.js');
const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');

let failures = 0;
const _log = _origLog.bind(console);
function ok(label)        { _log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label, why) { _log(`  \x1b[31m✗\x1b[0m ${label}: ${why}`); failures++; }
function eq(label, actual, expected) {
    if (actual === expected) ok(label);
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const PAD_KICK = 68;   // grid pad 1 → drumPad 1 → midi note 36 (mrdrums padNoteStart=36)
const NOTE_KICK = 36;

/* Reset to a clean drum-track app state and settle the engine + hierarchy. */
function resetApp() {
    engine.reset();
    env.setParams(MOCK_SYNTHS.mrdrums);
    for (const k of Object.keys(ledByPad)) delete ledByPad[k];
    logs.length = 0;
    resetSeqState();
    resetSeqEngine();
    globalThis.init();                       // builds 4×chain models, resets keyboardState
    appState.trackModels[0][1].reload();     // force synth hierarchy/drum-config load
    advance(12);                             // settle engine boot + hierarchy + lane
}
function advance(n = 1) { for (let i = 0; i < n; i++) globalThis.tick(); }
function sendMidi(msg)  { globalThis.onMidiMessageInternal(msg); }
function padColor(p)    { return ledByPad[p]; }

/* ── Tests ───────────────────────────────────────────────────────────────── */

_log('\napp-loop: drum grid loads');
{
    resetApp();
    const vm = appState.trackModels[0][1].getViewModel();
    eq('drum preset detected (padCount 16)', vm.drumPadCount, 16);
    eq('drum lane selected (watchLane = note of current pad)', seqState.watchLane >= 0, true);
}

_log('\napp-loop: selected pad is white when idle');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]);   // press → selects pad, sounds (held)
    sendMidi([0x80, PAD_KICK, 0]);     // release → clears held
    advance(2);
    eq('idle selected pad = white', padColor(PAD_KICK), 120);
}

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log = _origLog;
if (failures === 0) _log('\n\x1b[32m\x1b[1mALL APP-LOOP CHECKS PASSED\x1b[0m');
else { _log(`\n\x1b[31m\x1b[1m${failures} APP-LOOP CHECK(S) FAILED\x1b[0m`); process.exit(1); }
```

- [ ] **Step 4: Run the harness**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: `drum preset detected`, `drum lane selected`, and `idle selected pad = white` all ✓; ends `ALL APP-LOOP CHECKS PASSED`.

If `idle selected pad = white` fails because the grid has not settled, raise the `advance(12)` in `resetApp` to `advance(16)` and re-run. The value must be deterministic — pick the smallest count that passes.

- [ ] **Step 5: Commit**

```bash
git add build/browser.mjs browser-test/app-loop.mjs
git commit -m "test: headless app-loop harness (init/tick/midi → setLED capture)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Assert green priority over white (sequencer gate)

**Files:**
- Modify: `browser-test/app-loop.mjs` (add a test block before the summary)

- [ ] **Step 1: Add the green-priority test** — insert before the `── Summary ──` block:

```js
_log('\napp-loop: green wins over white (sequencer gate)');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]); sendMidi([0x80, PAD_KICK, 0]); // select PAD_KICK
    advance(2);
    eq('precondition: selected pad white', padColor(PAD_KICK), 120);

    engine.status.act = String(NOTE_KICK);   // sequencer now sounding the kick
    advance(2);
    eq('sounding selected pad → green', padColor(PAD_KICK), 11);

    delete engine.status.act;                 // gate closes
    advance(2);
    eq('after gate closes → back to white', padColor(PAD_KICK), 120);
}
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: the three new assertions ✓. (If `green` regressed — e.g. white were checked before green — `sounding selected pad → green` would fail.)

- [ ] **Step 3: Commit**

```bash
git add browser-test/app-loop.mjs
git commit -m "test: assert drum LED green priority over white (sequencer gate)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Assert held-pad green (user playing the pad)

**Files:**
- Modify: `browser-test/app-loop.mjs` (add a test block before the summary)

- [ ] **Step 1: Add the held-pad test** — insert before the `── Summary ──` block:

```js
_log('\napp-loop: held pad lights green, reverts on release');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]);   // press and HOLD
    advance(2);
    eq('held pad → green', padColor(PAD_KICK), 11);

    sendMidi([0x80, PAD_KICK, 0]);     // release
    advance(2);
    eq('released pad reverts (selected → white)', padColor(PAD_KICK), 120);
}
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: `held pad → green ✓`, `released pad reverts ✓`.

Sanity bite-check (do NOT commit this change): temporarily remove `|| keyboardState.held[p] !== undefined` from `src/app/tick.ts` drum loop, rebuild, run — `held pad → green` must FAIL. Restore it before continuing.

- [ ] **Step 3: Commit**

```bash
git add browser-test/app-loop.mjs
git commit -m "test: assert held drum pad lights green via the real tick loop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Assert multi-step entry end-to-end

**Files:**
- Modify: `browser-test/app-loop.mjs` (add a test block before the summary)

- [ ] **Step 1: Add the multi-step test** — insert before the `── Summary ──` block:

```js
_log('\napp-loop: multi-step entry on a drum lane');
{
    resetApp();                          // drum lane already selected (watchLane >= 0)
    sendMidi([0x90, 16 + 0, 127]);       // hold step 0
    sendMidi([0x90, 16 + 3, 127]);       // press step 3 while step 0 held
    sendMidi([0x80, 16 + 3, 0]);         // release → step 3 toggles on
    sendMidi([0x80, 16 + 0, 0]);         // release → step 0 toggles on
    eq('drum multi: step 0 entered', occHasStep(0), true);
    eq('drum multi: step 3 entered', occHasStep(3), true);
    eq('drum multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);
}
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: both steps entered ✓, no `slen` ✓.

- [ ] **Step 3: Commit**

```bash
git add browser-test/app-loop.mjs
git commit -m "test: assert drum multi-step entry through the real MIDI router

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Emit a drum step-entry log line + assert it locally

**Files:**
- Modify: `src/seq/router.ts` (`toggleStep`, drum-lane branch)
- Modify: `browser-test/app-loop.mjs` (extend the multi-step block)

Note (perf): this `mlog` sits only on `toggleStep`, which fires on a discrete step-button press (interaction rate, ~1/press) — never on a per-tick/per-poll/per-LED path. It must not be moved onto any hot path. `perf.mjs` must stay green.

- [ ] **Step 1: Add the log-line assertion (failing first)** — extend the multi-step block in `app-loop.mjs`, before its closing `}`:

```js
    const stepLogs = logs.filter((l) => l.includes('seq: step'));
    eq('drum multi: two step-entry log lines', stepLogs.length, 2);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/app-loop.mjs 2>&1 | grep "step-entry log"`
Expected: FAIL — got 0, expected 2 (no log line emitted yet).

- [ ] **Step 3: Add the `mlog`** — in `src/seq/router.ts`, ensure `mlog` is imported (add `import { mlog } from '../log.js';` if absent), then in `toggleStep`, inside the drum-lane branch:

```js
    if (seqState.watchLane >= 0) {
        /* Drum lane: toggle just the selected lane's pitch at this step. */
        seqCmd(`ltog ${t} ${step} ${seqState.watchLane} ${seqState.lastVel[t]}`);
        mlog(`seq: step ${step} lane ${seqState.watchLane}`);
    } else {
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/app-loop.mjs`
Expected: `drum multi: two step-entry log lines ✓`, `ALL APP-LOOP CHECKS PASSED`.

- [ ] **Step 5: Run the full local suite (no regressions, perf intact)**

Run:
```bash
node browser-test/logic.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```
Expected: all three end with their PASS banners (`ALL LOGIC CHECKS PASSED`, `22 passed, 0 failed`, `ALL PERF CHECKS PASSED`).

- [ ] **Step 6: Commit**

```bash
git add src/seq/router.ts browser-test/app-loop.mjs
git commit -m "feat(seq): log drum step entry; assert multi-step logging locally

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Device-test additions + wiring

**Files:**
- Modify: `scripts/test-seq.sh` (add a drum multi-step section + log assertion)
- Modify: `package.json` (`"test:app"` script)
- Modify: `CLAUDE.md` (repo root) and `movy/CLAUDE.md` (test-order checklist)

- [ ] **Step 1: Add the drum multi-step section to `test-seq.sh`** — insert after the "Session mode" section (before the "Persistence" section, ~line 123). This selects a track, holds step 1, presses step 5 while held, then releases both:

```bash
info "Drum multi-step: hold step 1 + press step 5 on a drum track..."
python3 "$INJECT" "$HOST" cc 43 127      # select track 0 (CC43=slot0)
python3 "$INJECT" "$HOST" cc 43 0
sleep 0.3
python3 "$INJECT" "$HOST" note_on 16 127 # hold step 1
sleep 0.1
python3 "$INJECT" "$HOST" note_on 20 127 # press step 5 while step 1 held
python3 "$INJECT" "$HOST" note_off 20
python3 "$INJECT" "$HOST" note_off 16
sleep 0.5
```

- [ ] **Step 2: Add the multi-step log assertion** — in the assertions section of `test-seq.sh` (after the existing `seq: restored state` check, ~line 153):

```bash
STEP_LINES=$(echo "$LOG" | grep -c "seq: step" || true)
[[ "$STEP_LINES" -ge 2 ]] \
    && pass "Drum multi-step entered $STEP_LINES steps while one was held" \
    || fail "Multi-step entry not observed (expected >=2 'seq: step' lines, got $STEP_LINES)"
```

(This only asserts on a drum track. If track 0's synth is not a drum on the test device, the section is still harmless — it just records 0 lines and the check reports the gap. The local `app-loop.mjs` is the authoritative multi-step proof.)

- [ ] **Step 3: Add the `test:app` script to `package.json`** — in `"scripts"`:

```json
    "test:app": "node browser-test/app-loop.mjs",
```

- [ ] **Step 4: Update the test-order checklist in both CLAUDE.md files** — add the app-loop line after the `logic.mjs` line. In `movy/CLAUDE.md` under "Dev loop":

```bash
# 1b. Local (always) — full input→LED loop integration (drum grid, multi-step)
node browser-test/app-loop.mjs
```

And the equivalent line in the root `CLAUDE.md` "Run local tests first" block, right after `node browser-test/logic.mjs`:

```bash
   node browser-test/app-loop.mjs    # full app-loop integration (LED grid, multi-step)
```

- [ ] **Step 5: Run the full local suite once more**

Run:
```bash
npm run build:browser \
  && node browser-test/logic.mjs \
  && node browser-test/app-loop.mjs \
  && node browser-test/screenshot.mjs \
  && node browser-test/perf.mjs
```
Expected: every suite passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/test-seq.sh package.json CLAUDE.md ../CLAUDE.md
git commit -m "test: device drum multi-step assertion + wire app-loop into checklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 7: Device run (when `move.local` is reachable)**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected when online: `SEQ DEVICE TEST PASSED`, including `Drum multi-step entered >=2 steps`. If offline, report `DEVICE OFFLINE` to the user in CAPS.

---

## Self-Review notes

- **Spec coverage:** env.mjs (§ Components 1) → Task 1; mock-engine `act=` injection (enables § 2 green tests) → Task 2; app-loop harness + API (§ 2) → Task 3; resting/selected, green priority, held-pad green, multi-step (§ 3) → Tasks 3-6; device log line + multi-step assertion + perf constraint (§ 4) → Tasks 7-8; wiring (§ 5) → Task 8.
- **Type/name consistency:** `installEnv`/`env.setParams`/`env.params`, `resetApp`/`advance`/`sendMidi`/`padColor`, `ledByPad`, `engine.status.act`, `occHasStep`, `seqState.watchLane`, and the `seq: step <step> lane <lane>` log string are used consistently across tasks.
- **`mrdrums` facts:** `padNoteStart = 36`, `padCount = 16`, `rawMidi = false`, `ui_current_pad = 5`; grid pad 68 → drumPad 1 → note 36 (`PAD_KICK`/`NOTE_KICK`). Matches `browser-test/logic.mjs` drum tests.
