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

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log = _origLog;
if (failures === 0) _log('\n\x1b[32m\x1b[1mALL APP-LOOP CHECKS PASSED\x1b[0m');
else { _log(`\n\x1b[31m\x1b[1m${failures} APP-LOOP CHECK(S) FAILED\x1b[0m`); process.exit(1); }
