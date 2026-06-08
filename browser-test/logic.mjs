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
