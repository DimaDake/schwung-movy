#!/usr/bin/env node
/* browser-test/logic.mjs — pure viewmodel/logic tests, no device or screenshots.
 *
 * Tests business invariants on the model and viewmodel layer.
 * Run from movy root: node browser-test/logic.mjs
 */

import { createModel }    from '../dist/esm/model/index.js';
import { MOCK_SYNTHS }    from './mock-synth.mjs';
import { drumPadOn, drumPadOff } from '../dist/esm/keyboard/drum-handler.js';
import { ENGINE_VERSION } from '../dist/esm/seq/constants.js';
import { installEnv } from './env.mjs';

/* ── Mock globals ─────────────────────────────────────────────────────────── */

const env = installEnv();

let mockFsEntries = {};  // path → string[] of filenames

globalThis.os = {
    readdir: (path) => [mockFsEntries[path] ?? [], 0],
    stat:    (path) => {
        // treat paths without an extension as directories
        const mode = path.lastIndexOf('.') > path.lastIndexOf('/') ? 0x8000 : 0x4000;
        return [{ mode }, 0];
    },
};

const _log = console.log.bind(console);
console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[movy]')) return;
    _log(...args);
};

let failures = 0;

function ok(label)        { _log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label, why) { _log(`  \x1b[31m✗\x1b[0m ${label}: ${why}`); failures++; }

function eq(label, actual, expected) {
    if (actual === expected) ok(label);
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function notMatch(label, str, pattern) {
    if (!pattern.test(str)) ok(label);
    else fail(label, `'${str}' should not match ${pattern}`);
}

function bootModel(preset, slot = 0, componentKey = 'synth') {
    env.setParams(preset);
    const m = createModel(slot, componentKey);
    m.reload();  // sets pollCountdown=1 so pollModuleName fires on next tick
    m.tick();    // tick 1: polls name, resets hierarchyKey
    m.tick();    // tick 2: reloads hierarchy with the real module name
    return m;
}

/* ── vm.moduleName is raw name — no track prefix ─────────────────────────── */

_log('\nTest: vm.moduleName is raw module name (no track prefix)');

for (const [name, preset] of [
    ['Test 8',  MOCK_SYNTHS.test8    ],
    ['Plaits',  MOCK_SYNTHS.plaits   ],
    ['OB-Xd',  MOCK_SYNTHS.obxd_like],
    ['Wurl',   MOCK_SYNTHS.wurl     ],
]) {
    const vm = bootModel(preset).getViewModel();
    eq(`${name}: vm.moduleName`, vm.moduleName, name);
    notMatch(`${name}: no T> prefix`, vm.moduleName, /^T\d+ > /);
}

/* ── moduleName is slot-independent ─────────────────────────────────────── */

_log('\nTest: vm.moduleName does not vary by activeSlot');

for (const slot of [0, 1, 2, 3]) {
    const vm = bootModel(MOCK_SYNTHS.test8, slot).getViewModel();
    eq(`slot ${slot}: moduleName = 'Test 8'`, vm.moduleName, 'Test 8');
}

/* ── bank structure ───────────────────────────────────────────────────────── */

_log('\nTest: bankCount and bankName');

{
    const vm = bootModel(MOCK_SYNTHS.test8).getViewModel();
    eq('test8: bankCount = 1', vm.bankCount, 1);
    eq('test8: bankName empty (single bank)', vm.bankName, '');
}

{
    const vm = bootModel(MOCK_SYNTHS.obxd_like).getViewModel();
    eq('obxd: bankCount = 4 (preset + main + global + filter)', vm.bankCount, 4);
    eq('obxd: first bankName = Preset', vm.bankName, 'Preset');
}

/* ── nav-only level expansion ─────────────────────────────────────────────── */

_log('\nTest: navigation-only levels expand recursively');

{
    const m = bootModel(MOCK_SYNTHS.nav_levels);
    eq('nav_levels: bankCount = 4', m.getViewModel().bankCount, 4);

    const names = [];
    for (let i = 0; i < 4; i++) {
        if (i > 0) m.changePage(1);
        names.push(m.getViewModel().bankName);
    }
    eq('nav_levels: bank 0 = Main',       names[0], 'Main');
    eq('nav_levels: bank 1 = Main',       names[1], 'Main');
    eq('nav_levels: bank 2 = Mod/Pitch',  names[2], 'Mod/Pitch');
    eq('nav_levels: bank 3 = Mod/Filter', names[3], 'Mod/Filter');
    eq('nav_levels: no bare Mod bank',    names.includes('Mod'), false);

    // page 2 (Mod/Pitch) should expose 3 params
    m.changePage(-1);
    eq('nav_levels: Mod/Pitch has 3 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 3);
}

/* ── moog: generic children-delegation hierarchy → 12 banks ─────────────── */

_log('\nTest: moog hierarchy via children delegation (generic path)');

{
    const m = bootModel(MOCK_SYNTHS.moog);
    const bankNames = [];
    for (let i = 0; i < 12; i++) {
        if (i > 0) m.changePage(1);
        bankNames.push(m.getViewModel().bankName);
    }
    eq('moog: bankCount = 12', m.getViewModel().bankCount, 12);
    eq('moog: bank 0  = Preset',       bankNames[0],  'Preset');
    eq('moog: bank 1  = Main',         bankNames[1],  'Main');
    eq('moog: bank 2  = Oscillator 1', bankNames[2],  'Oscillator 1');
    eq('moog: bank 6  = Mixer',        bankNames[6],  'Mixer');
    eq('moog: bank 11 = Performance',  bankNames[11], 'Performance');

    // Osc banks (2-5): row[0] = [wave, volume, range, detune/noise]; wave+range are int
    m.changePage(-11); // back to bank 0
    for (let bank = 0; bank < 12; bank++) {
        if (bank > 0) m.changePage(1);
        if (bank < 2 || bank > 5) continue;
        const oscNum = bank - 1;
        const vm2  = m.getViewModel();
        const wave  = vm2.rows[0][0];
        const range = vm2.rows[0][2];
        if (!wave)  { fail(`moog: Osc ${oscNum} wave slot non-null`,  'null'); continue; }
        if (!range) { fail(`moog: Osc ${oscNum} range slot non-null`, 'null'); continue; }
        eq(`moog: Osc ${oscNum} wave type = int`,  wave.type,  'int');
        eq(`moog: Osc ${oscNum} range type = int`, range.type, 'int');
    }

    // Main bank (bank 1): 8 non-null params
    m.changePage(-11);
    m.changePage(1);
    eq('moog: Main bank has 8 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 8);

    // osc1_range min=-2 max=2 via chain_params
    const moogRange = bootModel({ ...MOCK_SYNTHS.moog, 'synth:osc1_range': '-2' });
    for (let i = 0; i < 60; i++) moogRange.tick();
    moogRange.changePage(2); // bank 0 → bank 2 = Oscillator 1
    {
        const rangeSlot = moogRange.getViewModel().rows[0][2];
        if (!rangeSlot) { fail('moog: osc1_range slot exists', 'null'); }
        else {
            eq('moog: osc1_range displayValue for -2', rangeSlot.displayValue, '-2');
            const expectedNv = ((-2) - (-2)) / (2 - (-2)); // 0
            eq('moog: osc1_range normalizedValue reflects min=-2',
                Math.round(rangeSlot.normalizedValue * 100), Math.round(expectedNv * 100));
        }
    }
}

/* ── isEmpty flag ─────────────────────────────────────────────────────────── */

_log('\nTest: vm.isEmpty');

eq('no_params: isEmpty = true',  bootModel(MOCK_SYNTHS.no_params).getViewModel().isEmpty, true);
eq('test8: isEmpty = false',     bootModel(MOCK_SYNTHS.test8).getViewModel().isEmpty,     false);

/* ── master FX module read key ─────────────────────────────────────────────
 * Track components expose the loaded module id via an underscore alias
 * (fx1_module); master FX has none and is read with its colon key
 * (master_fx:fx1:module). A wrong key here left an added master FX module
 * reading back empty ("click jog to add"). */
_log('\nTest: master FX module detection');
{
    const { moduleReadKey } = await import('../dist/esm/chain/config.js');
    eq('track module read key', moduleReadKey('fx1'), 'fx1_module');
    eq('master module read key', moduleReadKey('master_fx:fx1'), 'master_fx:fx1:module');

    // A master FX slot whose module id is set under the colon key is detected
    // as loaded (not empty) — the bug was the model reading the underscore key.
    const preset = {
        'master_fx:fx1:module':       'reverb',
        'master_fx:fx1:name':         'Reverb',
        'master_fx:fx1:ui_hierarchy': JSON.stringify({ levels: { root: { knobs: ['mix'] } } }),
        'master_fx:fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float', min: 0, max: 1 }]),
        'master_fx:fx1:mix':          '0.5',
    };
    const vm = bootModel(preset, 0, 'master_fx:fx1').getViewModel();
    eq('master FX module detected (not empty)', vm.isEmpty, false);
    eq('master FX module name', vm.moduleName, 'Reverb');
}

/* ── row params populated ─────────────────────────────────────────────────── */

_log('\nTest: vm.rows populated correctly');

{
    const vm = bootModel(MOCK_SYNTHS.test8).getViewModel();
    const nonNull = vm.rows.flat().filter(Boolean).length;
    eq('test8: 8 params in rows', nonNull, 8);
}

{
    const vm = bootModel(MOCK_SYNTHS.no_params).getViewModel();
    const nonNull = vm.rows.flat().filter(Boolean).length;
    eq('no_params: 0 params in rows', nonNull, 0);
}

/* ── granny-style: filepath in chain_params but absent from all knobs arrays ── */

_log('\nTest: filepath absent from knobs arrays is injected into Main page');

{
    const m = bootModel(MOCK_SYNTHS.granny_like);
    const vm = m.getViewModel();
    const first = vm.rows[0][0];
    eq('granny_like: first knob = sample_path (file)', first?.type, 'file');
    eq('granny_like: sample_path fullName = Sample File', first?.fullName, 'Sample File');
    eq('granny_like: position still present', vm.rows[0][1]?.fullName, 'Position');
}

/* ── file param detection ─────────────────────────────────────────────────── */

_log('\nTest: file param detected from chain_params type:filepath');

{
    const m = bootModel(MOCK_SYNTHS.file_param);
    const vm = m.getViewModel();
    const sampleKnob = vm.rows[0][0];
    eq('file_param: sample knob type = file', sampleKnob?.type, 'file');
    eq('file_param: vol knob type = float',   vm.rows[0][1]?.type, 'float');
}

/* ── file overlay behavior ────────────────────────────────────────────────── */

_log('\nTest: file overlay opens on touch with dir scan');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m  = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    const vm = m.getViewModel();
    eq('file overlay: 3 items',         vm.overlay?.options.length, 3);
    eq('file overlay: slot = 0',        vm.overlay?.slot, 0);
    eq('file overlay: selected = kick', vm.overlay?.options[vm.overlay.selected], 'kick.wav');
}

_log('\nTest: file overlay scrolls with knob delta');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, 4);  // ENUM_DELTA_DIV=4 → 1 step
    eq('file overlay: moved to snare', m.getViewModel().overlay?.selected, 2);
    m.handleKnobDelta(0, -4);
    eq('file overlay: moved back to kick', m.getViewModel().overlay?.selected, 1);
}

_log('\nTest: file overlay commits on release');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m = bootModel({ ...MOCK_SYNTHS.file_param });
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, 8);  // 2 steps: sorted hat[0],kick[1],snare[2]; kick→idx1+2=3 clamped→2=snare
    m.handleKnobRelease(0);
    eq('file overlay: committed to shadow', env.params['synth:sample'], '/data/UserData/Samples/snare.wav');
    eq('file overlay: dismissed',          m.getViewModel().overlay, null);
}

/* ── viewmodel: file display value and browseHint ─────────────────────────── */

_log('\nTest: file knob displayValue = basename of current path');

{
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    const vm = m.getViewModel();
    eq('file knob displayValue = kick.wav', vm.rows[0][0]?.displayValue, 'kick.wav');
}

_log('\nTest: browseHint = true when file param is primary touched slot');

{
    mockFsEntries['/data/UserData/Samples'] = ['kick.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    eq('toast.browseHint = true',   m.getViewModel().toast?.browseHint, true);
    eq('toast.fullName = Sample',   m.getViewModel().toast?.fullName, 'Sample');
}

_log('\nTest: browseHint = false for non-file param touch');

{
    const m = bootModel(MOCK_SYNTHS.test8);
    m.handleKnobTouch(0);
    eq('toast.browseHint = false for float', m.getViewModel().toast?.browseHint, false);
}

// ── Drum module detection ─────────────────────────────────────────────────

_log('\nTest: drum module detection via loadHierarchy');

{
  const mrdrumsPreset = {
    'synth:name': 'MrDrums',
    'synth_module': 'mrdrums',
    'synth:pad_vol': '0.8',
    'synth:ui_current_pad': '3',
  };

  const m = bootModel(mrdrumsPreset);
  const vm = m.getViewModel();
  eq('mrdrums: isDrum via drumPadCount', vm.drumPadCount, 16);
  eq('mrdrums: drumCurrentPad from param', vm.drumCurrentPad, 3);

  const krautPreset = {
    'synth:name': 'KrautDrums',
    'synth_module': 'krautdrums',
    'synth:lvl_bass': '0.85',
  };
  const mk = bootModel(krautPreset);
  const vmk = mk.getViewModel();
  eq('krautdrums: drumPadCount=16', vmk.drumPadCount, 16);
  eq('krautdrums: drumCurrentPad defaults to 1', vmk.drumCurrentPad, 1);

  const plaitsPreset = {
    'synth:name': 'Plaits',
    'synth_module': 'plaits',
  };
  const mp = bootModel(plaitsPreset);
  eq('plaits: not drum (drumPadCount=0)', mp.getViewModel().drumPadCount, 0);
}

// ── ViewModel drum fields: isPadSpecific, drumCurrentPad, drumPadCount ───

_log('\nTest: ViewModel drum fields');

{
  const mrdrumsPreset = {
    'synth:name': 'MrDrums',
    'synth_module': 'mrdrums',
    'synth:ui_current_pad': '5',
    'synth:pad_vol': '0.8',
  };
  const m = bootModel(mrdrumsPreset);

  // Main bank (index 0) has padSpecific=true
  const vm0 = m.getViewModel();
  eq('mrdrums Main bank isPadSpecific', vm0.isPadSpecific, true);
  eq('mrdrums drumCurrentPad', vm0.drumCurrentPad, 5);
  eq('mrdrums drumPadCount', vm0.drumPadCount, 16);

  // KrautDrums: all banks default to padSpecific=false
  const krautPreset = {
    'synth:name': 'KrautDrums',
    'synth_module': 'krautdrums',
    'synth:lvl_bass': '0.5',
  };
  const mk = bootModel(krautPreset);
  const vmk = mk.getViewModel();
  eq('krautdrums bank 0 isPadSpecific=false (default)', vmk.isPadSpecific, false);
  eq('krautdrums drumPadCount', vmk.drumPadCount, 16);

  // Navigate to a different bank and verify it's also not padSpecific
  mk.changePage(1);
  const vmk2 = mk.getViewModel();
  eq('krautdrums bank 1 isPadSpecific=false (default)', vmk2.isPadSpecific, false);

  // Non-drum module
  const plaitsPreset = { 'synth:name': 'Plaits', 'synth_module': 'plaits' };
  const mp = bootModel(plaitsPreset);
  eq('plaits isPadSpecific=false', mp.getViewModel().isPadSpecific, false);
  eq('plaits drumPadCount=0', mp.getViewModel().drumPadCount, 0);
}

/* ── drumPadOn / drumPadOff ──────────────────────────────────────────────── */

_log('\nTest: drumPadOn');

{
  let sentMidi = [];
  let setParams = {};
  const origSendMidi  = globalThis.shadow_send_midi_to_dsp;
  const origSetParam  = globalThis.shadow_set_param;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  globalThis.shadow_set_param = (_s, key, val) => { setParams[key] = val; return true; };

  const mrdCfg = { padCount: 16, padNoteStart: 36, rawMidi: false, currentPadParam: 'ui_current_pad' };

  // pad 68, rawMidi=false, rootNote=36: PAD_MAP[0]=0 → midiNote=36 → drumPad=1
  sentMidi = []; setParams = {};
  const r1 = drumPadOn(68, 68, false, mrdCfg, 36, 'synth', 0, 100);
  eq('mrdrums pad68 → drumPad 1', r1, 1);
  eq('sends NoteOn 36', sentMidi[0]?.[1], 36);
  eq('velocity 100', sentMidi[0]?.[2], 100);
  eq('sets ui_current_pad=1', setParams['synth:ui_current_pad'], '1');

  // pad 76: padIdx=8, col=0, row=1 → drumPad=5, midiNote=40
  sentMidi = []; setParams = {};
  const r2 = drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0, 100);
  eq('mrdrums pad76 → drumPad 5', r2, 5);
  eq('mrdrums pad76 → midiNote 40', sentMidi[0]?.[1], 40);

  // shift+pad (no shiftSelectMidi) → suppresses MIDI, still sets param
  sentMidi = []; setParams = {};
  const r3 = drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0, 100);
  eq('shift+pad returns drumPad 1', r3, 1);
  eq('shift: no MIDI sent', sentMidi.length, 0);
  eq('shift: still sets param', setParams['synth:ui_current_pad'], '1');

  // shiftSelectMidi=true (weird-dreams) → sends vel=1
  const wdCfg = { padCount: 8, padNoteStart: 36, rawMidi: false, shiftSelectMidi: true };
  sentMidi = [];
  drumPadOn(68, 68, true, wdCfg, 36, 'synth', 0, 100);
  eq('shiftSelectMidi: sends vel=1', sentMidi[0]?.[2], 1);

  // rawMidi=true (krautdrums): midiNote=physPad → drumPad=physPad-padNoteStart+1
  const kCfg = { padCount: 16, padNoteStart: 68, rawMidi: true };
  sentMidi = []; setParams = {};
  const r4 = drumPadOn(68, 68, false, kCfg, 36, 'synth', 0, 100);
  eq('krautdrums pad68 → drumPad 1', r4, 1);
  eq('rawMidi sends pad note 68', sentMidi[0]?.[1], 68);

  // rawMidi out-of-range: kCfg padCount=16, pad84=drumPad17
  sentMidi = [];
  const r5 = drumPadOn(84, 68, false, kCfg, 36, 'synth', 0, 100);
  eq('rawMidi out-of-range → null', r5, null);

  // right-half column (col=4, pad72): inactive for rawMidi=false
  sentMidi = [];
  const r6 = drumPadOn(72, 68, false, mrdCfg, 36, 'synth', 0, 100);
  eq('grid col>=4 → null', r6, null);
  eq('grid col>=4: no MIDI', sentMidi.length, 0);

  // Held tracking: a sounding pad registers in keyboardState.held so the drum
  // grid can light it green; release clears it. A shift-select makes no sound,
  // so it must not register as held.
  const { keyboardState } = await import('../dist/esm/keyboard/state.js');
  for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];
  drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0, 100);   // sounds midiNote 40
  eq('held pad tracked (phys→midi)', keyboardState.held[76], 40);
  drumPadOff(76, 68, mrdCfg, 36, 0);
  eq('held pad cleared on release', keyboardState.held[76], undefined);
  drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0, 100);     // shift-select, silent
  eq('shift-select not held', keyboardState.held[68], undefined);
  for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];

  globalThis.shadow_send_midi_to_dsp = origSendMidi;
  globalThis.shadow_set_param = origSetParam;
}

/* ── seq engine plumbing: cmd batching + status polling ──────────────────── */
{
    _log('\nseq engine plumbing:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqCmd, seqEngineTick, resetSeqEngine, engineAvailable } =
        await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState();

    eq('engine detected via host_module_* globals', engineAvailable(), true);
    seqEngineTick(); // boot probe: ping matches → engine ready
    seqEngineTick(); // first post-boot tick polls status

    eq('status poll marks engineOk', seqState.engineOk, true);
    eq('status play=0 parsed', seqState.playing, false);

    // Multiple queued ops must flush as ONE batched set_param (coalescing).
    seqCmd('watch 0');
    seqCmd('non 0 60 100');
    seqCmd('nof 0 60');
    seqEngineTick();
    eq('three ops → one set_param call', engine.cmdBatches.length, 1);
    eq('batch joins ops with ;', engine.cmdBatches[0], 'watch 0;non 0 60 100;nof 0 60');
    eq('ops parsed on engine side', engine.ops.length, 3);

    // No queued ops → no set_param traffic.
    const before = engine.setParamCalls;
    seqEngineTick();
    eq('idle tick sends no cmd', engine.setParamCalls, before);

    // Status changes propagate on the next poll cadence.
    engine.status.play = 1;
    engine.status.tick = 4321;
    engine.status.bpm = 13350;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('play state mirrored', seqState.playing, true);
    eq('engine tick mirrored', seqState.engineTick, 4321);
    eq('bpm mirrored', seqState.bpmX100, 13350);

    // Mock engine serializes arbitrary status keys so tests can inject act=.
    const { activeHasNote } = await import('../dist/esm/seq/state.js');
    engine.status.act = '38';            // track 0 pitch 38 sounding
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('injected act= populates activeNotes', activeHasNote(0, 38), true);
    delete engine.status.act;

    // Unknown status keys must be ignored (forward compat).
    engine.status.tick = 9;
    globalThis.host_module_get_param = (key) =>
        key === 'status' ? 'play=1 tick=9 bpm=13350 future_key=42' : null;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('unknown status key ignored', seqState.engineTick, 9);

    // Dead engine (all gets return null): the boot probe re-issues the DSP
    // load a bounded number of times, then gives up for the session.
    const dead = installMockEngine();
    let deadGets = 0;
    globalThis.host_module_get_param = () => { deadGets++; return null; };
    resetSeqEngine(); resetSeqState();
    const { engineReady } = await import('../dist/esm/seq/engine.js');
    for (let i = 0; i < 5000; i++) seqEngineTick();
    eq('dead engine: 3 load attempts', dead.loadRequests.length, 3);
    eq('dead engine: load path correct',
        dead.loadRequests[0], '/data/UserData/schwung/modules/tools/movy/dsp.so');
    eq('dead engine: gives up (not ready)', engineReady(), false);
    eq('dead engine: probing bounded', deadGets <= 40, true);
    eq('dead engine: engineOk stays false', seqState.engineOk, false);

    // Stale engine (wrong version pong): reload requested immediately.
    const e3 = installMockEngine();
    globalThis.host_module_get_param = (key) => (key === 'ping' ? 'pong 0.0.1' : null);
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    eq('stale engine: reload requested on first probe', e3.loadRequests.length, 1);
    e3.reset();

    // No engine at all: everything is a no-op.
    uninstallMockEngine();
    resetSeqEngine();
    seqCmd('play');
    seqEngineTick();
    eq('no engine: engineAvailable false', engineAvailable(), false);
}

/* ── automation: status fields parse into the mirror ─────────────────────── */
{
    _log('\nautomation status parse:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=0 trk=0 alanes=05 aauto=04 hauto=2:50');
    eq('autoAssigned parsed', seqState.autoAssigned, 0x05);
    eq('autoActive parsed', seqState.autoActive, 0x04);
    eq('heldLocks lane 2 = 50', seqState.heldLocks.get(2), 50);
    // Empty hauto clears the map.
    parseStatusForTest('play=0 trk=0 hauto=');
    eq('empty hauto clears heldLocks', seqState.heldLocks.size, 0);
}

/* ── seq router: step toggle, chords, drum lanes, bars, Play, watch ──────── */
{
    _log('\nseq router:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, seqSetLane, setMuteHeld } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');
    const { resetSeqToast, seqToastActive } = await import('../dist/esm/seq/render.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetSeqToast();
    seqEngineTick(); // boot probe → ready
    const lastOp = () => engine.ops[engine.ops.length - 1];
    /* A tap = press then release; the note toggle fires on release. */
    const tapStep = (button) => {
        seqHandleMidi([0x90, 16 + button, 127], false);
        seqHandleMidi([0x80, 16 + button, 0], false);
    };

    eq('pad note not claimed', seqHandleMidi([0x90, 68, 100], false), false);
    eq('knob CC not claimed', seqHandleMidi([0xB0, 71, 65], false), false);

    // Pad play (padNote 80 → midiNote 72) sets the step-entry pitch + holds it.
    seqNotePadPlayed(0, 80, 72, 110);
    eq('pad play recorded as step-entry pitch', seqState.lastPitch[0], 72);

    // Tap step while a pad is held → places that note; toggles on release.
    eq('step note claimed', seqHandleMidi([0x90, 16, 127], false), true);
    seqHandleMidi([0x80, 16, 0], false);
    eq('optimistic occ set', occHasStep(0), true);
    eq('optimistic clip created (1 bar)', seqState.lenSteps, 16);
    eq('step entry does not auto-start', seqState.playing, false);
    seqEngineTick();
    eq('tog cmd emitted', lastOp(), 'tog 0 0 72 110');

    // Two held pads → chord placed in one tog op.
    seqState.playing = false;
    seqNotePadPlayed(0, 81, 74, 100);   // held: 72 and 74
    tapStep(5);                          // step 5
    seqEngineTick();
    eq('chord tog emits both pitches', lastOp(), 'tog 0 5 72 100 74 100');

    // Releasing pads → next step uses the last-played note only.
    seqNotePadReleased(80); seqNotePadReleased(81);
    seqNotePadPlayed(0, 80, 67, 90);
    seqNotePadReleased(80);              // pad released before the step tap
    tapStep(1);                          // step 1
    seqEngineTick();
    eq('after release, single note placed', lastOp(), 'tog 0 1 67 90');

    // Drum-lane mode: seqSetLane(38) → wlane, and a step tap uses ltog.
    seqSetLane(38);
    seqEngineTick();
    eq('wlane cmd emitted', lastOp(), 'wlane 38');
    tapStep(0);
    seqEngineTick();
    eq('drum lane uses ltog', lastOp(), 'ltog 0 0 38 90');
    seqSetLane(-1);
    seqEngineTick();
    eq('melodic lane -1', lastOp(), 'wlane -1');

    // ── Multi-step entry ──────────────────────────────────────────────────
    // Melodic: hold step A + press step B is the length gesture (set A's note
    // length to span A→B), so B is NOT entered as a step.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 → length gesture
    seqHandleMidi([0x80, 16 + 3, 0], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    seqEngineTick();
    eq('melodic hold+press: B not entered', occHasStep(3), false);
    eq('melodic hold+press: emits slen', engine.ops.some((o) => o.startsWith('slen')), true);

    // Drum lane: hold step 0 + press step 3 enters BOTH (no length gesture) —
    // multiple steps can be entered while one is held.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    seqSetLane(38); seqEngineTick();
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 while step 0 held
    seqHandleMidi([0x80, 16 + 3, 0], false);     // release → step 3 toggles on
    seqHandleMidi([0x80, 16 + 0, 0], false);     // release → step 0 toggles on
    eq('drum multi: step 0 entered', occHasStep(0), true);
    eq('drum multi: step 3 entered', occHasStep(3), true);
    eq('drum multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);

    // Drum multi-step where the anchor is held past the 300ms step-automation
    // threshold (reproduces the device failure): after step 3 is released,
    // step 0 is held alone, and the per-tick stepAutoTick must NOT promote it to
    // step-automation mode (which would suppress its toggle). The anchor must
    // still enter on release.
    {
        const { stepAutoTick } = await import('../dist/esm/seq/step-edit.js');
        resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
        seqState.lenSteps = 16;
        seqSetLane(38); seqEngineTick();
        const realNow = Date.now;
        let clock = 1000;
        Date.now = () => clock;
        seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0 (press at t=1000)
        seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 while step 0 held
        seqHandleMidi([0x80, 16 + 3, 0], false);     // release step 3 → toggles on
        clock = 1500;                                // 500ms later — past the 300ms threshold
        stepAutoTick();                              // per-tick promotion check fires here
        seqHandleMidi([0x80, 16 + 0, 0], false);     // release step 0 → must still toggle
        Date.now = realNow;
        eq('drum multi (>300ms hold): anchor still entered', occHasStep(0), true);
        eq('drum multi (>300ms hold): B still entered', occHasStep(3), true);
    }

    // Harder ordering (matches device MIDI-inject latency): the anchor is held
    // ALONE past 300ms and promoted to step-automation FIRST, then the second
    // step is pressed. The multi-press must cancel the anchor's promotion so it
    // still enters on release.
    {
        const { stepAutoTick } = await import('../dist/esm/seq/step-edit.js');
        resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
        seqState.lenSteps = 16;
        seqSetLane(38); seqEngineTick();
        const realNow = Date.now;
        let clock = 1000;
        Date.now = () => clock;
        seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
        clock = 1400;                                // 400ms alone → promotes to auto mode
        stepAutoTick();
        seqHandleMidi([0x90, 16 + 3, 127], false);   // NOW press step 3 (multi-press)
        seqHandleMidi([0x80, 16 + 3, 0], false);     // release step 3
        seqHandleMidi([0x80, 16 + 0, 0], false);     // release step 0
        Date.now = realNow;
        eq('drum multi (anchor promoted first): anchor still entered', occHasStep(0), true);
        eq('drum multi (anchor promoted first): B entered', occHasStep(3), true);
    }
    seqSetLane(-1); seqEngineTick();

    // Mute held: a track-button press must NOT retarget the watched track.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.watchTrack = 0;
    setMuteHeld(true);
    seqHandleMidi([0xB0, 42, 127], false);   // track button for track 1 (CC 43 = track 0)
    eq('mute+track keeps watchTrack', seqState.watchTrack, 0);
    eq('mute+track emits no watch cmd', engine.ops.some((o) => o.startsWith('watch ')), false);
    setMuteHeld(false);

    // Copy held + two step presses (note view) → cpy then pst, no note toggled.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    {
        const { copyButton } = await import('../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 16 + 2, 127], false); // source step 2
        seqHandleMidi([0x90, 16 + 9, 127], false); // dest step 9
        copyButton(false);
        seqEngineTick();                           // flush queued cmds to the mock engine
        eq('dup step copy via router', engine.ops.includes('cpy 0 2 2'), true);
        eq('dup step paste via router', engine.ops.includes('pst 0 9'), true);
        eq('dup step did not toggle a note', engine.ops.some((o) => o.startsWith('tog ')), false);
    }

    // Session: Copy held + two clip pads → clipcopy then clippaste, no launch.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.sessionMode = true;
    {
        const { copyButton } = await import('../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 68, 127], false);     // pad 68 = track 3 slot 0 (bottom-left)
        seqHandleMidi([0x90, 68 + 1, 127], false); // dest pad
        copyButton(false);
        seqEngineTick();
        eq('dup clip copy via router', engine.ops.some((o) => o.startsWith('clipcopy')), true);
        eq('dup clip paste via router', engine.ops.some((o) => o.startsWith('clippaste')), true);
        eq('dup clip did not launch', engine.ops.some((o) => o.startsWith('launch')), false);
    }
    seqState.sessionMode = false;

    // Session: Clear held + clip pad → clipdelat + toast; multiple while held.
    resetSeqState(); engine.reset(); resetSeqEngine(); resetSeqToast(); seqEngineTick();
    seqState.sessionMode = true;
    seqHandleMidi([0xB0, 119, 127], false);   // hold Clear
    seqHandleMidi([0x90, 68, 127], false);     // clip A
    seqHandleMidi([0x90, 68 + 1, 127], false); // clip B (still held)
    seqEngineTick();
    eq('clear+clip deletes A', engine.ops.includes('clipdelat 3 0'), true);
    eq('clear+clip deletes B', engine.ops.includes('clipdelat 3 1'), true);
    seqHandleMidi([0xB0, 119, 0], false);
    seqState.sessionMode = false;

    // Step entry while stopped does not start the transport (UI mirror).
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.playing = false;
    seqHandleMidi([0x90, 16 + 0, 127], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    eq('step entry keeps playing false', seqState.playing, false);

    // Bar navigation: Right advances the visible bar (clip is 1 bar long, so
    // one extra empty bar is reachable), with a toast; clamps at the end.
    resetSeqState(); resetSeqToast();
    seqState.lenSteps = 16; // one bar
    eq('Right arrow claimed (engine ready)', seqHandleMidi([0xB0, 63, 127], false), true);
    eq('barOffset advanced to 1', seqState.barOffset, 1);
    // Bar-N toasts were dropped (Task 9); bar nav is now silent.
    seqHandleMidi([0xB0, 63, 127], false);     // clamp: max is 1 for a 1-bar clip
    eq('barOffset clamped', seqState.barOffset, 1);
    seqHandleMidi([0xB0, 62, 127], false);     // Left
    eq('Left arrow returns to bar 0', seqState.barOffset, 0);
    // Step tap on bar 1 targets absolute step 16.
    seqState.barOffset = 1;
    seqNotePadPlayed(0, 80, 60, 100); seqNotePadReleased(80);
    tapStep(0);
    seqEngineTick();
    eq('bar offset maps to absolute step', lastOp(), 'tog 0 16 60 100');

    // Play toggles transport based on the mirror.
    resetSeqState();
    eq('Play CC claimed', seqHandleMidi([0xB0, 85, 127], false), true);
    seqEngineTick();
    eq('play cmd emitted', lastOp(), 'play');
    eq('optimistic play mirror', seqState.playing, true);
    seqHandleMidi([0xB0, 85, 127], false);
    seqEngineTick();
    eq('second press emits stop', lastOp(), 'stop');

    // Track buttons: watch retarget without claiming the event.
    eq('track button NOT claimed', seqHandleMidi([0xB0, 41, 127], false), false);
    seqEngineTick();
    eq('watch cmd emitted for track 2', lastOp(), 'watch 2');
    eq('watchTrack mirrored', seqState.watchTrack, 2);

    // Arrows fall through to existing nav when the engine is NOT ready.
    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
    eq('Right arrow NOT claimed without engine', seqHandleMidi([0xB0, 63, 127], false), false);

    engine.reset(); resetSeqEngine(); resetSeqState(); resetSeqToast();
}

/* ── seq LEDs: track-colored step row, cached painting ───────────────────── */
{
    _log('\nseq LEDs:');
    const { seqLedsTick, seqLedsInvalidate } = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../dist/esm/seq/state.js');
    const { C_WHITE, C_DARKGREY, C_GREEN, trackColorDim } =
        await import('../dist/esm/seq/colors.js');

    const ledCalls = [];
    const origSetLED = globalThis.setLED;
    const origSetButtonLED = globalThis.setButtonLED;
    globalThis.setLED = (note, color) => ledCalls.push([note, color]);
    globalThis.setButtonLED = (cc, color) => ledCalls.push(['b' + cc, color]);

    resetSeqState(); seqLedsInvalidate();
    seqState.watchTrack = 0;
    seqState.lenSteps = 32;       // 2 bars
    occToggleStep(0); occToggleStep(4);
    seqState.playing = true;
    seqState.curStep = 2;

    // Cold frame paints progressively (FRAME_BUDGET sends/tick); drain it so
    // every LED (incl. the last-painted transport button) has been emitted.
    for (let i = 0; i < 3; i++) seqLedsTick();
    let byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('occupied step white', byNote[16], C_WHITE);
    eq('occupied step white (2)', byNote[20], C_WHITE);
    eq('playhead green', byNote[18], C_GREEN);
    eq('empty in-loop dim track color', byNote[17], trackColorDim(0));
    eq('play button lit (green)', byNote.b85, C_GREEN);

    // Cached layer: identical repaint sends nothing.
    ledCalls.length = 0;
    seqLedsTick();
    eq('no LED traffic when unchanged', ledCalls.length, 0);

    // Playhead movement repaints exactly the two affected steps.
    seqState.curStep = 3;
    seqLedsTick();
    eq('playhead move repaints 2 LEDs', ledCalls.length, 2);

    // Bar 2 view: bar 1 is in-loop (steps 16-31), so all dim track color;
    // a step past the loop would be dim gray, but len=32 fills bar 1.
    ledCalls.length = 0;
    seqState.barOffset = 1;
    seqState.playing = false;
    seqLedsInvalidate();
    seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('bar 2 in-loop dim track color', byNote[16], trackColorDim(0));

    // Empty bar past the loop → dim gray.
    ledCalls.length = 0;
    seqState.lenSteps = 16;       // shrink to 1 bar; bar 1 now outside loop
    seqLedsInvalidate();
    seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('bar past loop dim gray', byNote[16], C_DARKGREY);

    // Recording: playhead step is red instead of green.
    resetSeqState(); seqLedsInvalidate();
    const { C_REC_RED: C_REC_RED_LED } = await import('../dist/esm/seq/colors.js');
    seqState.watchTrack = 0; seqState.lenSteps = 16; seqState.playing = true;
    seqState.recording = true; seqState.curStep = 0;
    ledCalls.length = 0;
    for (let i = 0; i < 3; i++) seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('playhead red when recording', byNote[16], C_REC_RED_LED);

    // Session (master chain) mode: step row goes dark — there is no per-step
    // editing for master FX, so notes 16..31 must be painted black.
    resetSeqState(); seqLedsInvalidate();
    seqState.sessionMode = true;
    seqState.lenSteps = 16; occToggleStep(0); occToggleStep(4);
    ledCalls.length = 0;
    for (let i = 0; i < 3; i++) seqLedsTick();   // drain progressive cold frame
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('session step 0 off', byNote[16], 0);
    eq('session step 4 off', byNote[20], 0);

    globalThis.setLED = origSetLED;
    globalThis.setButtonLED = origSetButtonLED;
    resetSeqState(); seqLedsInvalidate();
}

/* ── seq pads: chromatic layout + coloring ───────────────────────────────── */
{
    _log('\nseq chromatic pads:');
    const { chromaticPitch, chromaticPadColor, inScale } =
        await import('../dist/esm/seq/pads.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');

    const PAD_MIN = 68;
    const base = 48; // C3 at bottom-left

    // Bottom-left = base; +1 per column right; +5 per row up.
    eq('bottom-left = base note', chromaticPitch(68, PAD_MIN, base), 48);
    eq('one column right = +1 semitone', chromaticPitch(69, PAD_MIN, base), 49);
    eq('one row up = +5 semitones', chromaticPitch(76, PAD_MIN, base), 53);
    eq('top-left (row 3) = +15', chromaticPitch(92, PAD_MIN, base), 63);

    // Coloring: root C = track color, in-scale gray, out-of-scale dark.
    eq('root C uses track color', chromaticPadColor(68, PAD_MIN, base, 2, false), trackColor(2));
    // base+2 = D (in C major) → light gray (118)
    eq('in-scale note light gray', chromaticPadColor(70, PAD_MIN, base, 0, false), 118);
    // base+1 = C# (out of scale) → dark
    eq('out-of-scale dark', chromaticPadColor(69, PAD_MIN, base, 0, false), 0);
    // isPlaying=true → green (sounding, highest priority)
    eq('playing pad green', chromaticPadColor(69, PAD_MIN, base, 0, true), 11);

    eq('C in major scale', inScale(60), true);
    eq('C# not in major scale', inScale(61), false);
}

/* ── seq Full Velocity toggle (Shift+Step 10) ────────────────────────────── */
{
    _log('\nseq full velocity:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqEngineTick(); // ready

    eq('full velocity off by default', seqState.fullVelocity, false);
    // Shift + Step 10 (note 25) toggles it; the event is still claimed.
    eq('shift+step claimed', seqHandleMidi([0x90, 25, 127], true), true);
    eq('full velocity toggled on', seqState.fullVelocity, true);
    seqHandleMidi([0x90, 25, 127], true);
    eq('full velocity toggled off', seqState.fullVelocity, false);

    // A bare step press+release (no shift) toggles a note, not the flag.
    seqHandleMidi([0x90, 25, 127], false);
    seqHandleMidi([0x80, 25, 0], false);
    eq('bare step did not touch full velocity', seqState.fullVelocity, false);

    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── seq loop mode: toggle, set window, double, resize ───────────────────── */
{
    _log('\nseq loop mode:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetLoopMode(); resetStepEdit(); resetSeqToast();
    seqEngineTick(); // ready
    seqState.lenSteps = 32; // 2-bar clip

    // Loop button tap (down then up with no gesture) latches Loop Mode on.
    seqHandleMidi([0xB0, 58, 127], false);
    seqHandleMidi([0xB0, 58, 0], false);
    eq('Loop tap enters Loop Mode', seqState.loopMode, true);

    // Two bars pressed together → loop window [min,max].
    seqHandleMidi([0x90, 16 + 1, 127], false); // bar 1 (index 1)
    seqHandleMidi([0x90, 16 + 3, 127], false); // bar 3
    seqEngineTick();
    eq('two-bar press sets loop window', engine.ops[engine.ops.length - 1], 'loop 0 16 48');
    eq('optimistic loopStart', seqState.loopStart, 16);
    eq('optimistic lenSteps', seqState.lenSteps, 48);
    seqHandleMidi([0x80, 16 + 1, 0], false);
    seqHandleMidi([0x80, 16 + 3, 0], false);

    // Double-tap one bar → 1-bar loop at that bar.
    seqHandleMidi([0x90, 16 + 2, 127], false);
    seqHandleMidi([0x80, 16 + 2, 0], false);
    seqHandleMidi([0x90, 16 + 2, 127], false); // within double-tap window
    seqEngineTick();
    eq('double-tap sets 1-bar loop', engine.ops[engine.ops.length - 1], 'loop 0 32 16');
    seqHandleMidi([0x80, 16 + 2, 0], false);

    // Loop + wheel resizes by whole bars (loop currently 1 bar at bar 2).
    seqHandleMidi([0xB0, 58, 127], false);     // hold Loop
    seqHandleMidi([0xB0, 14, 1], false);       // wheel +1 → 2 bars from bar 2
    seqEngineTick();
    eq('Loop+wheel grows the loop', engine.ops[engine.ops.length - 1], 'loop 0 32 32');
    seqHandleMidi([0xB0, 58, 0], false);       // release; gesture happened → no toggle
    eq('Loop+wheel hold did not toggle mode', seqState.loopMode, true);

    // Shift+Step 15 doubles the loop.
    seqState.loopStart = 0; seqState.lenSteps = 16;
    seqHandleMidi([0x90, 16 + 14, 127], true);
    seqEngineTick();
    eq('Shift+Step15 doubles loop', engine.ops[engine.ops.length - 1], 'dbl 0');

    // Momentary semantics. resetMomentary + resetLoopMode so press state is clean.
    const { resetMomentary } = await import('../dist/esm/seq/momentary.js');
    resetMomentary(); resetLoopMode();

    // Clean tap from Note → latches Loop on.
    seqState.loopMode = false;
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=false → loopMode=true
    seqHandleMidi([0xB0, 58, 0], false);   // up: tap (0 ticks elapsed) → latch
    eq('Loop tap from Note latches on', seqState.loopMode, true);

    // Clean tap while already in Loop → toggles back to Note.
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=true
    seqHandleMidi([0xB0, 58, 0], false);   // up: tap → toggle off
    eq('Loop tap while in Loop exits to Note', seqState.loopMode, false);

    // Loop + wheel from Note: the gesture reverts on release (no latch).
    seqState.loopMode = false;
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=false → loopMode=true
    seqHandleMidi([0xB0, 14, 1], false);   // wheel → momentaryGesture
    seqHandleMidi([0xB0, 58, 0], false);   // up: gesture → revert to Note
    eq('Loop+wheel from Note reverts', seqState.loopMode, false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetLoopMode();
}

/* ── seq loop LEDs: bars on the step row ─────────────────────────────────── */
{
    _log('\nseq loop LEDs:');
    const { seqLedsTick, seqLedsInvalidate } = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../dist/esm/seq/state.js');
    const { C_WHITE, C_DARKGREY, trackColor } = await import('../dist/esm/seq/colors.js');

    const ledCalls = [];
    const origSetLED = globalThis.setLED;
    globalThis.setLED = (note, color) => ledCalls.push([note, color]);

    resetSeqState(); seqLedsInvalidate();
    seqState.loopMode = true;
    seqState.watchTrack = 0;
    seqState.loopStart = 16;   // loop = bar 1..2
    seqState.lenSteps = 32;
    seqState.barOffset = 1;    // bar 1 is selected
    occToggleStep(16 * 3 + 2); // content in bar 3

    seqLedsTick();
    const byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    // New loop-bar semantics: selected=white, content=blink track color, else off.
    eq('selected bar white (bar 1)', byNote[17], C_WHITE);
    eq('empty bar off (bar 2)', byNote[18], 0);
    eq('content bar blink on = track color', byNote[19], trackColor(0));
    eq('empty bar off (bar 0)', byNote[16], 0);

    globalThis.setLED = origSetLED;
    resetSeqState(); seqLedsInvalidate();
}

/* ── seq step editing: hold-step gestures ────────────────────────────────── */
{
    _log('\nseq step editing:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');
    const { clearHeldSet } = await import('../dist/esm/seq/held.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetStepEdit(); resetLoopMode(); resetSeqToast();
        for (let t = 0; t < 4; t++) clearHeldSet(t); // clear white selection between sub-tests
        engine.reset();
    };
    reset();
    seqEngineTick(); // ready

    const lastOp = () => engine.ops[engine.ops.length - 1];

    // Hold step 3 + Volume turn → velocity edit (note NOT toggled on release).
    seqHandleMidi([0x90, 16 + 3, 127], false);   // hold step 3
    eq('Volume claimed while step held', seqHandleMidi([0xB0, 79, 1], false), true);
    seqEngineTick();
    eq('velocity edit op', lastOp(), 'evel 0 3 3 -1 4');
    seqHandleMidi([0x80, 16 + 3, 0], false);     // release — gesture happened
    seqEngineTick();
    eq('held+edit did not toggle a note', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    // Hold step + wheel → length; + arrow → nudge; + arrow w/ shift → fine.
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 0, 127], false);
    seqHandleMidi([0xB0, 14, 1], false);
    seqEngineTick();
    eq('length edit op', lastOp(), 'elen 0 0 0 -1 2');
    seqHandleMidi([0xB0, 63, 127], false);       // right arrow
    seqEngineTick();
    eq('nudge coarse op', lastOp(), 'enudge 0 0 0 -1 2');
    seqHandleMidi([0xB0, 62, 127], true);        // left arrow + shift = fine
    seqEngineTick();
    eq('nudge fine op', lastOp(), 'enudge 0 0 0 -1 -1');
    seqHandleMidi([0x80, 16 + 0, 0], false);

    // Hold step + plus = transpose (melodic). Drum lane disables transpose.
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 5, 127], false);
    eq('plus claimed while step held', seqHandleMidi([0xB0, 55, 127], false), true);
    seqEngineTick();
    eq('transpose op', lastOp(), 'etrn 0 5 5 -1 1');
    seqHandleMidi([0x80, 16 + 5, 0], false);

    // Hold step + pad → toggle that pitch at the step (single step).
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 2, 127], false);   // hold step 2
    seqNotePadPlayed(0, 80, 67, 100);            // pad while held
    seqEngineTick();
    eq('hold-step + pad toggles pitch at step', lastOp(), 'ltog 0 2 67 100');
    seqHandleMidi([0x80, 16 + 2, 0], false);

    // Multi-step hold in Loop Mode: pressing two bars registers both for edits.
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0x90, 16 + 1, 127], false);
    seqHandleMidi([0x90, 16 + 4, 127], false);
    seqHandleMidi([0xB0, 79, 1], false);         // Volume up
    seqEngineTick();
    eq('multi-step (loop mode) velocity edits both bars', engine.ops.filter(o => o.startsWith('evel')).length, 2);
    seqHandleMidi([0x80, 16 + 1, 0], false);
    seqHandleMidi([0x80, 16 + 4, 0], false);
    seqState.loopMode = false;

    // A plain tap (no gesture) DOES toggle a note on release.
    reset(); seqEngineTick();
    seqState.lastPitch[0] = 64; seqState.lastVel[0] = 90;
    seqHandleMidi([0x90, 16 + 7, 127], false);
    seqHandleMidi([0x80, 16 + 7, 0], false);
    seqEngineTick();
    eq('tap toggles a note on release', lastOp(), 'tog 0 7 64 90');

    // Loop Mode: hold a bar + wheel edits the whole bar's note lengths.
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0x90, 16 + 1, 127], false);   // hold bar 1
    seqHandleMidi([0xB0, 14, 1], false);         // wheel
    seqEngineTick();
    eq('loop-mode bar edit spans the bar', lastOp(), 'elen 0 16 31 -1 2');
    seqHandleMidi([0x80, 16 + 1, 0], false);

    uninstallMockEngine(); reset();
}

/* ── seq copy & delete operations ────────────────────────────────────────── */
{
    _log('\nseq copy & delete:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetEditOps } = await import('../dist/esm/seq/edit-ops.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');
    const { resetDuplicate } = await import('../dist/esm/seq/duplicate.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetEditOps(); resetDuplicate();
        resetStepEdit(); resetLoopMode(); resetSeqToast(); engine.reset();
    };
    const lastOp = () => engine.ops[engine.ops.length - 1];
    reset(); seqEngineTick();

    // Copy held → source step → dest step: copy then paste-replace, no toggles.
    // (The full duplicate-gesture matrix is covered in the 'duplicate gesture'
    // and 'seq router' blocks; here we just confirm the Copy button routes to
    // it and releases cleanly.)
    seqHandleMidi([0xB0, 60, 127], false);     // Copy down
    seqHandleMidi([0x90, 16 + 0, 127], false); // source step 0
    seqHandleMidi([0x90, 16 + 8, 127], false); // dest step 8
    seqHandleMidi([0xB0, 60, 0], false);       // Copy up
    seqEngineTick();
    eq('dup copy then paste', engine.ops.includes('cpy 0 0 0') && engine.ops.includes('pst 0 8'), true);
    eq('dup presses did not toggle notes', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    // Delete tap → delete clip.
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0xB0, 119, 0], false);
    seqEngineTick();
    eq('Delete tap deletes clip', lastOp(), 'clipdel 0');

    // Delete + step → delete that step's notes (no clip delete on release).
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);    // Delete down
    seqHandleMidi([0x90, 16 + 5, 127], false); // step 5
    seqEngineTick();
    eq('Delete+step clears the step notes', engine.ops.includes('del 0 5 5 -1'), true);
    eq('Delete+step clears the step automation', engine.ops.includes('aclrstep 0 5'), true);
    seqHandleMidi([0xB0, 119, 0], false);      // release — acted, so no clip delete
    seqEngineTick();
    eq('Delete+step release did not delete clip',
        engine.ops.filter(o => o.startsWith('clipdel')).length, 0);

    // Delete + step in Loop Mode → delete the whole bar.
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0x90, 16 + 2, 127], false); // bar 2
    seqEngineTick();
    eq('Delete+bar clears the bar', engine.ops.includes('del 0 32 47 -1'), true);
    seqHandleMidi([0xB0, 119, 0], false);

    // Delete + drum pad → clear that pitch across the clip.
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);
    seqNotePadPlayed(0, 80, 38, 100);          // pad while Delete held
    seqEngineTick();
    eq('Delete+pad clears the pitch', lastOp(), 'del 0 0 255 38');
    seqHandleMidi([0xB0, 119, 0], false);

    // Step held + Clear → clears that step's automation (no clip delete, no note).
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 7, 127], false); // hold step 7
    seqHandleMidi([0xB0, 119, 127], false);    // Clear down while holding
    seqEngineTick();
    eq('step+Clear clears that step automation', engine.ops.includes('aclrstep 0 7'), true);
    seqHandleMidi([0xB0, 119, 0], false);      // Clear release
    seqHandleMidi([0x80, 16 + 7, 0], false);   // step release
    seqEngineTick();
    eq('step+Clear did not delete the clip', engine.ops.filter(o => o.startsWith('clipdel')).length, 0);
    eq('step+Clear did not toggle a note', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    uninstallMockEngine(); reset();
}

/* ── seq recording: Rec, metronome, quantize, live capture ───────────────── */
{
    _log('\nseq recording:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetEditOps } = await import('../dist/esm/seq/edit-ops.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetEditOps(); resetStepEdit();
        resetSeqToast(); engine.reset();
    };
    const lastOp = () => engine.ops[engine.ops.length - 1];
    reset(); seqEngineTick();

    // Rec press → rec command on the watched track.
    seqHandleMidi([0xB0, 86, 127], false);
    seqEngineTick();
    eq('Rec emits rec command', lastOp(), 'rec 0');

    // Shift+Step 6 toggles metronome; Shift+Step 16 quantizes.
    seqHandleMidi([0x90, 16 + 5, 127], true);
    seqEngineTick();
    eq('Shift+Step6 toggles metronome', lastOp(), 'metro 1');
    seqHandleMidi([0x90, 16 + 15, 127], true);
    seqEngineTick();
    eq('Shift+Step16 quantizes', lastOp(), 'quant 0');

    // Live pad notes forward non/nof for recording capture.
    reset(); seqEngineTick();
    seqNotePadPlayed(0, 80, 67, 110);
    seqEngineTick();
    eq('pad-on forwards non', lastOp(), 'non 0 67 110');
    seqNotePadReleased(80);
    seqEngineTick();
    eq('pad-off forwards nof', lastOp(), 'nof 0 67');

    // Status mirrors recording flags for the Rec LED.
    engine.status.rec = 1; engine.status.cin = 0; engine.status.metro = 1;
    globalThis.host_module_get_param = (key) =>
        key === 'status' ? 'play=1 rec=1 cin=0 metro=1' : (key === 'ping' ? 'pong ' + ENGINE_VERSION : null);
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('recording flag mirrored', seqState.recording, true);
    eq('metronome flag mirrored', seqState.metro, true);

    uninstallMockEngine(); reset();
}

/* ── seq session mode: grid, launch/stop, copy/delete clips ──────────────── */
{
    _log('\nseq session mode:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, sessionFromStr } = await import('../dist/esm/seq/state.js');
    const { resetSession } = await import('../dist/esm/seq/session.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');
    const { resetDuplicate } = await import('../dist/esm/seq/duplicate.js');

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetSession(); resetDuplicate(); resetSeqToast(); engine.reset(); };
    const lastOp = () => engine.ops[engine.ops.length - 1];
    reset(); seqEngineTick();

    // Note/Session toggle.
    seqHandleMidi([0xB0, 50, 127], false);
    eq('Note/Session enters session', seqState.sessionMode, true);

    // Pad grid mapping: top-left pad (note 92) = track 0, slot 0.
    seqHandleMidi([0x90, 92, 127], false);
    seqEngineTick();
    eq('top-left pad → launch track 0 slot 0', lastOp(), 'launch 0 0');
    eq('launch retargets watch track', seqState.watchTrack, 0);
    // Bottom-left pad (note 68) = track 3, slot 0.
    seqHandleMidi([0x90, 68, 127], false);
    seqEngineTick();
    eq('bottom-left pad → track 3 slot 0', lastOp(), 'launch 3 0');
    // One column right on the top row (note 93) = track 0, slot 1.
    seqHandleMidi([0x90, 93, 127], false);
    seqEngineTick();
    eq('column maps to slot', lastOp(), 'launch 0 1');

    // Pads are claimed in session mode (not played as notes).
    eq('session pad note-on claimed', seqHandleMidi([0x90, 80, 100], false), true);
    eq('session pad note-off claimed', seqHandleMidi([0x80, 80, 0], false), true);

    // Delete + pad → delete that clip.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    seqHandleMidi([0xB0, 119, 127], false);   // Delete down
    seqHandleMidi([0x90, 92, 127], false);    // track 0 slot 0
    seqEngineTick();
    eq('Delete+pad clears the clip', lastOp(), 'clipdelat 0 0');
    seqHandleMidi([0xB0, 119, 0], false);

    // Copy HELD → src pad → dest pad (still held) → clip copy then paste.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    seqHandleMidi([0xB0, 60, 127], false);    // Copy down (held)
    seqHandleMidi([0x90, 92, 127], false);    // src = track 0 slot 0
    seqEngineTick();
    eq('clip copy op', lastOp(), 'clipcopy 0 0');
    seqHandleMidi([0x90, 93, 127], false);    // dest = track 0 slot 1 (still held)
    seqEngineTick();
    eq('clip paste op', lastOp(), 'clippaste 0 1');
    seqHandleMidi([0xB0, 60, 0], false);      // Copy up

    // Status `sess=` populates the grid mirror.
    sessionFromStr('03.0.-.0,00.-.-.0,00.-.-.0,00.-.-.0');
    eq('session exist bitmap parsed', seqState.session[0].exist, 0x03);
    eq('session playing slot parsed', seqState.session[0].playing, 0);
    eq('session no-queue parsed as -1', seqState.session[0].queued, -1);

    uninstallMockEngine(); reset();
}

/* ── seq session LEDs: clip grid colors ──────────────────────────────────── */
{
    _log('\nseq session LEDs:');
    const { sessionPaintGrid, resetSession } = await import('../dist/esm/seq/session.js');
    const { seqState, resetSeqState, sessionFromStr } = await import('../dist/esm/seq/state.js');
    const { C_WHITE, C_BLACK, C_DARKGREY, trackColor,
            ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');

    resetSeqState(); resetSession();
    // track0: slot0 exists+playing; slot1 exists (stopped); slot2 queued;
    // slot3 exists+selected (focus). tracks 1-3: empty, selected=0.
    sessionFromStr('0F.0.2.3,00.-.-.0,00.-.-.0,00.-.-.0');

    const cells = {};
    sessionPaintGrid((note, base, anim, channel) => { cells[note] = { base, anim, channel }; }, 68);
    // top row = track 0: notes 92/93/94/95 = slots 0/1/2/3.
    eq('playing pulses (Pulse4th) to white', cells[92].channel, ANIM_PULSE);
    eq('playing anim target white', cells[92].anim, C_WHITE);
    eq('playing base = track color', cells[92].base, trackColor(0));
    eq('stopped clip is solid', cells[93].channel, ANIM_NONE);
    eq('stopped clip = track color', cells[93].base, trackColor(0));
    eq('queued pulses fast (Pulse8th)', cells[94].channel, ANIM_PULSE_FAST);
    eq('queued anim target white', cells[94].anim, C_WHITE);
    eq('selected clip pulses slow (Pulse2th)', cells[95].channel, ANIM_PULSE_SLOW);
    eq('selected clip base = track color', cells[95].base, trackColor(0));

    // Selection highlight is NOT gated on watchTrack: every track greys its own
    // selected (default slot 0) empty cell, solid (no animation).
    eq('track3 selected-empty grey', cells[68].base, C_DARKGREY); // bottom row slot 0
    eq('track3 selected-empty solid', cells[68].channel, ANIM_NONE);
    eq('track2 selected-empty grey', cells[76].base, C_DARKGREY);
    eq('track1 selected-empty grey', cells[84].base, C_DARKGREY);
    eq('track3 unselected-empty dark', cells[69].base, C_BLACK);   // slot 1, not selected
    eq('track3 unselected-empty solid', cells[69].channel, ANIM_NONE);

    resetSeqState(); resetSession();
}

/* ── seq LED animation channel constants ─────────────────────────────────── */
{
    _log('\nseq anim constants:');
    const { ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');
    eq('NoAnimation channel', ANIM_NONE, 0x00);
    eq('Pulse4th channel', ANIM_PULSE, 0x09);
    eq('Pulse8th channel', ANIM_PULSE_FAST, 0x08);
    eq('Pulse2th channel', ANIM_PULSE_SLOW, 0x0A);
}

/* ── seq cachedSetAnimLED: native animation + base handshake ──────────────── */
{
    _log('\nseq anim LED cache:');
    const { cachedSetAnimLED, ledFrameReset, seqLedsInvalidate }
        = await import('../dist/esm/seq/leds.js');
    const { ANIM_NONE, ANIM_PULSE } = await import('../dist/esm/seq/colors.js');

    const sent = [];
    const savedSend = globalThis.move_midi_internal_send;
    globalThis.move_midi_internal_send = (arr) => { sent.push(arr.slice()); };
    const tick = (fn) => { ledFrameReset(); fn(); };

    seqLedsInvalidate();              // clear cache state

    // Solid color: one note-on on channel 0.
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('solid emits one msg', sent.length, 1);
    eq('solid status ch0', sent[0][1], 0x90);
    eq('solid note', sent[0][2], 70);
    eq('solid color', sent[0][3], 22);

    // Re-sending the same solid state sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('unchanged solid sends nothing', sent.length, 0);

    // Animate a note whose base is already established (base 22 == last solid):
    // emits exactly one message, on the Pulse channel, with the anim color.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('anim w/ established base = one msg', sent.length, 1);
    eq('anim status = 0x90 | channel', sent[0][1], 0x90 | ANIM_PULSE);
    eq('anim color is the target', sent[0][3], 120);

    // Re-sending the same animation sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('unchanged anim sends nothing', sent.length, 0);

    // Handshake: a note whose base differs from last sent emits the base (ch0)
    // this tick, then the animation on the NEXT tick.
    seqLedsInvalidate(); sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // base 7 never sent
    eq('handshake tick1 = base on ch0', sent.length, 1);
    eq('handshake tick1 status ch0', sent[0][1], 0x90);
    eq('handshake tick1 color = base', sent[0][3], 7);
    sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // same request next tick
    eq('handshake tick2 = anim', sent.length, 1);
    eq('handshake tick2 status = pulse', sent[0][1], 0x90 | ANIM_PULSE);
    eq('handshake tick2 color = anim', sent[0][3], 120);

    globalThis.move_midi_internal_send = savedSend;
    seqLedsInvalidate();
}

/* ── seq loop overview strip (bottom-of-screen render) ───────────────────── */
{
    _log('\nseq loop strip:');
    const rects = [];
    const origFill = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push({ x, y, w, h, v });

    const { drawLoopStrip } = await import('../dist/esm/seq/render.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    // 2-bar clip, bar 0 selected, not playing.
    resetSeqState();
    seqState.lenSteps = 32;
    seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    // First rect clears the band; then a thick segment for the selected bar
    // and a thin one for the other.
    eq('strip clears its band first', rects[0].v, 0);
    const segs = rects.slice(1).filter(r => r.v === 1);
    eq('two bar segments drawn', segs.length, 2);
    eq('selected bar is thick (2px)', segs[0].h, 2);
    eq('other bar is thin (1px)', segs[1].h, 1);

    // Single-bar loop → the sole bar is thin (native rule).
    resetSeqState(); seqState.lenSteps = 16; seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    const seg1 = rects.slice(1).filter(r => r.v === 1);
    eq('single-bar loop draws one segment', seg1.length, 1);
    eq('single bar is thin', seg1[0].h, 1);

    // Navigating to the empty bar past a 1-bar loop draws a "+" (two rects).
    resetSeqState(); seqState.lenSteps = 16; seqState.barOffset = 1;
    rects.length = 0;
    drawLoopStrip();
    // bar 0 segment (1) + plus icon (2 rects) = 3 lit rects.
    eq('empty bar shows a plus marker', rects.slice(1).filter(r => r.v === 1).length, 3);

    // Playing adds a vertical playhead mark (4px tall).
    resetSeqState(); seqState.lenSteps = 32; seqState.playing = true; seqState.curStep = 4;
    rects.length = 0;
    drawLoopStrip();
    eq('playhead mark drawn while playing', rects.some(r => r.v === 1 && r.h === 4), true);

    globalThis.fill_rect = origFill;
    resetSeqState();
}

/* ── seq persistence: load on boot, autosave on dirty ────────────────────── */
{
    _log('\nseq persistence:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { seqPersistTick, resetSeqPersist } = await import('../dist/esm/seq/persist.js');

    // Mock the device filesystem.
    const files = {};
    const PATH = '/data/UserData/schwung/modules/tools/movy/seq-state.json';
    globalThis.host_read_file  = (p) => files[p] ?? null;
    globalThis.host_write_file = (p, c) => { files[p] = c; return true; };

    const engine = installMockEngine();
    // Extend the mock to serve/accept a state blob.
    let engineState = 'movy1\nbpm 12000\n';
    const origGet = globalThis.host_module_get_param;
    globalThis.host_module_get_param = (key) => (key === 'state' ? engineState : origGet(key));
    const origSetB = globalThis.host_module_set_param_blocking;
    let loadedBlob = null;
    globalThis.host_module_set_param_blocking = (key, val) => {
        if (key === 'state') loadedBlob = val;
        return true;
    };

    // Restore: a saved file on disk is pushed to the engine once on boot.
    files[PATH] = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';
    resetSeqEngine(); resetSeqState(); resetSeqPersist();
    seqEngineTick();      // boot probe → ready
    seqPersistTick();     // first ready tick → load
    eq('state restored from file on boot', loadedBlob, files[PATH]);

    // Autosave: when dirty, the serialized state is written to the file.
    engineState = 'movy1\nbpm 13000\ncl 0 0 32 0 0:24:62:110\n';
    seqState.dirty = true;
    files[PATH] = ''; // clear to observe the write
    for (let i = 0; i < 700; i++) seqPersistTick(); // past the save interval
    eq('autosave wrote the engine state', files[PATH], engineState);
    eq('dirty cleared after save', seqState.dirty, false);

    // Not dirty → no write.
    files[PATH] = 'SENTINEL';
    for (let i = 0; i < 700; i++) seqPersistTick();
    eq('no write when clean', files[PATH], 'SENTINEL');

    globalThis.host_module_get_param = origGet;
    globalThis.host_module_set_param_blocking = origSetB;
    delete globalThis.host_read_file;
    delete globalThis.host_write_file;
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetSeqPersist();
    globalThis.host_read_file = () => null; // restore the default test stub
}

/* ── automation: restore re-requests label sync ──────────────────────────────
 * The boot label-sync runs before the persist restore, so it reads the engine
 * before its lanes exist (empty registry → no dot, no held value, no read-back
 * suppression). The restore must re-request the sync so the registry repopulates
 * from the now-restored engine labels. */
_log('\nautomation: restore re-requests label sync:');
{
    const { resetSeqEngine, seqEngineTick, takeLabelSync } = await import('../dist/esm/seq/engine.js');
    const { seqPersistTick, resetSeqPersist } = await import('../dist/esm/seq/persist.js');
    const { resetSeqState } = await import('../dist/esm/seq/state.js');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');

    const files = {};
    const PATH = '/data/UserData/schwung/modules/tools/movy/seq-state.json';
    globalThis.host_read_file  = (p) => files[p] ?? null;
    globalThis.host_write_file = () => true;
    const engine = installMockEngine();
    const origSetB = globalThis.host_module_set_param_blocking;
    globalThis.host_module_set_param_blocking = () => true;

    files[PATH] = 'movy1\nau 0 0 100 synth:cutoff\n';   // a persisted lane label
    resetSeqEngine(); resetSeqState(); resetSeqPersist();
    seqEngineTick();          // boot probe → ready → requestLabelSync (the boot's own)
    takeLabelSync();          // consume it, to isolate the restore's re-request
    eq('no pending label sync before restore', takeLabelSync(), false);
    seqPersistTick();         // first ready tick → restore pushes state
    eq('restore re-requests label sync', takeLabelSync(), true);

    globalThis.host_module_set_param_blocking = origSetB;
    delete globalThis.host_read_file;
    delete globalThis.host_write_file;
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetSeqPersist();
    globalThis.host_read_file = () => null;
}

/* ── active-notes mirror ─────────────────────────────────────────────────── */
{
    _log('\nactive-notes mirror:');
    const { activeFromStr, activeHasNote } = await import('../dist/esm/seq/state.js');

    activeFromStr('60.64,,38,');
    eq('track0 has 60',  activeHasNote(0, 60), true);
    eq('track0 has 64',  activeHasNote(0, 64), true);
    eq('track0 lacks 38', activeHasNote(0, 38), false);
    eq('track1 empty',   activeHasNote(1, 60), false);
    eq('track2 has 38',  activeHasNote(2, 38), true);
    activeFromStr(',,,'); // all clear
    eq('cleared',        activeHasNote(2, 38), false);
}

/* ── last-held set ───────────────────────────────────────────────────────── */
{
    _log('\nlast-held set:');
    const { noteHeld, setHeldSet, clearHeldSet } = await import('../dist/esm/seq/held.js');

    clearHeldSet(0);
    eq('empty initially', noteHeld(0, 60), false);
    setHeldSet(0, [60, 64, 67]);
    eq('60 held',  noteHeld(0, 60), true);
    eq('64 held',  noteHeld(0, 64), true);
    eq('62 not',   noteHeld(0, 62), false);
    eq('track1 unaffected', noteHeld(1, 60), false);
    setHeldSet(0, [72]);                 // replaces
    eq('replaced: 60 gone', noteHeld(0, 60), false);
    eq('replaced: 72 in',   noteHeld(0, 72), true);
}

/* ── drum pad LED color ──────────────────────────────────────────────────── */
{
    _log('\ndrum pad LED color:');
    globalThis.Black     = 0;
    globalThis.White     = 120;
    globalThis.NeonGreen = 11;

    const { drumPadLedColor } = await import('../dist/esm/keyboard/leds.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');

    const cfg = { rawMidi: false, padNoteStart: 36, padCount: 16 };
    const padMin = 68;
    // pad index 0 => drumPad 1 => note 36; selected when currentPhysPad === pad.
    const unselNotPlaying = drumPadLedColor(68, padMin, cfg, 36, /*phys*/-1, /*track*/2, /*playing*/false);
    eq('unselected = track color', unselNotPlaying, trackColor(2));
    const selected = drumPadLedColor(68, padMin, cfg, 36, /*phys*/68, 2, false);
    eq('selected = white', selected, 120);
    const playing = drumPadLedColor(68, padMin, cfg, 36, -1, 2, /*playing*/true);
    eq('playing = green', playing, 11);
    const off = drumPadLedColor(72, padMin, cfg, 36, -1, 2, false); // col>=4 => off
    eq('right half = off', off, 0);
}

/* ── chromatic pad LED color ─────────────────────────────────────────────── */
{
    _log('\nchromatic pad LED color:');
    const { chromaticPadColor, chromaticPitch } = await import('../dist/esm/seq/pads.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');
    const { setHeldSet, clearHeldSet } = await import('../dist/esm/seq/held.js');

    const padMin = 68, base = 60; // bottom-left = C4
    // bottom-left pad is the root C => track color, unless playing/held.
    eq('root = track color', chromaticPadColor(68, padMin, base, 0, false), trackColor(0));
    eq('playing = green',    chromaticPadColor(68, padMin, base, 0, /*playing*/true), 11);
    // mark the held set: pitch at pad 69 = C#4 = 61.
    setHeldSet(0, [chromaticPitch(69, padMin, base)]);
    eq('held-set = white',   chromaticPadColor(69, padMin, base, 0, false), 120);
    clearHeldSet(0);
    // step-hold overlay: holdNotes array overrides the noteHeld set
    const holdPitches = [chromaticPitch(68, padMin, base)]; // C4 = 60
    eq('holdNotes-in-array = white', chromaticPadColor(68, padMin, base, 0, false, holdPitches), 120);
    eq('holdNotes-missing = normal', chromaticPadColor(69, padMin, base, 0, false, holdPitches), 0); // C# out of scale → black
}

/* ── transport LEDs ──────────────────────────────────────────────────────── */
{
    _log('\ntransport LEDs:');
    const { transportPlayColor, transportRecColor } = await import('../dist/esm/seq/leds.js');
    const { C_REC_RED } = await import('../dist/esm/seq/colors.js');

    eq('play stopped = dark grey',   transportPlayColor(false), 124);
    eq('play running = green',       transportPlayColor(true), 11);
    eq('rec idle = dark grey',       transportRecColor(false, false), 124);
    eq('rec recording = red',        transportRecColor(true, false), C_REC_RED);
    eq('rec counting-in = red',      transportRecColor(false, true), C_REC_RED);
    eq('rec proper red color = 127', C_REC_RED, 127);
}

/* ── affordance LEDs ─────────────────────────────────────────────────────── */
{
    _log('\naffordance LEDs:');
    const {
        backLedColor, arrowLedColor, sampleLedColor, captureLedColor, undoLedColor,
    } = await import('../dist/esm/seq/buttons.js');
    const { VIEW_CHAIN, VIEW_KNOBS } = await import('../dist/esm/app/state.js');

    eq('back off in chain view',  backLedColor(VIEW_CHAIN), 0);
    eq('back dim in module view', backLedColor(VIEW_KNOBS), 16);
    eq('left off at bar 0',  arrowLedColor(-1, 0, 3, false), 0);
    eq('left dim mid',       arrowLedColor(-1, 1, 3, false), 16);
    eq('left bright pressed', arrowLedColor(-1, 1, 3, true), 124);
    eq('right off at max',   arrowLedColor(+1, 3, 3, false), 0);
    eq('right dim mid',      arrowLedColor(+1, 1, 3, false), 16);
    eq('sample always off',  sampleLedColor(), 0);
    eq('capture off',        captureLedColor(), 0);
    eq('undo off',           undoLedColor(), 0);
}

/* ── step-icon LEDs ──────────────────────────────────────────────────────── */
{
    _log('\nstep-icon LEDs:');
    const { stepIconColor } = await import('../dist/esm/seq/leds.js');

    // step indexes are 0-based: step 6 -> idx 5 (metro), step 10 -> idx 9 (full vel)
    const off = { shift: false, metro: false, fullVel: false };
    eq('metro idx dark when off+noshift', stepIconColor(5, off), 0);
    eq('metro idx lit when metro on',     stepIconColor(5, { shift: false, metro: true, fullVel: false }), 124);
    eq('fullvel idx lit when on',         stepIconColor(9, { shift: false, metro: false, fullVel: true }), 124);
    // Shift held: all shortcut icons show (dim if inactive, bright if active).
    eq('shift shows metro dim',  stepIconColor(5, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows dbl-loop dim', stepIconColor(14, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows quant dim',  stepIconColor(15, { shift: true, metro: false, fullVel: false }), 16);
    eq('non-shortcut idx dark',  stepIconColor(0, { shift: true, metro: false, fullVel: false }), 0);
}

/* ── track-button LEDs ───────────────────────────────────────────────────── */
{
    _log('\ntrack-button LEDs:');
    const { trackButtonColor } = await import('../dist/esm/seq/leds.js');
    const { trackColor, trackColorDim } = await import('../dist/esm/seq/colors.js');

    eq('base = track color', trackButtonColor(1, /*active*/false, /*muted*/false), trackColor(1));
    eq('active = white pulse', trackButtonColor(1, true, false), 120);
    eq('muted dim',     trackButtonColor(2, false, true), trackColorDim(2));
    eq('muted+active still white', trackButtonColor(2, true, true), 120);
}

/* ── loop bar color ──────────────────────────────────────────────────────── */
{
    _log('\nloop bar color:');
    const { loopBarColor } = await import('../dist/esm/seq/leds.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');

    const base = { isPlayhead:false, selected:false, hasContent:false, inLoop:false, blink:true, track:1 };
    eq('playhead green', loopBarColor({ ...base, isPlayhead:true }), 11);
    eq('selected white', loopBarColor({ ...base, selected:true }), 120);
    eq('content blink on = track', loopBarColor({ ...base, hasContent:true, blink:true }), trackColor(1));
    eq('content blink off = off', loopBarColor({ ...base, hasContent:true, blink:false }), 0);
    eq('empty = off', loopBarColor({ ...base }), 0);
}

/* ── session cell color ──────────────────────────────────────────────────── */
{
    _log('\nsession cell color:');
    const { sessionCellColor } = await import('../dist/esm/seq/session.js');
    const { trackColor, C_BLACK, C_WHITE, C_DARKGREY,
            ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');

    const base = { exists:false, isSel:false, isPlaying:false, isQueued:false, track:1 };
    const tc = trackColor(1);
    const led = (ctx) => JSON.stringify(sessionCellColor(ctx));
    const want = (b, a, ch) => JSON.stringify({ base:b, anim:a, channel:ch });
    // Solid (no animation) states.
    eq('empty unselected = off', led({ ...base }), want(C_BLACK, C_BLACK, ANIM_NONE));
    eq('content unselected = solid track', led({ ...base, exists:true }), want(tc, tc, ANIM_NONE));
    eq('selected empty = solid grey', led({ ...base, isSel:true }), want(C_DARKGREY, C_DARKGREY, ANIM_NONE));
    // Animated states (pulse base->white at distinct rates).
    eq('selected content = slow pulse', led({ ...base, exists:true, isSel:true }), want(tc, C_WHITE, ANIM_PULSE_SLOW));
    eq('playing = pulse', led({ ...base, exists:true, isPlaying:true }), want(tc, C_WHITE, ANIM_PULSE));
    eq('queued = fast pulse', led({ ...base, exists:true, isQueued:true }), want(tc, C_WHITE, ANIM_PULSE_FAST));
    // Priority: queued outranks playing.
    eq('queued outranks playing', sessionCellColor({ ...base, exists:true, isPlaying:true, isQueued:true }).channel, ANIM_PULSE_FAST);
}

/* ── loop single-press selects bar ───────────────────────────────────────── */
{
    _log('\nloop single-press selects bar:');
    const { loopStepOn, resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    resetLoopMode();
    seqState.barOffset = 0;
    loopStepOn(3);
    eq('barOffset follows press', seqState.barOffset, 3);
}

/* ── header announce TTL ─────────────────────────────────────────────────── */
{
    _log('\nheader announce TTL:');
    const { seqHeaderAnnounce, seqHeaderActive, seqHeaderTick, resetSeqHeader } =
        await import('../dist/esm/seq/render.js');

    resetSeqHeader();
    eq('inactive initially', seqHeaderActive(), false);
    seqHeaderAnnounce('Session', 2);
    eq('active after announce', seqHeaderActive(), true);
    seqHeaderTick(); seqHeaderTick();
    eq('expires after ttl', seqHeaderActive(), false);
}

/* ── mute gesture ────────────────────────────────────────────────────────── */
{
    _log('\nmute gesture:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { muteTrack, setMuteHeld, muteHeld } = await import('../dist/esm/seq/router.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { peekSeqCmdQueue, resetSeqEngine } = await import('../dist/esm/seq/engine.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();

    setMuteHeld(true);
    eq('mute held', muteHeld(), true);
    resetSeqEngine();
    seqState.muted[2] = false;
    muteTrack(2);
    eq('queues mute on', peekSeqCmdQueue().some(c => c === 'mute 2 1'), true);
    resetSeqEngine();
    seqState.muted[2] = true;
    muteTrack(2);
    eq('queues mute off', peekSeqCmdQueue().some(c => c === 'mute 2 0'), true);
    setMuteHeld(false);

    uninstallMockEngine();
}

/* ── mute mirror ─────────────────────────────────────────────────────────── */
{
    _log('\nmute mirror:');
    const { muteFromStr, seqState } = await import('../dist/esm/seq/state.js');

    muteFromStr('0100');
    eq('t0 unmuted', seqState.muted[0], false);
    eq('t1 muted',   seqState.muted[1], true);
    eq('t2 unmuted', seqState.muted[2], false);
    muteFromStr('1111');
    eq('all muted',  seqState.muted[3], true);
}

/* ── momentary: tap vs hold ───────────────────────────────────────────────── */
{
    _log('\nmomentary tap vs hold:');
    const { momentaryDownAt, momentaryUpAt, momentaryGesture, resetMomentary } =
        await import('../dist/esm/seq/momentary.js');

    let restored = 0;
    const restore = () => { restored++; };

    // Quick tap (< 94 ticks elapsed) → latch, restore NOT called.
    resetMomentary();
    momentaryDownAt(40, 100, restore);
    eq('tap returns tap', momentaryUpAt(40, 110), 'tap'); // 10 ticks
    eq('tap does not restore', restored, 0);

    // Hold (>= 94 ticks ~1 s) → revert, restore called.
    resetMomentary();
    momentaryDownAt(40, 100, restore);
    eq('hold returns revert', momentaryUpAt(40, 200), 'revert'); // 100 ticks
    eq('hold restores', restored, 1);

    // 93 ticks is still a tap (one tick below threshold).
    resetMomentary();
    momentaryDownAt(40, 0, restore);
    eq('93 ticks is still tap', momentaryUpAt(40, 93), 'tap');
    eq('93-tick does not restore', restored, 1);

    // 94 ticks exactly → revert.
    resetMomentary();
    momentaryDownAt(40, 0, restore);
    eq('94 ticks is hold', momentaryUpAt(40, 94), 'revert');
    eq('94-tick restores', restored, 2);

    // Gesture while held → revert even on a quick release.
    resetMomentary();
    momentaryDownAt(40, 100, restore);
    momentaryGesture();
    eq('gesture returns revert', momentaryUpAt(40, 105), 'revert'); // 5 ticks
    eq('gesture restores', restored, 3);

    // Up for a different button is ignored.
    resetMomentary();
    momentaryDownAt(40, 100, restore);
    eq('other-button up none', momentaryUpAt(58, 200), 'none');
    eq('other-button up ignored', restored, 3);
}

/* ── seqRestoreWatch: restores watchTrack + barOffset ───────────────────── */
{
    _log('\nseqRestoreWatch:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { seqRestoreWatch } = await import('../dist/esm/seq/router.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqState.watchTrack = 2;
    seqState.barOffset  = 3;

    seqRestoreWatch(0);
    eq('watchTrack restored to 0', seqState.watchTrack, 0);
    eq('barOffset reset to 0',     seqState.barOffset,  0);
    const cmds = peekSeqCmdQueue();
    eq('watch cmd emitted', cmds.some(c => c === 'watch 0'), true);

    // Calling with same track still resets barOffset and emits watch.
    resetSeqEngine();
    seqState.watchTrack = 1; seqState.barOffset = 2;
    seqRestoreWatch(1);
    eq('same track: barOffset reset', seqState.barOffset, 0);
    eq('same track: watch emitted',   peekSeqCmdQueue().some(c => c === 'watch 1'), true);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}

/* ── selected-note entry (a step press places the full white selection) ───── */
{
    _log('\nseq selected-note entry:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { setHeldSet } = await import('../dist/esm/seq/held.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;
    const lastOp = () => engine.ops[engine.ops.length - 1];

    // Select a 3-note chord (white selection), then enter with no pads held.
    setHeldSet(0, [60, 64, 67]);
    seqState.lastVel[0] = 100;
    seqState.lastPitch[0] = 60;
    seqHandleMidi([0x90, 16 + 2, 127], false);
    seqHandleMidi([0x80, 16 + 2, 0], false);
    seqEngineTick();
    eq('step press enters full selection', lastOp(), 'tog 0 2 60 100 64 100 67 100');

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}

/* ── step-row length span ────────────────────────────────────────────────── */
{
    _log('\nstep-row length span:');
    const { lengthSpanColor } = await import('../dist/esm/seq/leds.js');
    const { C_LIGHTGREY, C_DARKGREY, trackColorDim } = await import('../dist/esm/seq/colors.js');
    // held abs step 2, length 4 → steps 3,4,5 are span (light-grey), step 2 is the held note.
    eq('span step light-grey', lengthSpanColor(4, 2, 4, 0), C_LIGHTGREY); // absStep 4 within [3,5]
    eq('last span step light-grey', lengthSpanColor(5, 2, 4, 0), C_LIGHTGREY);
    eq('held step not span', lengthSpanColor(2, 2, 4, 0), -1);          // -1 = "not a span step"
    eq('past span', lengthSpanColor(6, 2, 4, 0), -1);
    eq('1-step note has no tail', lengthSpanColor(3, 2, 1, 0), -1);
    eq('no hold', lengthSpanColor(4, -1, 0, 0), -1);
    // The tail must be visually distinct from in-clip dim and out-of-clip dark-grey.
    eq('tail grey differs from in-clip dim', C_LIGHTGREY !== trackColorDim(0), true);
    eq('tail grey differs from out-of-clip dark-grey', C_LIGHTGREY !== C_DARKGREY, true);
}

/* ── hold-A-press-B length gesture ──────────────────────────────────────── */
{
    _log('\nhold-A-press-B length:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { editStepDown, setLengthTo, heldStepAbs, resetStepEdit } = await import('../dist/esm/seq/step-edit.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.barOffset = 0; seqState.watchLane = -1; seqState.watchTrack = 0;

    editStepDown(2);                  // hold step 2 (abs 2)
    eq('heldStepAbs is 2', heldStepAbs(), 2);
    setLengthTo(6);                   // press step 6 → length 4 steps = 96 ticks
    eq('slen emitted', peekSeqCmdQueue().some(c => c === 'slen 0 2 2 -1 96'), true);
    resetStepEdit();
    editStepDown(4);
    eq('B<=A is no-op', setLengthTo(4), false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── playhead position ───────────────────────────────────────────────────── */
{
    _log('\nplayhead position:');
    const { playheadX } = await import('../dist/esm/seq/render.js');
    const W = 128;
    eq('start at 0', playheadX(0, 32, W), 0);
    eq('mid', playheadX(16 * 24, 32, W), 64);   // half of a 32-step clip
    eq('clamps to width-1', playheadX(999999, 32, W), W - 1);
    eq('empty clip → 0', playheadX(0, 0, W), 0);
}

/* ── batch3 status mirror ────────────────────────────────────────────────── */
{
    _log('\nbatch3 status mirror:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=1 tick=10 step=2 pos=53 len=32 hlen=4 occ=' + '0'.repeat(64));
    eq('posTick parsed', seqState.posTick, 53);
    eq('holdLen parsed', seqState.holdLen, 4);
    parseStatusForTest('hnotes=60.64.67');
    eq('holdNotes parsed (3 pitches)', seqState.holdNotes.length, 3);
    eq('holdNotes[0] = 60', seqState.holdNotes[0], 60);
    parseStatusForTest('hnotes=');
    eq('holdNotes empty string clears array', seqState.holdNotes.length, 0);
}

/* ── visual metronome helper ─────────────────────────────────────────────── */
{
    _log('\nvisual metronome:');
    const { metronomeStep } = await import('../dist/esm/seq/leds.js');

    eq('beat0 lights step 0',  metronomeStep(0, 0),       true);
    eq('beat0 lights step 3',  metronomeStep(3, 0),       true);
    eq('beat0 dark step 4',    metronomeStep(4, 0),       false);
    eq('beat1 lights step 4',  metronomeStep(4, 96),      true);
    eq('beat3 lights step 12', metronomeStep(12, 96 * 3), true);
    eq('wraps to beat0 at 4 beats', metronomeStep(0, 96 * 4), true);
}

/* ── big font (preset value) ───────────────────────────────────────────── */
_log('\nTest: big preset font metrics');
{
    const { fontWidthBig, BIG_FONT_HEIGHT } = await import('../dist/esm/font/big.js');
    eq('big font cap-height = 11', BIG_FONT_HEIGHT, 11);
    // Up to 3 preset digits must fit the 32px knob cell (else small-font fallback).
    eq('3 digits fit the cell', fontWidthBig('888') <= 32, true);
}

/* ── preset knob render style ──────────────────────────────────────────── */
_log('\nTest: preset param uses the preset render style');
{
    // obxd_like has 8 root knobs (= KNOBS_PER_PAGE), so the preset gets its own
    // page 0; rows[0][0] is the preset param.
    const vm = bootModel(MOCK_SYNTHS.obxd_like).getViewModel();
    eq('preset knob renderStyle = preset', vm.rows[0][0]?.renderStyle, 'preset');
}

/* ── model exposes per-knob param info for automation ────────────────────── */
_log('\nTest: getKnobParamInfo');
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    const info = m.getKnobParamInfo(0);
    eq('param info present', info !== null, true);
    eq('param info has key', typeof info.key, 'string');
    eq('param info has target', info.target, 'synth');
    eq('param info has automatable flag', typeof info.automatable, 'boolean');
    // Out-of-range knob → null.
    eq('out-of-range knob → null', m.getKnobParamInfo(99), null);
}

/* ── viewmodel carries automation fields ─────────────────────────────────── */
_log('\nTest: viewmodel automation fields');
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    const firstKey = m.getKnobParamInfo(0)?.key;
    // Lane 0 bound to the first param's key, with a lock present.
    const auto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map(),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const vm = m.getViewModel(auto);
    const pv = vm.rows[0][0];
    eq('first param automated dot set', pv.automated, true);
    eq('viewmodel exposes automationHeld', vm.automationHeld, false);
    // No-arg getViewModel → no automation.
    eq('default vm: not automated', m.getViewModel().rows[0][0].automated, false);

    // Held step with a lock on lane 0: the param shows its held-step value
    // INVERTED (touched) instead of the name — even though no knob is physically
    // touched. This is what keeps an automated param highlighted while the step
    // stays held (e.g. after releasing the knob).
    const p0 = m.getKnobParamInfo(0);
    const heldAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: true, poolFull: false,
        heldValues: new Map([[0, p0.max]]),   // lane 0 locked to its max at this step
        liveValues: new Map(),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const heldVm = m.getViewModel(heldAuto).rows[0][0];
    eq('held param shows as touched (not the name)', heldVm.touched, true);
    // displayValue is the held-step value, not the param's short name.
    eq('held param shows a value, not its name', heldVm.displayValue !== heldVm.shortName, true);
    // The on-screen knob ARC must also follow the held value (base cutoff=0.70,
    // held=max=1.0): editing automation moves the knob, like normal editing.
    eq('held param knob arc follows held value (max → nv≈1)',
        Math.round(heldVm.normalizedValue * 100), 100);

    // Live record (no step held): a knob being turned reports a live value; the
    // arc follows it and the cell shows touched, exactly like normal editing.
    const liveAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map([[0, p0.max]]),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const liveVm = m.getViewModel(liveAuto).rows[0][0];
    eq('live-record param knob arc follows live value (max → nv≈1)',
        Math.round(liveVm.normalizedValue * 100), 100);
    eq('live-record param shows as touched', liveVm.touched, true);
}

/* ── automation: registry + lane assignment ──────────────────────────────── */
_log('\nautomation registry:');
{
    const {
        resetAutomation, laneForParam, assignLane, norm7, denorm7,
    } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    eq('norm7 mid → 64', norm7(1, 0, 2), 64);
    eq('denorm7 max → 2', denorm7(127, 0, 2), 2);

    const info = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    const lane = assignLane(0, 0, info, () => true);
    eq('first lane assigned', lane, 0);
    eq('lane lookup by target:param', laneForParam(0, 'synth:cutoff'), 0);
    // alabel + abase queued for the engine.
    const q = peekSeqCmdQueue().join('|');
    eq('alabel queued', q.includes('alabel 0 0 synth:cutoff'), true);
    eq('abase queued', q.includes('abase 0 0 64'), true);
    // Re-assigning the same param returns the same lane.
    eq('same param → same lane', assignLane(0, 0, info, () => true), 0);
    // Pool of 8: filling all returns -1.
    for (let i = 1; i < 8; i++) assignLane(0, 0, { ...info, key: 'k' + i }, () => true);
    eq('pool full → -1', assignLane(0, 0, { ...info, key: 'k8' }, () => true), -1);
}

/* ── automation: knob-turn routing (hold-step / Rec / base) ──────────────── */
_log('\nautomation knob routing:');
{
    const { resetAutomation, handleAutomationKnob, automationKnobReleased, liveTurnValues } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    // Step-automation mode: knob turn writes a lock at the held step.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    eq('step-auto knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('aset at held step 4', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 4 ')), true);

    // Non-automatable param is never consumed.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    eq('non-automatable not consumed',
        handleAutomationKnob(0, 0, { ...info, automatable: false }, +1, () => true), false);

    // Normal mode (no step-auto, no Rec): not consumed → normal param path edits
    // the base immediately (no lag).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    eq('normal-mode knob not consumed (even if a lane)',
        handleAutomationKnob(0, 0, info, +1, () => true), false);

    // Rec-armed + playing → lock at the current playing step.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 7;
    eq('rec knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('aset at playing step 7', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 7 ')), true);
    resetSeqState();

    // Live-recorded automation latches: releasing the knob does NOT revert the
    // param to base — the recorded lock holds until its end trigger.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 7;
    handleAutomationKnob(0, 0, info, +1, () => true);   // assigns lane 0, records lock
    const beforeLen = peekSeqCmdQueue().length;
    automationKnobReleased(0, 0, info);
    const afterRelease = peekSeqCmdQueue().slice(beforeLen);
    eq('recorded-lane release issues no abase revert',
        afterRelease.some((o) => o.startsWith('abase 0 0')), false);
    resetSeqState();

    // Live take: the on-screen knob follows the turn (a live value exists for the
    // lane), then snaps back to base on release (the live value is cleared).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 3;
    handleAutomationKnob(0, 0, info, +5, () => true);
    eq('live take exposes a live knob value while turning', liveTurnValues(0).has(0), true);
    automationKnobReleased(0, 0, info);
    eq('release clears the live knob value (knob snaps to base)', liveTurnValues(0).has(0), false);
    resetSeqState();

    // A live take must ACCUMULATE across playback steps. The status poll clears
    // heldLocks each tick (no step held), and the playhead advances every step;
    // if the live seed came from heldLocks / a per-step context it would reset to
    // base on every turn (the "feedback loop back to the original position" bug).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true;
    seqState.curStep = 2;
    handleAutomationKnob(0, 0, info, +5, () => true);
    const v1 = liveTurnValues(0).get(0);
    seqState.heldLocks.clear();            // simulate the ~24Hz hauto poll wiping it
    seqState.curStep = 3;                  // playhead advanced to the next step
    handleAutomationKnob(0, 0, info, +5, () => true);
    const v2 = liveTurnValues(0).get(0);
    eq('live take accumulates across steps (not reset to base)', v2 > v1, true);
    eq('live take accumulated by both deltas', v2 - v1, 5);
    resetSeqState();

    // Step-automation does NOT leak a live value (held path drives the knob via
    // heldLocks instead, so the knob doesn't snap back while the step is held).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    handleAutomationKnob(0, 0, info, +1, () => true);
    eq('step-auto turn does not set a live value', liveTurnValues(0).has(0), false);
    resetSeqState();
}

/* ── Clear + automation-knob clear must not delete the clip ──────────────── */
_log('\nclear + automation knob:');
{
    const { deleteButton, markDeleteActed, resetEditOps } =
        await import('../dist/esm/seq/edit-ops.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    resetEditOps(); resetSeqEngine();
    deleteButton(true);            // hold Clear
    markDeleteActed();             // automation-knob clear acted
    deleteButton(false);           // release Clear
    eq('clear+automation-knob does not delete clip',
        peekSeqCmdQueue().some((o) => o.startsWith('clipdel')), false);
}

/* ── toast shows a flat ~1.5s regardless of requested ttl ────────────────── */
_log('\ntoast duration:');
{
    const { seqToast, seqToastActive, seqToastTick, resetSeqToast } =
        await import('../dist/esm/seq/render.js');
    resetSeqToast();
    seqToast('hi', 10);            // request a short ttl (ignored)
    let ticks = 0;
    while (seqToastActive()) { seqToastTick(); ticks++; if (ticks > 1000) break; }
    eq('toast shows ~1.5s (>=250 ticks) regardless of requested ttl', ticks >= 250, true);
}

/* ── duplicate gesture (Copy held → source → dest, replace) ──────────────── */
_log('\nduplicate gesture:');
{
    const { copyButton, onUnit, dupActive, resetDuplicate } =
        await import('../dist/esm/seq/duplicate.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');

    // Clip: copy source slot, paste-replace at dest (cross-track), source stays armed.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    eq('dup active while held', dupActive(), true);
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    onUnit({ kind: 'clip', track: 1, slot: 3 });
    onUnit({ kind: 'clip', track: 2, slot: 5 }); // second dest — source still armed
    const q = peekSeqCmdQueue();
    eq('clip copy emitted', q.includes('clipcopy 0 0'), true);
    eq('clip paste 1', q.includes('clippaste 1 3'), true);
    eq('clip paste 2 (armed)', q.includes('clippaste 2 5'), true);
    copyButton(false);
    eq('dup inactive after release', dupActive(), false);

    // Step: cpy single step, pst at dest.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'step', track: 0, step: 2 });
    onUnit({ kind: 'step', track: 0, step: 9 });
    const qs = peekSeqCmdQueue();
    eq('step copy', qs.includes('cpy 0 2 2'), true);
    eq('step paste', qs.includes('pst 0 9'), true);
    copyButton(false);

    // Bar: cpy the 16-step bar range, pst at dest bar start.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'bar', track: 0, bar: 0 });
    onUnit({ kind: 'bar', track: 0, bar: 2 });
    const qb = peekSeqCmdQueue();
    eq('bar copy', qb.includes('cpy 0 0 15'), true);
    eq('bar paste', qb.includes('pst 0 32'), true);
    copyButton(false);

    // No source captured yet → a press is the source, not a paste.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'clip', track: 0, slot: 1 });
    eq('first press is copy not paste',
        peekSeqCmdQueue().some((o) => o.startsWith('clippaste')), false);
    copyButton(false);

    // onUnit ignored when not held.
    resetDuplicate(); resetSeqEngine();
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    eq('onUnit no-op when not held', peekSeqCmdQueue().length, 0);
}

/* ── automation: hold+knob gesture enters step-auto, release is not a tap ─── */
_log('\nautomation gesture (tap vs hold):');
{
    const { resetAutomation, handleAutomationKnob } = await import('../dist/esm/seq/automation.js');
    const { editStepDown, editStepUp, endStepAutomation, resetStepEdit } =
        await import('../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    editStepDown(0);                         // hold step 0 (barOffset 0)
    eq('not step-auto until a gesture', seqState.stepAutoMode, false);
    eq('hold+knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('entered step-auto mode', seqState.stepAutoMode, true);
    eq('aset at held step 0', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 0 ')), true);
    eq('release after step-auto is NOT a tap', editStepUp(0), false);

    // A plain tap (no knob, no hold) stays a tap → toggles a note.
    resetStepEdit(); resetSeqState();
    editStepDown(1);
    eq('plain press is still a tap', editStepUp(1), true);

    // endStepAutomation clears the mode + held snapshot.
    seqState.stepAutoMode = true; seqState.heldLocks.set(0, 50);
    endStepAutomation();
    eq('endStepAutomation clears mode', seqState.stepAutoMode, false);
    eq('endStepAutomation clears heldLocks', seqState.heldLocks.size, 0);
}

/* ── automation: tap a knob (no turn) in step-auto clears that step ───────── */
_log('\nautomation tap-to-clear:');
{
    const { resetAutomation, handleAutomationKnob, automationKnobTouched, automationKnobReleased } =
        await import('../dist/esm/seq/automation.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    handleAutomationKnob(0, 0, info, +1, () => true);    // create a lock by turning
    eq('lock present after a turn', seqState.heldLocks.has(0), true);

    // Tap = touch then release without turning → clears this step's lock.
    resetSeqEngine();
    automationKnobTouched(0);
    automationKnobReleased(0, 0, info);
    eq('tap queues aclrs at held step', peekSeqCmdQueue().some((o) => o.startsWith('aclrs 0 0 4')), true);
    eq('tap clears the optimistic held lock', seqState.heldLocks.has(0), false);

    // Touch + turn is NOT a tap → no clear.
    resetSeqEngine();
    automationKnobTouched(0);
    handleAutomationKnob(0, 0, info, +1, () => true);
    automationKnobReleased(0, 0, info);
    eq('touch+turn does not clear', peekSeqCmdQueue().some((o) => o.startsWith('aclrs')), false);
    resetSeqState();
}

/* ── automation: holding a bar in Loop mode sets the whole bar ────────────── */
_log('\nautomation bar-range (Loop mode):');
{
    const { resetAutomation, handleAutomationKnob } = await import('../dist/esm/seq/automation.js');
    const { editStepDown, resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.loopMode = true;
    editStepDown(1);                         // hold bar 1 → range steps 16..31
    eq('bar-knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('writes asetr across the bar', peekSeqCmdQueue().some((o) => o.startsWith('asetr 0 0 16 31 ')), true);
    eq('no single-step aset for a bar', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 ')), false);
    resetSeqState(); resetStepEdit();
}

/* ── automation: held-step display change detection (repaint trigger) ─────── */
_log('\nautomation display-dirty:');
{
    const { resetAutomation, automationDisplayDirty, handleAutomationKnob, automationKnobReleased } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    resetAutomation(); resetSeqState();
    eq('idle: not dirty', automationDisplayDirty(), false);

    seqState.stepAutoMode = true;
    eq('enter step-auto → dirty', automationDisplayDirty(), true);
    eq('unchanged → not dirty', automationDisplayDirty(), false);

    seqState.heldLocks.set(0, 100);          // a lock appears at the held step
    eq('new lock → dirty', automationDisplayDirty(), true);

    seqState.heldLocks.set(0, 50);           // turning the knob changes the value
    eq('lock value change → dirty', automationDisplayDirty(), true);
    eq('same value again → not dirty', automationDisplayDirty(), false);

    seqState.stepAutoMode = false;           // release the step
    eq('exit step-auto → dirty', automationDisplayDirty(), true);
    resetAutomation(); resetSeqState();

    // Live record (NOT step-auto): turning a knob must ALSO trigger a repaint so
    // the on-screen arc/value follows the live take; release snaps back to base
    // (also a repaint). Without this, the screen stays frozen while turning.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    const liveInfo = { gi: 0, key: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    seqState.recording = true; seqState.playing = true; seqState.curStep = 2;
    automationDisplayDirty();                 // settle the baseline signature
    handleAutomationKnob(0, 0, liveInfo, +5, () => true);
    eq('live take knob turn → dirty', automationDisplayDirty(), true);
    eq('live take unchanged → not dirty', automationDisplayDirty(), false);
    automationKnobReleased(0, 0, liveInfo);
    eq('live take release (snap to base) → dirty', automationDisplayDirty(), true);
    resetAutomation(); resetSeqEngine(); resetSeqState();
}

/* ── automation: label re-sync from engine ───────────────────────────────── */
_log('\nautomation label sync:');
{
    const { resetAutomation, syncLabelsFromEngine, laneForParam, clearLane } =
        await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    const applied = [];
    syncLabelsFromEngine(
        '-.synth:cutoff.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-',
        (slot, lane, tp) => applied.push(slot + ':' + lane + ':' + tp),
        () => ({ min: 0, max: 1, type: 'float' }),
    );
    eq('label synced into registry', laneForParam(0, 'synth:cutoff'), 1);
    eq('re-applied knob mapping', applied.includes('0:1:synth:cutoff'), true);
    // Clear frees the lane.
    clearLane(0, 1);
    eq('cleared lane gone', laneForParam(0, 'synth:cutoff'), -1);
}

/* ── Summary ─────────────────────────────────────────────────────────────── */

_log('');
if (failures === 0) {
    _log('\x1b[32m\x1b[1mALL LOGIC CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} LOGIC CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
