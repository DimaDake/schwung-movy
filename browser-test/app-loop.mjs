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

/* Capture button LED writes. */
const buttonLeds = {};
globalThis.setButtonLED = (cc, color) => { buttonLeds[cc] = color; };

/* [movy] log capture (for the drum step-entry log assertion). */
const logs = [];
const _origLog = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) logs.push(a[0]); };

/* Bundled app entry points assign init/tick/onMidiMessageInternal to globalThis. */
await import('../dist/esm/app/globals.js');
const { appState, VIEW_KNOBS, VIEW_CHAIN, VIEW_BROWSE, VIEW_FILE_BROWSE } = await import('../dist/esm/app/state.js');
const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { resetSeqPersist } = await import('../dist/esm/seq/persist.js');
const { CC_NOTE_SESSION, STEP_NOTE_BASE } = await import('../dist/esm/seq/constants.js');
const { anyStepHeld, STEP_AUTO_MS } = await import('../dist/esm/seq/step-edit.js');
const { stepPageState } = await import('../dist/esm/seq/step-page.js');
const { leaveModalActive } = await import('../dist/esm/app/leave-modal.js');
const { mainPageActive } = await import('../dist/esm/seq/main-page.js');

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

_log('\napp-loop: drum grid repaints once on a track switch, then idles');
{
    // movy owns the pad LEDs: the host strips Move's cable-0 note LEDs
    // unconditionally and its RGB sysex via the suppression claimed at init, so
    // nothing external can repaint a pad. The grid therefore needs exactly one
    // invalidation per track switch — enough to overwrite the previous layout's
    // colours, which the per-pad cache would otherwise consider correct — and
    // no re-assert window on top of it.
    resetApp();
    advance(45);
    const corrupt = () => { ledByPad[PAD_KICK] = 999; };

    // Steady state: movy trusts its cache and sends nothing.
    corrupt();
    advance(1);
    eq('idle: no re-send (cache-diffed, zero traffic)', padColor(PAD_KICK), 999);

    // A track switch invalidates the cache, so the very next tick repaints.
    sendMidi([0xB0, 42, 127]); sendMidi([0xB0, 42, 0]);  // → T2
    advance(2);
    sendMidi([0xB0, 43, 127]); sendMidi([0xB0, 43, 0]);  // → back to T1
    corrupt();
    advance(1);
    eq('track switch: grid repaints on the next tick', padColor(PAD_KICK) !== 999, true);

    // The invalidation is one-shot — the tick after it, traffic is back to zero.
    corrupt();
    advance(1);
    eq('one-shot: no re-assert window follows', padColor(PAD_KICK), 999);

    // Perf: the old 40-tick re-assert window re-sent all 32 pads every tick,
    // so a single track switch cost up to ~1280 LED writes. One invalidation
    // costs one grid's worth. Budget covers the grid plus the button/step LEDs
    // that legitimately change with the switch.
    resetApp();
    advance(45);
    let ledWrites = 0;
    const realSetLED = globalThis.setLED;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    sendMidi([0xB0, 42, 127]); sendMidi([0xB0, 42, 0]);  // → T2
    advance(40);
    globalThis.setLED = realSetLED;
    eq('track switch costs one grid repaint, not a window', ledWrites <= 80, true);
    _log(`    (${ledWrites} LED writes across 40 ticks after a track switch)`);
}

_log('\napp-loop: selected pad is white when idle');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]);   // press → selects pad, sounds (held)
    sendMidi([0x80, PAD_KICK, 0]);     // release → clears held
    advance(2);
    eq('idle selected pad = white', padColor(PAD_KICK), 120);
}

_log('\napp-loop: drum pads + step lane stay live on a non-synth module slot');
{
    resetApp();                              // drum on synth (slot 1), focused on synth
    appState.trackChainIndex[0] = 2;         // focus FX 1 slot (not the synth)
    advance(2);                              // FX model ticks; drum status still from synth
    eq('focused on FX slot: still a drum track (lane >= 0)', seqState.watchLane >= 0, true);

    const PAD_SNARE = 69;                    // grid pad 2 → drumPad 2 → midi note 37
    sendMidi([0x90, PAD_SNARE, 100]);        // press snare pad while the FX slot is focused
    sendMidi([0x80, PAD_SNARE, 0]);
    advance(2);
    eq('FX slot focused: drum pad selects its lane', seqState.watchLane, 37);
    eq('FX slot focused: selected drum pad lights white', padColor(PAD_SNARE), 120);
}

_log('\napp-loop: green wins over white (sequencer gate)');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]); sendMidi([0x80, PAD_KICK, 0]); // select PAD_KICK
    advance(2);
    eq('precondition: selected pad white', padColor(PAD_KICK), 120);

    engine.status.act = String(NOTE_KICK);   // sequencer now sounding the kick
    advance(10);                              // > STATUS_POLL_TICKS (8) → poll lands
    eq('sounding selected pad → green', padColor(PAD_KICK), 11);

    engine.status.act = '';                   // gate closes (engine reports nothing sounding)
    advance(10);
    eq('after gate closes → back to white', padColor(PAD_KICK), 120);
}

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

    const stepLogs = logs.filter((l) => l.includes('seq: step'));
    eq('drum multi: two step-entry log lines', stepLogs.length, 2);
}

_log('\napp-loop: file-param jog-click opens the browser on the chain page');
{
    const { VIEW_CHAIN, VIEW_FILE_BROWSE } = await import('../dist/esm/app/state.js');
    /* Minimal filesystem for the file browser's directory listing. */
    globalThis.os = {
        readdir: () => [['kick.wav', 'snare.wav'], 0],
        stat: (p) => [{ mode: p.endsWith('.wav') ? 0x8000 : 0x4000 }, 0],
    };
    const setup = () => {
        engine.reset();
        env.setParams(MOCK_SYNTHS.file_param);     // synth slot 0 = "sample" (file)
        resetSeqState(); resetSeqEngine();
        globalThis.init();
        appState.trackModels[0][1].reload();
        advance(12);                                // load hierarchy
        appState.currentView = VIEW_CHAIN;          // user is on the chain page
    };

    // Holding the file-param knob (slot 0) + jog click → file browser.
    setup();
    sendMidi([0x90, 0, 100]);   // touch knob 0 (file param), keep held
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);  // jog click
    eq('chain page: file-param jog click opens file browser', appState.currentView, VIEW_FILE_BROWSE);

    // Holding a non-file knob (slot 1 = Volume) + jog click → NOT a file browser.
    setup();
    sendMidi([0x90, 1, 100]);   // touch knob 1 (float param), keep held
    sendMidi([0xB0, 50, 127]);  // jog click
    eq('chain page: non-file knob jog click does not open file browser',
        appState.currentView === VIEW_FILE_BROWSE, false);
}

_log('\napp-loop: knob turn while a step is held writes automation');
{
    const { VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    const { resetAutomation } = await import('../dist/esm/seq/automation.js');

    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);   // knob 0 = file, knob 1 = Volume (float)
    resetSeqState(); resetSeqEngine(); resetAutomation();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);                              // settle engine + hierarchy
    appState.currentView = VIEW_KNOBS;
    appState.activeSlot = 0;

    // Step-automation mode + turning the Volume knob (CC 72 = knob 1) auto-assigns
    // a lane and writes a lock at the held step.
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    sendMidi([0xB0, 72, 1]);                  // knob 1, +1
    advance(1);                               // flush the cmd queue to the engine
    eq('step-auto knob auto-assigns a lane', engine.ops.some((o) => o.startsWith('alabel 0 0 ')), true);
    eq('step-auto knob writes a lock at step 4', engine.ops.some((o) => o.startsWith('aset 0 0 4 ')), true);

    // The file param (knob 0 = CC 71) is not automatable → no aset.
    engine.reset(); resetAutomation();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    sendMidi([0xB0, 71, 1]);                  // knob 0 (file param)
    advance(1);
    eq('file param not automated', engine.ops.some((o) => o.startsWith('aset')), false);
    seqState.stepAutoMode = false; seqState.holdStep = -1;
}

_log('\napp-loop: param page repaints when held-step automation changes');
{
    const { VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    const { resetAutomation } = await import('../dist/esm/seq/automation.js');

    // renderKnobsView is the only param-view path that calls clear_screen, so a
    // bump means the page actually repainted (LED/loop-strip use fill_rect/setLED).
    let clears = 0;
    globalThis.clear_screen = () => { clears++; };

    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);    // knob 1 = Volume (automatable float)
    resetSeqState(); resetSeqEngine(); resetAutomation();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;
    appState.activeSlot = 0;

    // Enter step-automation and turn knob 1 once to assign a lane + write a lock.
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    sendMidi([0xB0, 72, 1]);
    advance(20);                              // settle assign + initial repaint

    // Baseline: a held step with a stable lock must not repaint every tick
    // (the perf decoupling depends on this).
    let base = clears;
    advance(10);
    eq('idle held-step ticks do not repaint', clears, base);

    // 1) Turning a knob updates the held value → the page must repaint so the
    //    new value shows (the bug: the turn was consumed without marking dirty).
    base = clears;
    sendMidi([0xB0, 72, 1]);
    advance(2);
    eq('knob turn in step-auto repaints held value', clears > base, true);

    // 2) A status poll changing heldLocks (re-holding an automated step pulls
    //    the engine's locks via hauto) → the page must repaint to highlight it.
    engine.status.hauto = '0:10';
    advance(10);                              // absorb into the baseline
    base = clears;
    engine.status.hauto = '0:90';            // engine now reports a different lock
    advance(10);
    eq('poll-driven heldLocks change repaints', clears > base, true);

    globalThis.clear_screen = () => {};
    delete engine.status.hauto;
    seqState.stepAutoMode = false; seqState.holdStep = -1;
    resetAutomation();
}

/* ── length tail LED (held step shows its note length as a light-grey tail) ── */
{
    _log('\nlength tail LED:');
    resetApp();
    seqState.watchLane = -1;          // melodic
    seqState.lenSteps = 16;
    seqState.holdStep = 2;
    seqState.holdLen = 3;             // note spans steps 2..4 → tail on 3 and 4
    advance(4);                       // let the LED frame budget paint the step row
    eq('tail step 3 LED = light-grey (118)', padColor(16 + 3), 118);
    eq('tail step 4 LED = light-grey (118)', padColor(16 + 4), 118);
    seqState.holdStep = -1; seqState.holdLen = 0;
}

/* ── steps beyond clip length are fully off ──────────────────────────────── */
{
    _log('\nsteps beyond clip length off:');
    resetApp();
    seqState.watchLane = -1;          // melodic
    seqState.lenSteps = 4;            // clip is 4 steps; steps 5..16 are not in it
    seqState.holdStep = -1; seqState.holdLen = 0;
    advance(4);                       // let the step row paint
    eq('step 3 (in clip) is lit, not black', padColor(16 + 3) !== 0, true);
    eq('step 5 (beyond length) is fully off', padColor(16 + 5), 0);
    seqState.lenSteps = 16;
}

/* ── drum LED cleanup: non-grid pads cleared on drum entry ───────────────── */
_log('\napp-loop: drum LED cleanup on entry');
{
    resetApp();
    // Seed a stale color on a non-drum-grid pad (col >= 4 → Black in drum layout)
    ledByPad[72] = 99;
    // Force re-entry by resetting drumActive so tick re-enters the drum branch
    appState.drumActive = false;
    advance(1);
    eq('non-grid pad cleared to Black on drum entry', ledByPad[72], 0);
}

/* ── octave buttons disabled on drum track ───────────────────────────────── */
_log('\napp-loop: octave buttons disabled on drum track');
{
    resetApp();
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');
    const octBefore = keyboardState.octave[appState.activeSlot];
    for (const k of Object.keys(buttonLeds)) delete buttonLeds[k];
    sendMidi([0xB0, 55, 127]); // MoveUp press
    advance(1);
    eq('drum track: MoveUp does not shift octave', keyboardState.octave[appState.activeSlot], octBefore);
    eq('drum track: MoveUp button LED stays dark', buttonLeds[55] ?? 0, 0);
}

/* ── octave buttons flash white on normal (melodic) track ────────────────── */
_log('\napp-loop: octave buttons flash on melodic track');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);   // melodic synth, no drum config
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');
    // After init-batch, idle octave buttons show dim (WHITE_DIM=16) on melodic
    eq('melodic idle: MoveUp button dim', buttonLeds[55], 16);
    eq('melodic idle: MoveDown button dim', buttonLeds[54], 16);

    const octBefore = keyboardState.octave[appState.activeSlot];
    for (const k of Object.keys(buttonLeds)) delete buttonLeds[k];

    sendMidi([0xB0, 55, 127]); // MoveUp press
    advance(1);
    eq('melodic: MoveUp shifts the active track up an octave',
        keyboardState.octave[appState.activeSlot], octBefore + 1);
    eq('melodic: MoveUp button lights white', buttonLeds[55], 124); // WHITE_BRIGHT

    sendMidi([0xB0, 55, 0]); // MoveUp release
    advance(1);
    eq('melodic: MoveUp release returns to dim', buttonLeds[55], 16); // WHITE_DIM
}

/* ── drum→synth module switch does not crash (getDrumConfig race) ─────────── */
_log('\napp-loop: drum→synth switch does not crash');
{
    resetApp();   // drum (mrdrums) settled: drumPadCount=16, hierarchyKey=activeModuleName
    // Switch the underlying params to a non-drum synth while keeping the model
    // state pointing at the old drum hierarchy — exactly what happens when the
    // user switches modules mid-tick before pollModuleName fires.
    env.setParams(MOCK_SYNTHS.test8);
    appState.trackModels[0][1].reload();   // forces hierarchyKey='' so next tick
                                           // processTick calls loadHierarchy

    // Without the fix this single tick throws:
    // TypeError: cannot read property 'rawMidi' of null
    let threw = false;
    try { advance(1); } catch { threw = true; }
    eq('drum→synth transition tick does not throw', threw, false);

    // After a second tick the model has fully transitioned to the melodic synth
    advance(2);
    const vm = appState.trackModels[0][1].getViewModel();
    eq('after transition: drumPadCount is 0', vm.drumPadCount, 0);
    eq('after transition: drumActive flag cleared', appState.drumActive, false);
}

/* ── step-hold: jog wheel switches param page, never note length ──────────── */
_log('\napp-loop: jog wheel while holding a step switches page (not length)');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    const vm = () => appState.trackModels[0][appState.trackChainIndex[0]].getViewModel();
    const page0 = vm().bankIndex;
    sendMidi([0x90, 16, 127]);            // hold step 1
    engine.ops.length = 0;                // watch for any 'elen' length edit
    sendMidi([0xB0, 14, 1]);              // jog wheel +1
    eq('held-step jog switches page', vm().bankIndex, page0 + 1);
    eq('no note-length edit emitted', engine.ops.some(o => o.startsWith('elen')), false);
    sendMidi([0x80, 16, 0]);              // release step
}

/* ── step-hold: jog-press suppresses the module browser ───────────────────── */
_log('\napp-loop: jog-press while holding a step never opens the browser');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    sendMidi([0x90, 16, 127]);            // hold step 1
    sendMidi([0xB0, 3, 127]);             // jog press
    eq('knobs+held jog-press stays in params', appState.currentView, VIEW_KNOBS);
    sendMidi([0x80, 16, 0]);

    appState.currentView = VIEW_CHAIN;
    sendMidi([0x90, 16, 127]);
    sendMidi([0xB0, 3, 127]);
    eq('chain+held jog-press drills to params', appState.currentView, VIEW_KNOBS);
    eq('chain+held jog-press did not open browser', appState.currentView !== VIEW_BROWSE, true);
    sendMidi([0x80, 16, 0]);
}

/* ── step-hold: Back returns to the chain view (feature relies on this) ────── */
_log('\napp-loop: Back while holding a step returns to chain view');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    sendMidi([0x90, 16, 127]);            // hold step 1
    sendMidi([0xB0, 51, 127]);            // Back
    eq('Back while holding a step → chain view', appState.currentView, VIEW_CHAIN);
    sendMidi([0x80, 16, 0]);
}

/* ── step page: jog enters/leaves page 0; knobs edit trig props ───────────── */
_log('\napp-loop: step page navigation + knob editing');
{
    const { stepPageState, resetStepPage } = await import('../dist/esm/seq/step-page.js');
    const { occToggleStep } = await import('../dist/esm/seq/state.js');
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);         // melodic → watchLane = -1
    resetSeqState(); resetSeqEngine(); resetStepPage();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;
    appState.activeSlot = 0;

    sendMidi([0x90, 16, 127]);                // hold step 1 (abs step 0)
    occToggleStep(0);                         // the held step has a note (step page available)
    seqState.stepAutoMode = true;             // session promoted
    // Jog left from module bank 0 enters the step page; jog right leaves it.
    sendMidi([0xB0, 14, 127]);                // jog CCW (-1)
    eq('jog left enters the step page', stepPageState.selected, true);
    sendMidi([0xB0, 14, 1]);                  // jog CW (+1)
    eq('jog right leaves the step page', stepPageState.selected, false);

    // Back on the step page, the 5 knobs edit trig props (not chain automation).
    stepPageState.selected = true;
    engine.ops.length = 0;
    // CW raises probability (already 100 = max → no change); CCW lowers it.
    sendMidi([0xB0, 73, 120]); advance(1);    // knob 3 (probability) CCW (-8 → -1 detent)
    eq('probability CCW lowers to 90', engine.ops.some((o) => o === 'eprob 0 0 0 -1 90'), true);
    eq('step page never emits automation aset', engine.ops.some((o) => o.startsWith('aset')), false);

    engine.ops.length = 0;
    sendMidi([0xB0, 74, 8]); advance(1);      // knob 4 (condition) +1 detent → 1:2
    eq('condition knob emits econd 1 2', engine.ops.some((o) => o === 'econd 0 0 0 -1 1 2'), true);

    engine.ops.length = 0;
    sendMidi([0xB0, 75, 8]); advance(1);      // knob 5 (invert) → on
    eq('invert knob emits einv 1', engine.ops.some((o) => o === 'einv 0 0 0 -1 1'), true);

    engine.ops.length = 0;
    sendMidi([0xB0, 71, 1]); advance(1);      // knob 1 (velocity) up → evel delta
    eq('velocity knob uses evel delta', engine.ops.some((o) => /^evel 0 0 0 -1 \d+$/.test(o)), true);

    // Length is capped by the next note: with max gate 96 ticks (1/4), turning
    // length far up clamps to 96 rather than overrunning.
    seqState.holdGate = 12; seqState.holdMaxGate = 96;
    engine.ops.length = 0;
    sendMidi([0xB0, 72, 63]); advance(1);     // knob 2 (length) hard CW
    const slen = engine.ops.find((o) => o.startsWith('slen'));
    eq('length clamps to the cap (96 ticks)', slen, 'slen 0 0 0 -1 96');

    // A held step with NO note has no per-trig params → the step page is not
    // available; jog falls back to normal page nav.
    stepPageState.selected = false;
    occToggleStep(0);                         // clear the note on the held step
    sendMidi([0xB0, 14, 127]);                // jog CCW
    eq('empty step does not open the step page', stepPageState.selected, false);

    sendMidi([0x80, 16, 0]);
    seqState.stepAutoMode = false;
}

/* ── step page: tick() renders the step page when selected ────────────────── */
_log('\napp-loop: tick renders the step page');
{
    const { stepPageState, resetStepPage } = await import('../dist/esm/seq/step-page.js');
    const { occToggleStep } = await import('../dist/esm/seq/state.js');
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);
    resetSeqState(); resetSeqEngine(); resetStepPage();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;
    appState.activeSlot = 0;
    sendMidi([0x90, 16, 127]);
    occToggleStep(0);                         // held step has a note
    seqState.stepAutoMode = true;
    stepPageState.selected = true;

    // renderKnobsView is the only param path that calls clear_screen, so a bump
    // proves the step-page branch repainted without throwing.
    let clears = 0;
    const origClear = globalThis.clear_screen;
    globalThis.clear_screen = () => { clears++; };
    appState.dirty = true;
    advance(1);
    globalThis.clear_screen = origClear;
    eq('tick repainted with the step page selected', clears > 0, true);

    sendMidi([0x80, 16, 0]);
    seqState.stepAutoMode = false;
}

/* ── automation: a module change re-validates lanes (purges now-stale) ─────── */
_log('\napp-loop: module change purges lanes invalid for the new module');
{
    const { laneForParam, resetAutomation } = await import('../dist/esm/seq/automation.js');
    const { requestLabelSync } = await import('../dist/esm/seq/engine.js');
    resetApp();                  // mrdrums on track 0
    resetAutomation();
    // Engine holds a valid per-pad lane (p01_vol → alias pad_vol, in mrdrums).
    engine.alabels = '-.synth:p01_vol.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-';
    requestLabelSync();          // engine delivered labels → sync validates them
    advance(3);
    eq('per-pad lane kept under mrdrums', laneForParam(0, 'synth:p01_vol'), 1);

    // Swap the synth to a melodic module with no pad params. Without the
    // module-change re-sync the stale lane would survive until the next boot.
    env.setParams(MOCK_SYNTHS.test8);
    appState.trackModels[0][1].reload();
    advance(6);
    eq('lane purged after module change', laneForParam(0, 'synth:p01_vol'), -1);
}

/* ── automation: the pool-full toast is not overdrawn by the Loop strip ────── */
_log('\napp-loop: pool-full toast wins the bottom rows over the loop strip');
{
    const { resetAutomation, assignLane } = await import('../dist/esm/seq/automation.js');
    resetApp();
    // "8 AUTOMATION LANES — FULL" shows while a step is held and all 8 lanes are
    // assigned (pool full is derived live from the registry).
    resetAutomation();
    for (let i = 0; i < 8; i++) {
        assignLane(0, 0, { gi: 0, key: 'p' + i, ioKey: 'p' + i, target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true }, () => true);
    }
    seqState.stepAutoMode = true;
    appState.currentView = VIEW_KNOBS;
    appState.dirty = true;

    // drawLoopStrip() always clears its band first: fill_rect(0, 60, 128, 4, 0).
    // If the strip is (wrongly) drawn over the toast, that clear band appears.
    const rects = [];
    const origFR = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push([x, y, w, h, v]);
    advance(1);
    globalThis.fill_rect = origFR;
    const stripDrawn = rects.some(([x, y, w, h, v]) => x === 0 && y === 60 && w === 128 && h === 4 && v === 0);
    eq('loop strip suppressed under pool-full toast', stripDrawn, false);
    // drawJogToast draws its inverted bar at fill_rect(0, TOAST_Y=58, 128, 6, 1);
    // its presence at 8-lanes+held proves the "FULL" toast renders immediately.
    const toastDrawn = rects.some(([x, y, w, h, v]) => x === 0 && y === 58 && w === 128 && h === 6 && v === 1);
    eq('pool-full toast shown immediately at 8 lanes', toastDrawn, true);
    seqState.stepAutoMode = false; resetAutomation();
}

/* ── Full-screen file browser exits cleanly (Back + select) ──────────────────
 * Regression guard: browseOrigin must capture the pre-open view. If it captures
 * VIEW_FILE_BROWSE (because openFileBrowser already flipped currentView), Back
 * and select send the user "back" to the browser itself — a frozen screen. */
_log('\napp-loop: full-screen file browser exits cleanly');
{
    const TP = '/data/UserData/UserLibrary/Track Presets';
    const savedOs   = globalThis.os;
    const savedRead = globalThis.host_read_file;
    const mockFs = { [TP]: ['drum.ablpreset', 'other.ablpreset'] };
    // os is needed by the browser scan; install AFTER resetApp so module-config
    // loading (which also reads via host_read_file) uses the bundled config.
    resetApp();
    globalThis.os = {
        readdir: (p) => [mockFs[p] ?? [], 0],
        stat:    (p) => [{ mode: p.lastIndexOf('.') > p.lastIndexOf('/') ? 0x8000 : 0x4000 }, 0],
    };

    // Gesture: chain→knobs, jog to the Preset page, hold preset knob, jog-click.
    sendMidi([0xB0, 3, 127]); advance(1);            // jog-click: VIEW_CHAIN → VIEW_KNOBS
    // Each config bank is one page; Preset is the last of 4 (Main/Rand/Global/Preset).
    sendMidi([0xB0, 14, 1]); sendMidi([0xB0, 14, 1]); sendMidi([0xB0, 14, 1]); advance(1);  // → Preset page
    sendMidi([0x90, 0, 127]);                         // touch preset knob 0
    sendMidi([0xB0, 3, 127]);                         // jog-click → open full browser

    eq('browser opened', appState.currentView, VIEW_FILE_BROWSE);
    eq('browseOrigin captured the pre-open view', appState.browseOrigin, VIEW_KNOBS);

    // Back must return to the origin view, not to the (now empty) browser.
    sendMidi([0xB0, 51, 127]); advance(1);            // MoveBack
    eq('Back leaves the file browser', appState.currentView, VIEW_KNOBS);
    eq('Back clears fileBrowserState', appState.fileBrowserState, null);

    // Reopen, move to drum.ablpreset, select → loads + closes the browser.
    sendMidi([0x90, 0, 127]); sendMidi([0xB0, 3, 127]); advance(1);
    sendMidi([0xB0, 14, 1]);                          // skip '..' → drum.ablpreset
    globalThis.host_read_file = (p) => p.endsWith('.ablpreset') ? '{ "kind": "drumRack" }' : null;
    sendMidi([0xB0, 3, 127]);                         // jog-click = select
    globalThis.host_read_file = savedRead;
    eq('select leaves the file browser', appState.currentView, VIEW_KNOBS);
    eq('select clears fileBrowserState', appState.fileBrowserState, null);
    eq('select committed the preset path', env.params['synth:ui_preset_path'], TP + '/drum.ablpreset');

    globalThis.os = savedOs;
}

/* ── Main Params page: Shift+Step 5 opens, knob edits tempo, Back exits ────── */
_log('\napp-loop: main params page entry, knob routing, Back exit');
{
    const { VIEW_MAIN_PARAMS } = await import('../dist/esm/app/state.js');
    resetApp();
    engine.reset();

    // resetApp() settles on VIEW_CHAIN (drum track default); capture it as the
    // expected origin so Back must restore exactly this view.
    const originView = appState.currentView;   // VIEW_CHAIN

    // Shift+Step 5 (0-indexed button 4 = note STEP_NOTE_BASE+4 = 16+4 = 20)
    sendMidi([0xB0, MoveShift, 127]);          // Shift down
    sendMidi([0x90, 16 + 4, 127]);             // Step 5 on
    sendMidi([0x80, 16 + 4, 0]);              // Step 5 off
    sendMidi([0xB0, MoveShift, 0]);            // Shift up
    eq('shift+step 5 opens main params', appState.currentView, VIEW_MAIN_PARAMS);

    // Knob 0 turn (CC 71 = MoveKnob1, delta +1 encoded as value 1)
    // The mock engine starts with bpm=12000 (120.00 BPM). A single +1 detent
    // should raise it by 100 (to 12100 = 121 BPM) and emit a 'bpm ...' command.
    engine.ops.length = 0;
    sendMidi([0xB0, 71, 8]);                   // knob 0 (tempo) CW +1 detent (value 8 = +8 delta)
    advance(1);
    eq('knob 0 edits tempo on main page',
        engine.ops.some((c) => c.startsWith('bpm ')), true);

    // Back exits the page and must restore exactly the origin view (VIEW_CHAIN),
    // not just any view other than VIEW_MAIN_PARAMS.
    sendMidi([0xB0, MoveBack, 127]);
    eq('Back exits main params to origin view', appState.currentView, originView);
}

/* ── A track button closes the Set Parameters page (so per-track view memory
 *    can't re-show it on return to that track) ───────────────────────────── */
_log('\napp-loop: track button closes set parameters page');
{
    const { VIEW_MAIN_PARAMS } = await import('../dist/esm/app/state.js');
    const { mainPageActive } = await import('../dist/esm/seq/main-page.js');
    resetApp();
    engine.reset();
    sendMidi([0xB0, MoveShift, 127]); sendMidi([0x90, 16 + 4, 127]); sendMidi([0x80, 16 + 4, 0]); sendMidi([0xB0, MoveShift, 0]);
    eq('set params open before track press', appState.currentView, VIEW_MAIN_PARAMS);
    // Press the CURRENT track's button (CC43 = track 0): tap down+up.
    sendMidi([0xB0, 43, 127]); sendMidi([0xB0, 43, 0]);
    eq('track button leaves set params view', appState.currentView !== VIEW_MAIN_PARAMS, true);
    eq('track button clears set params state', mainPageActive(), false);
}

/* ── Master FX: jog-click adds a module by DSP path (not id) ──────────────── */
_log('\napp-loop: master FX slot adds a module by DSP path');
{
    // Master FX modules live under modules/audio_fx; schwung resolves
    // master_fx:fxN:module as a DSP PATH (track slots use the bare id).
    const prevOs = globalThis.os;
    const prevRead = globalThis.host_read_file;
    globalThis.os = {
        readdir: (p) => (p.endsWith('/audio_fx') ? [['reverb'], 0] : [[], 0]),
        stat: () => [{ mode: 0x4000 }, 0],
    };
    globalThis.host_read_file = (p) =>
        p.endsWith('/audio_fx/reverb/module.json')
            ? JSON.stringify({ id: 'reverb', name: 'Reverb', dsp: 'dsp.so', component_type: 'audio_fx' })
            : null;

    const sets = [];
    const realSet = globalThis.shadow_set_param;
    globalThis.shadow_set_param = (s, k, v) => { sets.push(`${s}|${k}=${v}`); return realSet(s, k, v); };

    resetApp();
    seqState.sessionMode = true;          // master FX chain is shown in Session mode
    appState.masterChainIndex = 0;
    appState.currentView = VIEW_CHAIN;
    advance(2);

    sendMidi([0xB0, globalThis.MoveMainButton, 127]);   // jog-click on empty master slot
    eq('master jog-click opens the module browser', appState.currentView, VIEW_BROWSE);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);        // jog → select Reverb (index 1; 0 = NONE)
    sets.length = 0;
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);    // jog-click → load selection

    const moduleSet = sets.find((s) => s.includes('master_fx:fx1:module='));
    eq('master load writes master_fx:fx1:module', !!moduleSet, true);
    eq('master load writes the DSP path, not the id',
        moduleSet?.endsWith('/audio_fx/reverb/dsp.so'), true);

    globalThis.shadow_set_param = realSet;
    globalThis.os = prevOs;
    globalThis.host_read_file = prevRead;
}

/* ── Master FX: jog-click on a loaded slot drills into its detail params ───── */
_log('\napp-loop: master FX slot drills into detail params on jog-click');
{
    resetApp();
    // master_fx:fx1:name reads back → masterModel[0] polls non-empty (slot loaded).
    env.setParams({ ...MOCK_SYNTHS.mrdrums, 'master_fx:fx1:name': 'Reverb' });
    seqState.sessionMode = true;
    appState.masterChainIndex = 0;
    appState.currentView = VIEW_CHAIN;
    appState.masterDetail = false;
    appState.masterFxModels[0].reload();   // pollCountdown=1 → next tick reads the name
    advance(2);

    eq('master slot reads as loaded', appState.masterFxModels[0].getViewModel().isEmpty, false);

    sendMidi([0xB0, globalThis.MoveMainButton, 127]);   // jog-click on a loaded master slot
    eq('jog-click drills into master detail params', appState.masterDetail, true);

    // Jog rotation while in detail scrolls the module's param pages — it must
    // NOT switch master slots (that is grid-view navigation).
    appState.masterChainIndex = 0;
    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);
    eq('jog rotation in detail does not switch master slot', appState.masterChainIndex, 0);

    // Second jog-click (now in detail) opens the module browser to swap, like
    // the track chain's VIEW_KNOBS. Back returns to the detail page (not grid).
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);
    eq('second jog-click opens the module browser', appState.currentView, VIEW_BROWSE);
    sendMidi([0xB0, globalThis.MoveBack, 127]);
    eq('Back from browser returns to the detail page', appState.masterDetail, true);

    // Back from the detail page returns to the master grid (not exit, not track).
    sendMidi([0xB0, globalThis.MoveBack, 127]);
    eq('Back returns to the master chain grid', appState.masterDetail, false);
    eq('Back stays in session mode', seqState.sessionMode, true);
}

_log('\napp-loop: active-set switch reloads the engine');
{
    // Back the host filesystem with an in-memory map and an active set "S1".
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const ACTIVE = '/data/UserData/schwung/active_set.txt';
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';

    fs[ACTIVE] = 's1-uuid\nSet One\n';
    resetSeqPersist();                       // force a fresh boot-load
    resetApp();                              // init() + settle; boot-load reads S1
    advance(4);
    const loadsAfterBoot = engine.stateLoads.length;
    eq('boot loaded a set blob', loadsAfterBoot >= 1, true);

    // Switch the active set; the poll (~96 ticks) must reload for the new UUID.
    // The engine reports edited state, so switching out must persist it — the
    // flush is forced there rather than trusting the 24 Hz dirty mirror, which
    // can still read clean for an edit made moments before the switch.
    engine.stateBlob = 'movy1\nbpm 13700\ncl 0 0 16 0 0:24:60:100\n';
    fs[ACTIVE] = 's2-uuid\nSet Two\n';
    advance(120);
    eq('set switch triggered a fresh engine load', engine.stateLoads.length > loadsAfterBoot, true);
    eq('S1 saved on switch-out', typeof fs[stPath('s1-uuid')], 'string');
    eq('S1 kept its edits', fs[stPath('s1-uuid')].includes('bpm 13700'), true);
}

_log('\napp-loop: LFO chain slot reachable + drill');
{
    resetApp();
    appState.currentView = VIEW_CHAIN;
    appState.trackChainIndex[0] = 1;          // start on SYNTH

    // Jog right 3 detents: 1→2→3→4 (LFO).
    sendMidi([0xB0, 14, 1]); advance(1);
    sendMidi([0xB0, 14, 1]); advance(1);
    sendMidi([0xB0, 14, 1]); advance(1);
    eq('jog reaches LFO slot (index 4)', appState.trackChainIndex[0], 4);

    // Jog-click drills into the LFO detail (VIEW_KNOBS), never a browser.
    sendMidi([0xB0, 3, 127]); advance(1);
    eq('LFO jog-click drills to VIEW_KNOBS', appState.currentView, VIEW_KNOBS);
    eq('active model is the LFO', appState.trackModels[0][4].getComponentKey(), 'lfo');

    // Jog in detail scrolls banks LFO1↔LFO2.
    sendMidi([0xB0, 14, 1]); advance(1);
    eq('detail jog scrolls to LFO 2', appState.trackModels[0][4].getKnobPage(), 1);

    // Shift+jog-click on the LFO chain page also drills (no browser to swap).
    appState.currentView = VIEW_CHAIN;
    appState.shiftHeld = true;
    sendMidi([0xB0, 3, 127]); advance(1);
    eq('shift+click on LFO drills, no browser', appState.currentView, VIEW_KNOBS);
    appState.shiftHeld = false;
}

_log('\napp-loop: hold-knob → assign LFO target');
{
    const { appState, VIEW_CHAIN, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    const { resetAssignMode, assignActive } = await import('../dist/esm/lfo/assign-mode.js');
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackModels[0][1].reload();  // load the synth hierarchy
    advance(12);                          // settle hierarchy + engine
    appState.trackChainIndex[0] = 1;      // synth
    appState.currentView = VIEW_KNOBS;
    resetAssignMode();
    eq('synth param 0 is automatable', appState.trackModels[0][1].getKnobParamInfo(0)?.automatable, true);

    const realNow = Date.now; let t = 10000; Date.now = () => t;
    sendMidi([0x90, 0, 100]);             // touch knob 0 (automatable synth param)
    advance(1);
    t = 11100; advance(1);                // > 1000ms → holdTick activates assign mode
    eq('assign mode active after hold', assignActive(), true);

    sendMidi([0xB0, 3, 127]);             // jog-click → assign LFO1
    advance(1);
    eq('assigned: navigated to LFO slot', appState.trackChainIndex[0], 4);
    eq('assigned: on chain view', appState.currentView, VIEW_CHAIN);
    eq('assign mode exited', assignActive(), false);

    // Bug 1: the LFO page must show the freshly-assigned target, not "None"
    // (the model's cached target was stale until reload()).
    advance(3);
    eq('LFO page shows the assigned target (not None)',
        appState.trackModels[0][4].getViewModel().rows[0][3].displayValue !== 'None', true);

    // Bug 2: the knob was never released (release landed on the LFO model), so
    // the module's touch would stick — returning to the module page must clear
    // it (touch reset on shown-page change).
    eq('module still touched before return',
        appState.trackModels[0][1].getViewModel().touchedSlot, 0);
    appState.trackChainIndex[0] = 1;      // navigate back to the synth
    advance(2);
    eq('module touch cleared on return',
        appState.trackModels[0][1].getViewModel().touchedSlot, null);
    Date.now = realNow;
}

_log('\napp-loop: jog touch shows the CLICK JOG hint only after a hold');
{
    const { jogHintVisible, jogHintTouch } = await import('../dist/esm/app/jog-hint.js');
    resetApp();
    appState.currentView = VIEW_CHAIN;
    jogHintTouch(false);

    const realNow = Date.now; let t = 20000; Date.now = () => t;
    sendMidi([0x90, 9, 127]);              // jog touch on
    advance(1);
    eq('no hint on touch', jogHintVisible(), false);
    t = 20500; advance(1);
    eq('no hint mid-hold', jogHintVisible(), false);
    t = 21100; advance(1);                 // > HOLD_MS
    eq('hint after the hold', jogHintVisible(), true);

    sendMidi([0xB0, 14, 1]);               // jog turn
    advance(1);
    eq('turn removes the hint', jogHintVisible(), false);

    // Touch → turn → keep resting: the turn already answered the question.
    t = 30000; sendMidi([0x90, 9, 127]);
    sendMidi([0xB0, 14, 1]);
    t = 31500; advance(1);
    eq('no hint after a turn, however long the hold', jogHintVisible(), false);

    sendMidi([0x90, 9, 0]);                // release
    Date.now = realNow;
}

_log('\napp-loop: root-view Back → Leave modal → Background parks');
{
    const { soundingCount } = await import('../dist/esm/keyboard/held-notes.js');
    const { leaveModalActive } = await import('../dist/esm/app/leave-modal.js');
    resetApp();
    appState.currentView = VIEW_CHAIN;           // root view
    sendMidi([0x90, PAD_KICK, 100]);             // hold a pad
    let suspended = 0;
    globalThis.host_suspend_overtake = () => { suspended++; };
    sendMidi([0xB0, globalThis.MoveBack, 127]);  // Back → open modal (no instant park)
    eq('Back opened the Leave modal', leaveModalActive(), true);
    eq('opening the modal released the held pad', soundingCount(), 0);
    eq('Back did NOT park instantly', suspended, 0);
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);  // jog-click → Background (default)
    eq('jog-click Background parked movy', suspended, 1);
    eq('modal closed after confirm', leaveModalActive(), false);
    delete globalThis.host_suspend_overtake;
}

_log('\napp-loop: Leave modal — Back cancels; old host offers only Close Movy');
{
    const { leaveModalActive, leaveModalLabels } = await import('../dist/esm/app/leave-modal.js');
    resetApp();
    appState.currentView = VIEW_CHAIN;
    globalThis.host_suspend_overtake = () => {};
    sendMidi([0xB0, globalThis.MoveBack, 127]);       // open
    eq('modal offers Background + Close', leaveModalLabels().join(','), 'Background,Close Movy');
    sendMidi([0xB0, globalThis.MoveBack, 127]);       // Back again → cancel
    eq('second Back cancels the modal', leaveModalActive(), false);
    // Old host: no host_suspend_overtake → only Close Movy → jog-click exits.
    let exited = 0;
    const realExit = globalThis.host_exit_module;
    globalThis.host_exit_module = () => { exited++; };
    delete globalThis.host_suspend_overtake;
    sendMidi([0xB0, globalThis.MoveBack, 127]);       // open (Close only)
    eq('old host: modal offers only Close Movy', leaveModalLabels().join(','), 'Close Movy');
    sendMidi([0xB0, globalThis.MoveMainButton, 127]); // jog-click → Close
    eq('old host: jog-click closes movy', exited, 1);
    globalThis.host_exit_module = realExit;
}

_log('\napp-loop: parked tick does no LED work, keeps engine synced');
{
    const { uiTick } = await import('../dist/esm/seq/engine.js');
    resetApp();
    advance(4);                                   // let LEDs settle
    let ledWrites = 0, fillRects = 0;
    const realSetLED = globalThis.setLED;
    const realFillRect = globalThis.fill_rect;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    globalThis.fill_rect = (...a) => { fillRects++; if (realFillRect) realFillRect(...a); };
    const beforeUi = uiTick();
    globalThis.overtakeParked = true;
    advance(8);
    eq('parked: zero LED writes', ledWrites, 0);
    eq('parked: zero fill_rect (no render)', fillRects, 0);   // perf: parked path skips the draw pipeline
    eq('parked: engine still ticked (uiTick advanced)', uiTick() - beforeUi, 8);
    globalThis.overtakeParked = false;
    globalThis.setLED = realSetLED;
    globalThis.fill_rect = realFillRect;
}

_log('\napp-loop: onResume invalidates caches and repaints');
{
    resetApp();
    advance(6);
    globalThis.overtakeParked = true;             // park, advance blind
    advance(8);
    globalThis.overtakeParked = false;
    let ledWrites = 0;
    const realSetLED = globalThis.setLED;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    globalThis.onResume();
    eq('onResume set dirty', appState.dirty, true);
    eq('onResume reset init-LEDs flag', appState.initLedsDone, false);
    advance(3);
    if (ledWrites > 0) ok('resume repainted LEDs');
    else fail('resume repainted LEDs', 'no LED writes after resume');
    globalThis.setLED = realSetLED;
}

_log('\napp-loop: LINK toggle routes through knob 2 on the Set page');
{
    const { mainPageActive } = await import('../dist/esm/seq/main-page.js');
    resetApp();
    eq('link off initially', seqState.linkEnabled, false);
    // Open the Set page: Shift + Step 5 (step-button index 4 = note 20).
    appState.shiftHeld = true;
    sendMidi([0x90, 20, 100]);          // Step 5 press → opens Main Params (page 0)
    sendMidi([0x80, 20, 0]);
    appState.shiftHeld = false;
    eq('Set page open', mainPageActive(), true);
    // Regression: the knob-dispatch gate must span the whole page, or cells
    // are dead on device. Clockwise → LINK on (LINK is knob 2 = CC 73).
    sendMidi([0xB0, 73, 40]); advance(1);
    eq('knob 2 CW enables link', seqState.linkEnabled, true);
    sendMidi([0xB0, 73, 88]); advance(1);   // counter-clockwise → LINK off
    eq('knob 2 CCW disables link', seqState.linkEnabled, false);
}

/* Note conservation: every note-on movy sends must be answered by a note-off on
 * the SAME channel by the end of a scenario. This is the assertion that catches
 * leak paths nobody enumerated — it does not care which transition stranded the
 * note, only that one did. */
function makeNoteLedgerProbe() {
    const open = new Map();   // `${ch}:${pitch}` → count
    const orig = globalThis.shadow_send_midi_to_dsp;
    globalThis.shadow_send_midi_to_dsp = (msg) => {
        const [status, d1, d2] = msg;
        const kind = status & 0xF0, ch = status & 0x0F, key = `${ch}:${d1}`;
        if (kind === 0x90 && d2 > 0) open.set(key, (open.get(key) ?? 0) + 1);
        else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
            const n = (open.get(key) ?? 0) - 1;
            if (n > 0) open.set(key, n); else open.delete(key);
        }
        if (typeof orig === 'function') orig(msg);
    };
    return {
        stranded: () => [...open.keys()],
        restore:  () => { globalThis.shadow_send_midi_to_dsp = orig; },
    };
}

_log('\napp-loop: note conservation across context changes');
{
    /* Hold a pad, switch tracks, release: the note must not outlive the switch. */
    resetApp();
    let probe = makeNoteLedgerProbe();
    sendMidi([0x90, PAD_KICK, 100]);                     // pad down on track 1 (slot 0)
    sendMidi([0xB0, 42, 127]); sendMidi([0xB0, 42, 0]);  // → track 2 (slot 1)
    // Cut on switch: the note is already released before the pad comes up. The
    // ledger alone would route the eventual off to the right channel anyway, so
    // conservation cannot see this — only the timing can.
    eq('track switch cut the note immediately', probe.stranded().join(','), '');
    sendMidi([0x80, PAD_KICK, 0]);                       // pad up, now on another track
    eq('no note stranded by a track switch', probe.stranded().join(','), '');
    probe.restore();

    /* Hold a pad, enter Session mode (which swallows pad note-offs), release. */
    resetApp();
    probe = makeNoteLedgerProbe();
    sendMidi([0x90, PAD_KICK, 100]);
    sendMidi([0xB0, CC_NOTE_SESSION, 127]);              // Note/Session button down
    sendMidi([0x80, PAD_KICK, 0]);
    eq('no note stranded by Session entry', probe.stranded().join(','), '');
    probe.restore();

    /* Hold a pad and close movy: teardown must release it. */
    resetApp();
    probe = makeNoteLedgerProbe();
    sendMidi([0x90, PAD_KICK, 100]);
    globalThis.onUnload();
    eq('no note stranded by teardown', probe.stranded().join(','), '');
    probe.restore();
}

/* Closing movy must persist. The autosave runs every ~3 s, so without a flush
 * on teardown every exit silently discarded whatever was done since the last
 * one — the "I left Movy, went back in, and the set is gone" report. */
_log('\napp-loop: teardown flushes pending state');
{
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const ACTIVE = '/data/UserData/schwung/active_set.txt';
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';

    fs[ACTIVE] = 'u1-uuid\nUnload Set\n';
    resetSeqPersist();
    resetApp();
    advance(4);                                   // boot-load resolves the set

    // An edit lands and movy closes well inside the ~3 s autosave interval.
    engine.stateBlob = 'movy1\nbpm 15500\ncl 0 0 16 0 0:24:64:100\n';
    globalThis.onUnload();
    eq('teardown wrote the set', typeof fs[stPath('u1-uuid')], 'string');
    eq('teardown kept the edit', fs[stPath('u1-uuid')].includes('bpm 15500'), true);
}

/* ── shift+jog skips a whole level through the real router ───────────────── */

_log('\napp-loop: shift+jog skips a level\'s overflow pages');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.hier_params_overflow_two_levels);
    resetSeqState();
    resetSeqEngine();
    globalThis.init();
    const m = appState.trackModels[0][1];
    m.reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;

    eq('shift+jog: 3 pages (Main, Main - 2, Effects)', m.getBankCount(), 3);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);        // plain jog CW
    advance(1);
    eq('shift+jog: plain jog steps one page', m.getKnobPage(), 1);

    sendMidi([0xB0, globalThis.MoveShift, 127]);         // Shift down
    sendMidi([0xB0, globalThis.MoveMainKnob, 127]);      // jog CCW (decodeDelta → -1)
    advance(1);
    eq('shift+jog: back jumps to the level head', m.getKnobPage(), 0);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);        // jog CW, still shifted
    advance(1);
    eq('shift+jog: forward skips the overflow page', m.getKnobPage(), 2);
    sendMidi([0xB0, globalThis.MoveShift, 0]);           // Shift up
}

/* ── a lost button release must not wedge the knobs ──────────────────────── */

_log('\napp-loop: a dropped step release never strands the hold');
{
    /* Field report (Discord, 2026-08-02): after a while of ordinary use the
     * knobs stop editing anything movy owns — tempo, clip length, step length —
     * until movy is closed and reopened. Cause: a step-button release that never
     * arrives leaves heldRanges holding a phantom, which keeps stepAutoMode
     * latched, which routes every knob turn into step automation forever. Three
     * ways in, three ways out. */
    const holdStep = (btn) => {
        sendMidi([0x90, STEP_NOTE_BASE + btn, 127]);
        const t0 = Date.now(); while (Date.now() - t0 < STEP_AUTO_MS + 60) { /* wall-clock hold */ }
        advance(4);
    };
    const openMainParams = () => {
        sendMidi([0xB0, globalThis.MoveShift, 127]);
        sendMidi([0x90, STEP_NOTE_BASE + 4, 127]);   // Shift+Step 5
        sendMidi([0x90, STEP_NOTE_BASE + 4, 0]);
        sendMidi([0xB0, globalThis.MoveShift, 0]);
        advance(2);
    };
    const tempoTurns = () => {
        const before = seqState.bpmX100;
        for (let i = 0; i < 12; i++) sendMidi([0xB0, globalThis.MoveKnob1, 4]);
        advance(4);
        return seqState.bpmX100 - before;
    };

    // (1) The Leave-Movy modal used to swallow the release outright.
    resetApp();
    sendMidi([0x90, STEP_NOTE_BASE, 127]); sendMidi([0x80, STEP_NOTE_BASE, 0]); advance(6);
    holdStep(0);
    eq('modal: hold promoted to step-automation', seqState.stepAutoMode, true);
    stepPageState.selected = true;
    appState.currentView = VIEW_CHAIN;
    sendMidi([0xB0, globalThis.MoveBack, 127]);          // → Leave-Movy modal
    eq('modal: is up', leaveModalActive(), true);
    sendMidi([0x80, STEP_NOTE_BASE, 0]);                 // release under the modal
    eq('modal: hold forgotten', anyStepHeld(), false);
    eq('modal: step-automation ended', seqState.stepAutoMode, false);
    sendMidi([0xB0, globalThis.MoveBack, 127]);          // cancel
    advance(4);
    openMainParams();
    eq('modal: tempo knob still edits tempo', tempoTurns() > 0, true);

    // (2) The host drops the release outright (its input callback was blocked by
    //     a synchronous module scan). heldRanges is keyed by button, so the next
    //     press of THAT step re-registers it — but the stale `gestured` mark
    //     survived, and it is what says "this release was not a tap". The step
    //     then silently refused to enter a note until pressed twice.
    resetApp();
    holdStep(0);                                          // promoted → marked gestured
    eq('dropped: hold registered', anyStepHeld(), true);
    eq('dropped: a promoted hold enters no note', occHasStep(0), false);
    /* release never arrives */
    sendMidi([0x90, STEP_NOTE_BASE, 127]);                // press again
    sendMidi([0x80, STEP_NOTE_BASE, 0]);                  // …and tap out of it
    advance(2);
    eq('dropped: the hold is gone', anyStepHeld(), false);
    eq('dropped: step-automation ended', seqState.stepAutoMode, false);
    eq('dropped: the tap still enters its note', occHasStep(0), true);

    // (3) Even while a step really is held, the page on screen owns its knobs.
    resetApp();
    sendMidi([0x90, STEP_NOTE_BASE, 127]); sendMidi([0x80, STEP_NOTE_BASE, 0]); advance(6);
    openMainParams();
    holdStep(0);
    stepPageState.selected = true;
    eq('page priority: Main Params is on screen', mainPageActive(), true);
    eq('page priority: tempo knob reaches the page', tempoTurns() > 0, true);
    sendMidi([0x80, STEP_NOTE_BASE, 0]);
    advance(2);
}

_log('\napp-loop: step recording paints a blinking red head');
{
    resetApp();
    const { C_REC_RED } = await import('../dist/esm/seq/colors.js');
    const { stepRecActive } = await import('../dist/esm/seq/step-rec.js');

    seqState.playing = false;
    seqState.lenSteps = 16;
    /* The engine's master tick does NOT advance while the transport is stopped
     * (seq-core returns before incrementing it) and is only reset on play — so
     * for a stopped-only mode like step recording it is a FROZEN number,
     * whatever the last stop left. Pin it inside an odd 24-tick block: the
     * value that used to leave the head permanently black. */
    seqState.engineTick = 24;

    const realNow = Date.now;
    let t = 500000;
    Date.now = () => t;
    const head = () => ledByPad[STEP_NOTE_BASE + 0];

    sendMidi([0xB0, 86, 127]);                 // hold Rec
    advance(3);
    eq('step recording entered from a real Rec press', stepRecActive(), true);
    eq('head lit red despite the frozen engine tick', head(), C_REC_RED);

    t += 250;
    advance(1);
    eq('head dark on the other half of the blink', head() !== C_REC_RED, true);

    t += 250;
    advance(1);
    eq('head red again — it really blinks', head(), C_REC_RED);

    /* Move the head with a rest and confirm the red follows it. */
    sendMidi([0xB0, 63, 127]);                 // Right = rest
    sendMidi([0xB0, 63, 0]);
    advance(2);
    eq('the red head followed the rest', ledByPad[STEP_NOTE_BASE + 1], C_REC_RED);

    sendMidi([0xB0, 86, 0]);                   // release Rec
    advance(2);
    eq('mode left on release', stepRecActive(), false);
    Date.now = realNow;
    seqState.lenSteps = 0;
    seqState.engineTick = 0;
}

_log('\napp-loop: step recording advertises the arrows it can act on');
{
    resetApp();
    const { WHITE_BRIGHT, WHITE_DIM, WHITE_OFF } = await import('../dist/esm/seq/colors.js');
    const CC_LEFT = 62, CC_RIGHT = 63;

    seqState.playing = false;
    seqState.lenSteps = 16;
    seqState.engineTick = 24;            // frozen, as it is whenever stopped

    const realNow = Date.now;
    let t = 500000;                      // even 250 ms block → bright half
    Date.now = () => t;

    sendMidi([0xB0, 86, 127]);           // hold Rec → head on step 1
    advance(3);
    eq('Right advertises itself — always pressable (rest / tie)',
        buttonLeds[CC_RIGHT], WHITE_BRIGHT);
    eq('Left is dark on the first step — nothing to step back to',
        buttonLeds[CC_LEFT], WHITE_OFF);

    t += 250;
    advance(1);
    eq('Right blinks rather than sitting lit', buttonLeds[CC_RIGHT], WHITE_DIM);
    eq('Left stays dark through the blink', buttonLeds[CC_LEFT], WHITE_OFF);

    t += 250;
    sendMidi([0xB0, 63, 127]);           // Right = rest → head on step 2
    sendMidi([0xB0, 63, 0]);
    advance(2);
    eq('Left lights once there is a step to go back to',
        buttonLeds[CC_LEFT], WHITE_BRIGHT);

    t += 250;
    advance(1);
    eq('Left blinks too', buttonLeds[CC_LEFT], WHITE_DIM);

    sendMidi([0xB0, 86, 0]);             // release Rec
    advance(2);
    Date.now = realNow;
    seqState.lenSteps = 0;
    seqState.engineTick = 0;
}

_log('\napp-loop: loop-mode content bars blink while the transport is stopped');
{
    resetApp();
    const { occToggleStep } = await import('../dist/esm/seq/state.js');
    const { trackColor, C_BLACK } = await import('../dist/esm/seq/colors.js');
    const CC_LOOP = 58;

    seqState.playing = false;
    seqState.lenSteps = 32;
    seqState.engineTick = 24;            // frozen in an odd block, as when stopped
    occToggleStep(16);                   // content in bar 2 (bar 1 is the selected one)

    const realNow = Date.now;
    let t = 500000;
    Date.now = () => t;

    sendMidi([0xB0, CC_LOOP, 127]); sendMidi([0xB0, CC_LOOP, 0]);   // tap → Loop mode
    advance(3);
    eq('loop mode entered', seqState.loopMode, true);
    eq('a content bar lights even with the engine tick frozen',
        ledByPad[STEP_NOTE_BASE + 1], trackColor(seqState.watchTrack));

    t += 250;
    advance(1);
    eq('and it really blinks', ledByPad[STEP_NOTE_BASE + 1], C_BLACK);

    sendMidi([0xB0, CC_LOOP, 127]); sendMidi([0xB0, CC_LOOP, 0]);   // back to Note mode
    advance(2);
    Date.now = realNow;
    seqState.lenSteps = 0;
    seqState.engineTick = 0;
}

_log('\napp-loop: Clear + drum pad wipes that pad from the clip');
{
    resetApp();
    const CC_DELETE = 119;
    const PAD_OFF_GRID = 72;   // col 4 — outside mrdrums' 4x4 grid, sounds nothing

    seqState.lenSteps = 16;
    engine.reset();

    sendMidi([0xB0, CC_DELETE, 127]);        // hold Clear
    sendMidi([0x90, PAD_KICK, 110]);         // + the kick pad
    sendMidi([0x80, PAD_KICK, 0]);
    advance(3);
    eq('every note of that pad is cleared, whole clip',
        engine.ops.includes(`del 0 0 255 ${NOTE_KICK}`), true);
    sendMidi([0xB0, CC_DELETE, 0]);          // release
    advance(2);
    eq('the pad gesture suppresses the clip delete on release',
        engine.ops.some((o) => o.startsWith('clipdel')), false);

    /* A pad that is not part of the drum grid sounds nothing, so it must clear
     * nothing. It used to delete whatever pitch was played LAST — silent, and
     * destructive to a lane the user never touched in the gesture. */
    sendMidi([0x90, PAD_KICK, 110]);         // establish a last-played pitch
    sendMidi([0x80, PAD_KICK, 0]);
    advance(2);
    engine.reset();
    sendMidi([0xB0, CC_DELETE, 127]);
    sendMidi([0x90, PAD_OFF_GRID, 110]);
    sendMidi([0x80, PAD_OFF_GRID, 0]);
    advance(3);
    eq('a pad outside the grid clears nothing',
        engine.ops.some((o) => o.startsWith('del ')), false);
    sendMidi([0xB0, CC_DELETE, 0]);
    advance(2);
    seqState.lenSteps = 0;
}


/* ── Undo: the guard, and the round trip ─────────────────────────────────── */

_log('\napp-loop: no edit escapes undo');
{
    const { takeUndoViolation } = await import('../dist/esm/undo/record.js');
    const { resetUndoState, canUndo, undoDepth } = await import('../dist/esm/undo/state.js');
    const { resetUndoGroups } = await import('../dist/esm/undo/group.js');
    const { undoOnce, redoOnce, resetUndoApply } = await import('../dist/esm/undo/apply.js');

    const CC_DEL = 119, CC_MUTE_B = 88, CC_LOOP_B = 58, CC_COPY_B = 60;
    const CC_VOL = 79, CC_SHIFT = 49, CC_UNDO_B = 56, CC_TRACK0 = 43;

    resetUndoState(); resetUndoGroups(); resetUndoApply();
    seqState.lenSteps = 16;
    takeUndoViolation();

    /* Every gesture that mutates the set, driven through the real router. A
     * violation here means an edit was made that no undo entry would record —
     * which is exactly the bug this whole guard exists to prevent, and the one
     * a future feature is most likely to reintroduce. */
    const gestures = {
        'step tap': () => { sendMidi([0x90, STEP_NOTE_BASE, 127]); sendMidi([0x80, STEP_NOTE_BASE, 0]); },
        'delete + step': () => {
            sendMidi([0xB0, CC_DEL, 127]); sendMidi([0x90, STEP_NOTE_BASE + 2, 127]);
            sendMidi([0xB0, CC_DEL, 0]);
        },
        'mute': () => {
            sendMidi([0xB0, CC_MUTE_B, 127]); sendMidi([0xB0, CC_TRACK0, 127]);
            sendMidi([0xB0, CC_TRACK0, 0]); sendMidi([0xB0, CC_MUTE_B, 0]);
        },
        'loop window': () => {
            sendMidi([0xB0, CC_LOOP_B, 127]); sendMidi([0x90, STEP_NOTE_BASE + 1, 127]);
            sendMidi([0x80, STEP_NOTE_BASE + 1, 0]); sendMidi([0xB0, CC_LOOP_B, 0]);
        },
        'held step + velocity': () => {
            sendMidi([0x90, STEP_NOTE_BASE + 3, 127]); sendMidi([0xB0, CC_VOL, 1]);
            sendMidi([0x80, STEP_NOTE_BASE + 3, 0]);
        },
        'copy then paste': () => {
            sendMidi([0xB0, CC_COPY_B, 127]); sendMidi([0x90, STEP_NOTE_BASE, 127]);
            sendMidi([0x90, STEP_NOTE_BASE + 5, 127]); sendMidi([0xB0, CC_COPY_B, 0]);
        },
        /* Step recording — hold Rec while stopped, then pads and arrows. A
         * device run found this whole path un-grouped; the local table had no
         * row for it. */
        'step record: pad at head': () => {
            sendMidi([0xB0, 86, 127]);              // Rec down (hold = step rec)
            advance(2);
            sendMidi([0x90, 68, 110]); sendMidi([0x80, 68, 0]);
            advance(2);
        },
        'step record: tie': () => { sendMidi([0xB0, 63, 127]); sendMidi([0xB0, 63, 0]); },
        'step record: step tap': () => {
            sendMidi([0x90, STEP_NOTE_BASE + 4, 127]);
            sendMidi([0x80, STEP_NOTE_BASE + 4, 0]);
        },
        'step record: end': () => { sendMidi([0xB0, 86, 0]); advance(2); },
        'quantize': () => {
            sendMidi([0xB0, CC_SHIFT, 127]); sendMidi([0x90, STEP_NOTE_BASE + 15, 127]);
            sendMidi([0x80, STEP_NOTE_BASE + 15, 0]); sendMidi([0xB0, CC_SHIFT, 0]);
        },
    };
    for (const [name, run] of Object.entries(gestures)) {
        run();
        advance(2);
        eq(name + ' is recorded', takeUndoViolation(), '');
    }

    /* The quantize panel's input policy, through the real router: Back closes
     * it and is consumed, while a step press runs underneath without even
     * closing it (a step neither repaints the screen nor toasts). */
    {
        const { quantOverlayActive } =
            await import('../dist/esm/seq/quant-overlay.js');
        sendMidi([0xB0, CC_SHIFT, 127]); sendMidi([0x90, STEP_NOTE_BASE + 15, 127]);
        sendMidi([0x80, STEP_NOTE_BASE + 15, 0]); sendMidi([0xB0, CC_SHIFT, 0]);
        advance(1);
        eq('Shift+Step16 raises the quantize panel', quantOverlayActive(), true);

        engine.ops.length = 0;
        sendMidi([0x90, STEP_NOTE_BASE + 6, 127]); sendMidi([0x80, STEP_NOTE_BASE + 6, 0]);
        advance(2);
        /* `ltog` not `tog`: the surrounding section leaves loop mode on. Either
         * way the press reached the sequencer instead of being swallowed. */
        eq('a step press runs underneath the panel',
            engine.ops.some((o) => /^(tog|ltog)\b/.test(o)), true);
        eq('and leaves it up', quantOverlayActive(), true);

        sendMidi([0xB0, 51, 127]);   // MoveBack
        advance(1);
        eq('Back closes the panel', quantOverlayActive(), false);
    }

    /* The button itself, through the router. */
    resetUndoState(); resetUndoGroups();
    sendMidi([0x90, STEP_NOTE_BASE + 7, 127]); sendMidi([0x80, STEP_NOTE_BASE + 7, 0]);
    advance(2);
    eq('a step tap leaves something to undo', canUndo(), true);
    const before = undoDepth();
    sendMidi([0xB0, CC_UNDO_B, 127]); sendMidi([0xB0, CC_UNDO_B, 0]);
    advance(2);
    eq('Undo consumes an entry', undoDepth(), before - 1);
    engine.ops.length = 0;
    sendMidi([0xB0, CC_SHIFT, 127]);
    sendMidi([0xB0, CC_UNDO_B, 127]); sendMidi([0xB0, CC_UNDO_B, 0]);
    sendMidi([0xB0, CC_SHIFT, 0]);
    advance(2);
    eq('Shift+Undo redoes', undoDepth(), before);
    eq('and reaches the engine', engine.ops.some((o) => o.startsWith('uswap ')), true);

    resetUndoState(); resetUndoGroups(); resetUndoApply();
    seqState.lenSteps = 0;
}

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log = _origLog;
if (failures === 0) _log('\n\x1b[32m\x1b[1mALL APP-LOOP CHECKS PASSED\x1b[0m');
else { _log(`\n\x1b[31m\x1b[1m${failures} APP-LOOP CHECK(S) FAILED\x1b[0m`); process.exit(1); }
