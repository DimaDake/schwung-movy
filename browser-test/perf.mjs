#!/usr/bin/env node
/* browser-test/perf.mjs — performance regression tests, no device required.
 *
 * Measures fill_rect call count per render and shadow_get_param call count
 * per refresh cycle. Fails with exit 1 if any threshold is exceeded.
 *
 * Usage:
 *   cd movy
 *   node browser-test/perf.mjs
 */

import { performance } from 'perf_hooks';
import { createModel }     from '../dist/esm/model/index.js';
import { renderKnobsView } from '../dist/esm/renderer/knob-view.js';
import { MOCK_SYNTHS }     from './mock-synth.mjs';

/* ── Thresholds ──────────────────────────────────────────────────────────── */

/* fill_rect calls per full renderKnobsView (8-knob page, all arc knobs).
 * Baseline: 520 (test16, arc knobs). Threshold allows ~3× before failing.
 * Catches someone adding a per-pixel inner loop or doubling the draw calls. */
const FILL_RECT_PER_RENDER_MAX = 1500;

/* shadow_get_param calls accumulated during a single processTick refresh
 * window (69 ticks). Baseline: 16 (one read per param, test16 has 16 params).
 * Allows up to 2.5× to accommodate synths with more params; catches O(n²). */
const GET_PARAM_PER_REFRESH_MAX = 40;

/* Median renderKnobsView wall-clock time (ms) in Node.js V8 with a no-op
 * fill_rect. Baseline: ~0.004ms. Threshold is generous (V8 is much faster
 * than device QuickJS) but catches catastrophic JS algorithmic regressions. */
const RENDER_MEDIAN_MS_MAX = 2;

/* ── Globals ─────────────────────────────────────────────────────────────── */

let fillRectCount = 0;
let getParamCount = 0;

let mockState = {};

globalThis.fill_rect          = () => { fillRectCount++; };
globalThis.clear_screen       = () => {};
globalThis.shadow_get_param   = (_s, key) => { getParamCount++; return mockState[key] ?? null; };
globalThis.shadow_set_param   = (_s, key, val) => { mockState[key] = val; return true; };
globalThis.shadow_get_ui_slot = () => 0;
globalThis.host_read_file     = () => null;
globalThis.setLED             = () => {};
globalThis.setButtonLED       = () => {};
globalThis.MoveKnob1          = 71;

/* Suppress device-only log output during tests */
const _origLog = console.log.bind(console);
console.log = (...args) => {
    const s = args[0];
    if (typeof s === 'string' && s.startsWith('[movy]')) return;
    _origLog(...args);
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

let failures = 0;

function pass(label, detail) { _origLog(`  \x1b[32m✓\x1b[0m ${label}${detail ? '  (' + detail + ')' : ''}`); }
function fail(label, detail) { _origLog(`  \x1b[31m✗\x1b[0m ${label}${detail ? '  (' + detail + ')' : ''}`); failures++; }

function check(label, value, max, unit = '') {
    const ok = value <= max;
    const detail = `${value}${unit} <= ${max}${unit}`;
    if (ok) pass(label, detail); else fail(label, `${value}${unit} exceeds ${max}${unit}`);
}

function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── Test 1: fill_rect calls per renderKnobsView ─────────────────────────── */

_origLog('\nTest 1: fill_rect calls per renderKnobsView (test16, 8 arc knobs)');

{
    mockState = { ...MOCK_SYNTHS.test16 };
    const model = createModel(0, 'synth');

    /* Tick once so hierarchy loads; the initial immediate refresh also fires. */
    getParamCount = 0;
    model.tick();

    const vm = model.getViewModel();
    fillRectCount = 0;
    renderKnobsView(vm, false);

    check('fill_rect calls', fillRectCount, FILL_RECT_PER_RENDER_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls)`);
}

/* ── Test 2: shadow_get_param calls in one refresh window ────────────────── */

_origLog('\nTest 2: shadow_get_param calls during 69-tick refresh window (test16)');

{
    mockState = { ...MOCK_SYNTHS.test16 };
    const model = createModel(0, 'synth');

    /* Tick 1 loads hierarchy and fires an initial immediate refresh. */
    model.tick();

    /* Ticks 2–70: the next scheduled refresh fires on tick 70 (KNOB_REFRESH_TICKS=69
     * decrements from 69 to 0 across 69 more ticks). Count all getParam calls. */
    getParamCount = 0;
    for (let i = 0; i < 69; i++) model.tick();

    /* pollModuleName fires at tick 344, well outside this window. */
    check('shadow_get_param calls in refresh window', getParamCount, GET_PARAM_PER_REFRESH_MAX);
    _origLog(`    (baseline: ${getParamCount} calls for ${model.getViewModel().rows.flat().filter(Boolean).length} visible params)`);
}

/* ── Test 3: renderKnobsView median wall-clock time (Node.js V8) ─────────── */

_origLog('\nTest 3: renderKnobsView median time — Node.js V8 (no-op fill_rect)');

{
    mockState = { ...MOCK_SYNTHS.test16 };
    const model = createModel(0, 'synth');
    model.tick();
    const vm = model.getViewModel();

    /* Warm up JIT */
    for (let i = 0; i < 20; i++) renderKnobsView(vm, false);

    const REPS = 200;
    const times = [];
    for (let i = 0; i < REPS; i++) {
        const t0 = performance.now();
        renderKnobsView(vm, false);
        times.push(performance.now() - t0);
    }

    const med = median(times);
    check('median renderKnobsView time', med.toFixed(3), RENDER_MEDIAN_MS_MAX, 'ms');
    _origLog(`    (baseline: ${med.toFixed(3)}ms median, ${Math.max(...times).toFixed(3)}ms worst)`);
}

/* ── Test 4: fill_rect calls with enum knobs (different render path) ─────── */

_origLog('\nTest 4: fill_rect calls per renderKnobsView (test_enum)');

{
    mockState = { ...MOCK_SYNTHS.test_enum };
    const model = createModel(0, 'synth');
    model.tick();
    const vm = model.getViewModel();

    fillRectCount = 0;
    renderKnobsView(vm, false);

    check('fill_rect calls (enum view)', fillRectCount, FILL_RECT_PER_RENDER_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls)`);
}

/* ── Summary ─────────────────────────────────────────────────────────────── */

_origLog('');
if (failures === 0) {
    _origLog('\x1b[32m\x1b[1mALL PERF CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _origLog(`\x1b[31m\x1b[1m${failures} PERF CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
