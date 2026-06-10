#!/usr/bin/env node
/* browser-test/logic.mjs — pure viewmodel/logic tests, no device or screenshots.
 *
 * Tests business invariants on the model and viewmodel layer.
 * Run from movy root: node browser-test/logic.mjs
 */

import { createModel }    from '../dist/esm/model/index.js';
import { MOCK_SYNTHS }    from './mock-synth.mjs';

/* ── Mock globals ─────────────────────────────────────────────────────────── */

let mockState = {};

globalThis.fill_rect          = () => {};
globalThis.clear_screen       = () => {};
globalThis.shadow_get_param   = (_s, key) => mockState[key] ?? null;
globalThis.shadow_set_param   = (_s, key, val) => { mockState[key] = val; return true; };
globalThis.shadow_get_ui_slot = () => 0;
globalThis.host_read_file     = () => null;
globalThis.setLED             = () => {};
globalThis.setButtonLED       = () => {};
globalThis.MoveKnob1          = 71;

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
    mockState = { ...preset };
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
    eq('file overlay: committed to shadow', mockState['synth:sample'], '/data/UserData/Samples/snare.wav');
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

/* ── Summary ─────────────────────────────────────────────────────────────── */

_log('');
if (failures === 0) {
    _log('\x1b[32m\x1b[1mALL LOGIC CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} LOGIC CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
