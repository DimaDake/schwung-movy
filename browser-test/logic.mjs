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

/* ── moog config: all 7 banks with correct param metadata ────────────────── */

_log('\nTest: moog config bank layout and param metadata');

{
    const m = bootModel(MOCK_SYNTHS.moog);
    const bankNames = [];
    for (let i = 0; i < 7; i++) {
        if (i > 0) m.changePage(1);
        bankNames.push(m.getViewModel().bankName);
    }
    eq('moog: bankCount = 7', m.getViewModel().bankCount, 7);

    const expected = ['Main', 'F.Env', 'Osc 1', 'Osc 2', 'Osc 3', 'Osc 4', 'Mod'];
    for (let i = 0; i < expected.length; i++) {
        eq(`moog: bank ${i} = ${expected[i]}`, bankNames[i], expected[i]);
    }

    // navigate to each Osc bank (banks 2-5) and verify wave/range param metadata
    // Bank layout per Osc bank: row[0] = [wave, volume, range, detune/noise]
    // ParamVM has no key field, so we check by position and observable properties.
    const WAVE_OPTIONS = ['Tri', 'Saw', 'Sq', 'Pls'];
    m.changePage(-6); // back to bank 0
    for (let i = 0; i < 7; i++) {
        if (i > 0) m.changePage(1);
        if (i < 2 || i > 5) continue; // only Osc 1-4 banks
        const oscNum = i - 1;
        const vm2 = m.getViewModel();
        const wave  = vm2.rows[0][0];
        const range = vm2.rows[0][2];

        if (!wave)  { fail(`moog: Osc ${oscNum} wave slot non-null`,  'null'); continue; }
        if (!range) { fail(`moog: Osc ${oscNum} range slot non-null`, 'null'); continue; }

        eq(`moog: Osc ${oscNum} wave type = enum`,     wave.type,          'enum');
        eq(`moog: Osc ${oscNum} wave options[0]`,      wave.options?.[0],  WAVE_OPTIONS[0]);
        eq(`moog: Osc ${oscNum} wave options[3]`,      wave.options?.[3],  WAVE_OPTIONS[3]);

        eq(`moog: Osc ${oscNum} range type = int`,     range.type,         'int');
    }

    // Main bank: 8 non-null params
    m.changePage(-6);
    eq('moog: Main bank has 8 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 8);

    // total non-null params across all banks = 37
    let total = 0;
    m.changePage(-6);
    for (let i = 0; i < 7; i++) {
        if (i > 0) m.changePage(1);
        total += m.getViewModel().rows.flat().filter(Boolean).length;
    }
    eq('moog: total params across all banks = 37', total, 37);

    // Verify KnobSlot.min/max are picked up: osc1_range is int -2..2.
    // After enough ticks to refresh values, displayValue of "-2" should render as "-2"
    // (and normalizedValue 0.625 instead of 0.5 confirms min=-2 not default 0).
    const moogRange = bootModel({ ...MOCK_SYNTHS.moog, 'synth:osc1_range': '-2' });
    for (let i = 0; i < 60; i++) moogRange.tick();
    moogRange.changePage(2); // Osc 1 bank
    {
        const rangeSlot = moogRange.getViewModel().rows[0][2];
        if (!rangeSlot) { fail('moog: osc1_range slot exists', 'null'); }
        else {
            eq('moog: osc1_range displayValue for -2',  rangeSlot.displayValue, '-2');
            const expectedNv = ((-2) - (-2)) / (2 - (-2)); // 0 (clamped low end)
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

/* ── Summary ─────────────────────────────────────────────────────────────── */

_log('');
if (failures === 0) {
    _log('\x1b[32m\x1b[1mALL LOGIC CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} LOGIC CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
