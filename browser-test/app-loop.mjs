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
const { appState, VIEW_KNOBS, VIEW_FILE_BROWSE } = await import('../dist/esm/app/state.js');
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
    const rootBefore = keyboardState.rootNote;
    for (const k of Object.keys(buttonLeds)) delete buttonLeds[k];
    sendMidi([0xB0, 55, 127]); // MoveUp press
    advance(1);
    eq('drum track: MoveUp does not shift root', keyboardState.rootNote, rootBefore);
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

    const rootBefore = keyboardState.rootNote;
    for (const k of Object.keys(buttonLeds)) delete buttonLeds[k];

    sendMidi([0xB0, 55, 127]); // MoveUp press
    advance(1);
    eq('melodic: MoveUp shifts root +12', keyboardState.rootNote, rootBefore + 12);
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
    sendMidi([0xB0, 14, 1]); sendMidi([0xB0, 14, 1]); advance(1);  // → Preset page
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

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log = _origLog;
if (failures === 0) _log('\n\x1b[32m\x1b[1mALL APP-LOOP CHECKS PASSED\x1b[0m');
else { _log(`\n\x1b[31m\x1b[1m${failures} APP-LOOP CHECK(S) FAILED\x1b[0m`); process.exit(1); }
