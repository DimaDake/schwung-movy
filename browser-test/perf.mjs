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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel }     from '../dist/esm/model/index.js';
import { renderKnobsView } from '../dist/esm/renderer/knob-view.js';
import { buildMainPageVM } from '../dist/esm/seq/main-page-vm.js';
import { mainPageState, resetMainPage } from '../dist/esm/seq/main-page.js';
import { seqState, resetSeqState } from '../dist/esm/seq/state.js';
import { keyboardState } from '../dist/esm/keyboard/state.js';
import { MOCK_SYNTHS }     from './mock-synth.mjs';

/* ── Thresholds ──────────────────────────────────────────────────────────── */

/* fill_rect calls per full renderKnobsView (8-knob page, all arc knobs).
 * Baseline: 520 (test16, arc knobs). Threshold allows ~3× before failing.
 * Catches someone adding a per-pixel inner loop or doubling the draw calls. */
const FILL_RECT_PER_RENDER_MAX = 1500;

/* Max shadow_get_param calls in any single tick over a 70-tick window.
 * After staggered refresh: 1 GET per tick (cursor advances one position).
 * Threshold 2 allows for rounding/off-by-one while catching any bulk-refresh
 * regression (old code fired 16 GETs on the scheduled tick). */
const GET_PARAM_PER_TICK_MAX = 2;

/* Median renderKnobsView wall-clock time (ms) in Node.js V8 with a no-op
 * fill_rect. Baseline: ~0.004ms. Threshold is generous (V8 is much faster
 * than device QuickJS) but catches catastrophic JS algorithmic regressions. */
const RENDER_MEDIAN_MS_MAX = 2;

/* Median buildViewModel() time (ms) for the most param-dense module in the
 * fleet (helm, ~400 knob slots). Only this path scales with param count; the
 * per-tick param refresh is a fixed-cost cursor. */
const VM_MEDIAN_MS_MAX = 1;

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

/* ── Test 2: max shadow_get_param calls in any single tick ───────────────── */

_origLog('\nTest 2: max shadow_get_param calls in any single tick (test16, 70 ticks)');

{
    mockState = { ...MOCK_SYNTHS.test16 };
    const model = createModel(0, 'synth');

    /* Tick 1 loads hierarchy; its GETs are excluded from per-tick measurement. */
    model.tick();

    /* Ticks 2–71: measure the maximum GETs seen in any single tick.
     * Old code: tick 70 fires refreshKnobValues for all 16 params → 16 GETs.
     * New code (staggered): every tick does exactly 1 GET → max = 1. */
    let maxGetsInOneTick = 0;
    for (let i = 0; i < 70; i++) {
        getParamCount = 0;
        model.tick();
        if (getParamCount > maxGetsInOneTick) maxGetsInOneTick = getParamCount;
    }

    check('max shadow_get_param calls per tick', maxGetsInOneTick, GET_PARAM_PER_TICK_MAX);
    _origLog(`    (baseline: ${maxGetsInOneTick} max calls in any single tick)`);
}

/* ── Test 2b: automation lanes are decoupled from playback ───────────────── */
/* The param page must NOT read back an automation lane's synth value, so
 * automation playback (and live recording) cause zero page repaints and there
 * is no read-back feedback loop. */
_origLog('\nTest 2b: automation lanes never repaint the page (no feedback loop)');
{
    mockState = { ...MOCK_SYNTHS.test16 };
    const probe = createModel(0, 'synth');
    probe.tick();
    const key = probe.getKnobParamInfo(0).key;
    const synthKey = 'synth:' + key;

    // Count read-backs of THIS param specifically across many ticks while its
    // synth value is jerked by automation every tick.
    const origGet = globalThis.shadow_get_param;
    const runReads = (model) => {
        let reads = 0;
        globalThis.shadow_get_param = (s, k) => { if (k === synthKey) reads++; return mockState[k] ?? null; };
        for (let i = 0; i < 80; i++) {
            mockState[synthKey] = String(i % 2 ? 0.1 : 0.9);  // automation jerks it
            model.tick();
        }
        globalThis.shadow_get_param = origGet;
        return reads;
    };

    // Suppressed (it's an automation lane) → never read back → no feedback loop.
    mockState = { ...MOCK_SYNTHS.test16 };
    const model = createModel(0, 'synth');
    model.tick();
    model.setNoRefreshKeys([key]);
    for (let i = 0; i < 5; i++) model.tick();
    const before = model.getKnobParamInfo(0).value;
    const suppressedReads = runReads(model);
    const after = model.getKnobParamInfo(0).value;
    check('automation lane is never read back (no feedback loop)', suppressedReads, 0);
    check('suppressed lane holds the UI base value', before === after ? 0 : 1, 0);

    // Contrast: an un-suppressed param IS read back as it changes — proving the
    // suppression is what eliminates the loop.
    mockState = { ...MOCK_SYNTHS.test16 };
    const ctrl = createModel(0, 'synth');
    ctrl.tick();
    for (let i = 0; i < 5; i++) ctrl.tick();
    const ctrlReads = runReads(ctrl);
    check('contrast: un-suppressed param IS read back', ctrlReads > 0 ? 0 : 1, 0);
    _origLog(`    (suppressed reads=${suppressedReads}, un-suppressed reads=${ctrlReads})`);
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

/* ── Test 3b: param-heavy module (helm: ~400 knob slots over 30 pages) ───── */

_origLog('\nTest 3b: helm-scale module (full ui_hierarchy traversal)');

{
    /* Real captured helm params, flattened the way the device serves them.
     * Built here rather than via dump-boot.mjs, whose installEnv() would
     * replace this file's counting globals. */
    const helm = JSON.parse(readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dump-extra',
             'sound_generator--helm.json'), 'utf8'));
    mockState = {};
    for (const [k, v] of Object.entries(helm.params)) mockState['synth:' + k] = v;
    mockState['synth_module'] = 'helm';
    mockState['synth:name']   = 'Helm';

    const model = createModel(0, 'synth');
    model.reload();
    model.tick();
    model.tick();
    const paramCount = model.dumpLayout().params.filter(Boolean).length;
    _origLog(`    (${paramCount} params, ${model.getViewModel().bankCount} pages)`);

    /* Per-tick IPC must stay flat: refreshOneParam advances a cursor by one
     * regardless of how many params the module has. */
    let maxGets = 0;
    for (let i = 0; i < 70; i++) {
        getParamCount = 0;
        model.tick();
        if (getParamCount > maxGets) maxGets = getParamCount;
    }
    check('helm: max shadow_get_param calls per tick', maxGets, GET_PARAM_PER_TICK_MAX);

    /* buildViewModel maps over every param (viewmodel.ts allValues), so it is
     * the one path that grows with param count. */
    for (let i = 0; i < 20; i++) model.getViewModel();
    const times = [];
    for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        model.getViewModel();
        times.push(performance.now() - t0);
    }
    const med = median(times);
    check('helm: buildViewModel median', +med.toFixed(3), VM_MEDIAN_MS_MAX, 'ms');
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

/* ── Test 4b: Main Params page (4-knob Tempo/Swing/Root/Key view) ──────────── */

_origLog('\nTest 4b: fill_rect calls per renderKnobsView (main params page)');

{
    /* Initialize sequencer and keyboard state. */
    resetSeqState();
    resetMainPage();
    keyboardState.rootNote = 60;
    keyboardState.scale = 0;
    seqState.bpmX100 = 12000;  // 120 bpm
    seqState.swingPct = 50;

    const vm = buildMainPageVM();

    fillRectCount = 0;
    renderKnobsView(vm, false);

    check('fill_rect calls (main params page)', fillRectCount, FILL_RECT_PER_RENDER_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls — 4 knobs, mostly preset/enum)`);
}

/* ── Test 4c: Main Params page with overlay open (scale selector) ────────── */

_origLog('\nTest 4c: fill_rect calls with overlay open (main params scale list)');

{
    resetSeqState();
    resetMainPage();
    keyboardState.rootNote = 60;
    keyboardState.scale = 0;
    seqState.bpmX100 = 12000;
    seqState.swingPct = 50;

    /* Simulate the scale overlay being open. */
    mainPageState.scaleOverlay = true;
    mainPageState.scaleSel = 5;

    const vm = buildMainPageVM();

    fillRectCount = 0;
    renderKnobsView(vm, false);

    check('fill_rect calls (main params + overlay)', fillRectCount, FILL_RECT_PER_RENDER_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls — 4 cells + scrollable enum overlay)`);
}

/* ── Test 4d: envelope page draws fewer rects than the 4 arc knobs it replaces ── */

_origLog('\nTest 4d: fill_rect calls per renderKnobsView (env_dual, two envelopes)');

/* Each envelope is a handful of 1px lines + dots — one line is cheaper than the
 * 4 arc-knob circle borders it replaces. env_dual has TWO envelopes (both rows)
 * so the whole-page count lands near a full arc page; the bound mainly guards
 * against a regression that fills the area under the curve (would be 1000s). */
const ENVELOPE_FILL_RECT_MAX = 700;

{
    mockState = { ...MOCK_SYNTHS.env_dual };
    const model = createModel(0, 'synth');
    model.tick();

    const vm = model.getViewModel();
    fillRectCount = 0;
    renderKnobsView(vm, false);

    check('fill_rect calls (envelope page)', fillRectCount, ENVELOPE_FILL_RECT_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls — two ADSR envelopes)`);
}

/* ── Test 4e: trigger badge animation costs ──────────────────────────────── */

/* The badge animates itself after a turn: a fired flash, then the re-arm drain.
 * Three ways that could go wrong on device, all asserted here:
 *   1. the frame never stops being dirty  -> permanent repaint loop
 *   2. LED sends every tick while cooling -> blows the idle-LED budget
 *   3. eight badges cost more to draw than eight knobs
 * The drain is quantised to COOL_STEPS precisely so (1) stays bounded. */
_origLog('\nTest 4e: trigger badge animation (flash + drain)');

{
    const { TRIGGER_REARM_MS, TRIGGER_FLASH_MS } = await import('../dist/esm/model/constants.js');

    mockState = { ...MOCK_SYNTHS.triggers };
    const model = createModel(0, 'synth');
    for (let i = 0; i < 20; i++) model.tick();          // settle the hierarchy

    /* Freeze the clock and advance it by hand: one device tick at the measured
     * ~100 Hz is ~10 ms, so the whole flash+drain window is ~90 ticks. */
    const REAL_NOW = Date.now;
    let now = 5_000_000;
    Date.now = () => now;

    let ledCount = 0;
    const realSetLED = globalThis.setLED;
    const realSetButtonLED = globalThis.setButtonLED;
    globalThis.setLED = () => { ledCount++; };
    globalThis.setButtonLED = () => { ledCount++; };

    model.handleKnobDelta(0, 1);                        // fire the trigger

    let dirtyTicks = 0, ledDuringCooling = 0, lastDirtyAt = -1;
    const TICK_MS = 10;
    const windowTicks = Math.ceil((TRIGGER_REARM_MS + TRIGGER_FLASH_MS * 2) / TICK_MS);
    for (let i = 0; i < windowTicks; i++) {
        ledCount = 0;
        const dirty = model.tick();
        if (dirty) { dirtyTicks++; lastDirtyAt = i; }
        if (now - 5_000_000 > TRIGGER_FLASH_MS) ledDuringCooling += ledCount;
        now += TICK_MS;
    }

    /* Bounded: the drain has COOL_STEPS levels, plus the flash edges. Anything
     * near windowTicks means it is repainting every tick. */
    check('dirty ticks across a whole flash+drain', dirtyTicks, 24, ' ticks');
    _origLog(`    (baseline: ${dirtyTicks} dirty of ${windowTicks} ticks in the window)`);

    /* The LED intentionally ignores the drain, so cooling must be silent. */
    check('LED sends while cooling (after the flash)', ledDuringCooling, 0);

    /* And it must actually stop: keep ticking well past the window. */
    let dirtyAfter = 0;
    for (let i = 0; i < 200; i++) { if (model.tick()) dirtyAfter++; now += TICK_MS; }
    check('dirty ticks once re-armed', dirtyAfter, 0, ' ticks');
    _origLog(`    (last dirty tick was #${lastDirtyAt} of ${windowTicks})`);

    globalThis.setLED = realSetLED;
    globalThis.setButtonLED = realSetButtonLED;
    Date.now = REAL_NOW;
}

{
    /* Eight badges on one page vs the arc-knob baseline in Test 1. */
    mockState = { ...MOCK_SYNTHS.triggers_full };
    const model = createModel(0, 'synth');
    for (let i = 0; i < 20; i++) model.tick();
    const vm = model.getViewModel();
    fillRectCount = 0;
    renderKnobsView(vm, false);
    check('fill_rect calls (page of 8 trigger badges)', fillRectCount, FILL_RECT_PER_RENDER_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls)`);
}

/* ── Test 5: sequencer LED cache + IPC + strip budgets ───────────────────── */

_origLog('\nTest 5: sequencer perf budgets');

{
    const { ENGINE_VERSION } = await import('../dist/esm/seq/constants.js');
    globalThis.host_module_set_param = () => true;
    globalThis.host_module_set_param_blocking = () => true;
    globalThis.host_module_get_param = (k) =>
        (k === 'ping' ? 'pong ' + ENGINE_VERSION : k === 'status' ? 'play=1 tick=0' : null);

    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqLedsTick, seqLedsInvalidate } = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../dist/esm/seq/state.js');
    const { drawLoopStrip } = await import('../dist/esm/seq/render.js');

    let ledCount = 0;
    globalThis.setLED = () => { ledCount++; };
    globalThis.setButtonLED = () => { ledCount++; };
    globalThis.move_midi_internal_send = () => { ledCount++; }; // native pad animation

    resetSeqEngine(); resetSeqState(); seqLedsInvalidate();
    seqEngineTick(); seqEngineTick(); // boot + first poll

    // Steady state (nothing changed): the cached LED layer sends nothing.
    // A cold frame paints progressively (FRAME_BUDGET per tick), so warm up a
    // few ticks until fully drained before measuring idle quiescence.
    seqState.lenSteps = 16; occToggleStep(0);
    for (let i = 0; i < 4; i++) seqLedsTick();   // drain cold frame
    ledCount = 0;
    for (let i = 0; i < 50; i++) seqLedsTick();
    check('seq LED sends when idle (50 ticks)', ledCount, 0);

    // Session-mode cold frame must respect the ~60-packet MIDI LED buffer
    // (schwung API.md). Entering session invalidates the cache (note-mode pads
    // are painted via direct setLED, desyncing it), so the next tick repaints
    // every seq LED. A naive paint sends ~80 packets in one tick, overflowing
    // the buffer and silently dropping session pads — which the cache then
    // records as "sent" and never retries (the intermittent "session LEDs
    // don't switch" bug). Budget per-tick sends; the rest drain over next ticks.
    seqState.sessionMode = true;
    seqState.session[0].exist = 0xFF;   // visible grid content for track 0
    seqLedsInvalidate();
    ledCount = 0;
    seqLedsTick();
    check('session cold-frame LED sends per tick', ledCount, 50);
    _origLog(`    (cold session frame: ${ledCount} LED sends)`);
    // Drain: a few ticks finish painting, then steady state sends nothing —
    // proving no changed LED was dropped (all reached the cache). Animated pads
    // need the one-tick base->animation handshake, so allow extra drain ticks.
    for (let i = 0; i < 6; i++) seqLedsTick();
    ledCount = 0;
    seqLedsTick();
    check('session LEDs fully drained (steady 0)', ledCount, 0);
    seqState.sessionMode = false;
    seqState.session[0].exist = 0;
    seqLedsInvalidate();
    seqLedsTick();

    // IPC: at most one set_param flush per tick regardless of queued ops.
    let setParamCalls = 0;
    globalThis.host_module_set_param = () => { setParamCalls++; return true; };
    globalThis.host_module_set_param_blocking = () => { setParamCalls++; return true; };
    const { seqCmd } = await import('../dist/esm/seq/engine.js');
    seqCmd('tog 0 0 60 100'); seqCmd('tog 0 1 62 100'); seqCmd('watch 0');
    setParamCalls = 0;
    seqEngineTick();
    check('seq set_param calls per tick', setParamCalls, 1);

    // Automation ops (aset/abase/alabel) ride the same batched cmd channel —
    // many queued in a tick still flush as ONE set_param (no per-lock IPC spam).
    seqCmd('aset 0 0 4 100'); seqCmd('aset 0 1 4 90'); seqCmd('abase 0 0 64');
    setParamCalls = 0;
    seqEngineTick();
    check('automation ops: one flush per tick', setParamCalls, 1);

    // Loop strip is cheap: bounded fill_rect per draw.
    fillRectCount = 0;
    seqState.lenSteps = 16 * 16; // 16 bars
    drawLoopStrip();
    check('loop strip fill_rect calls', fillRectCount, 40);
    _origLog(`    (strip: ${fillRectCount} fill_rect)`);
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
