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
import { LONG_PRESS_TICKS } from '../dist/esm/model/constants.js';
import { wavPeaksTick, wavPeaks, resetWavPeaks } from '../dist/esm/model/wav-peaks.js';
import { MOCK_SYNTHS }     from './mock-synth.mjs';

/* ── Thresholds ──────────────────────────────────────────────────────────── */

/* fill_rect calls per full renderKnobsView (8-knob page, all arc knobs).
 * Baseline: 520 (test16, arc knobs). Threshold allows ~3× before failing.
 * Catches someone adding a per-pixel inner loop or doubling the draw calls. */
const WAV_TICK_MAX_MS = 4.0;   // a tick that misses its slot is felt as input lag
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

/* Max shadow_get_param calls for one knob detent, once a gesture is under way.
 * A turn should cost about what a tick costs: it reads the param it is about to
 * change and little else. Anything that scales with the module's param count
 * belongs once per gesture, not per detent — see Test 5. */
const KNOB_DETENT_GETS_MAX = 6;

/* buildViewModel time for a 1024-option enum divided by the same for an 8-option
 * one. Anything that reads the whole option list per frame shows up here as a
 * multiple; 3 leaves room for allocation noise while catching a return to
 * per-frame scanning (which measured ~17x). */
const ENUM_VM_RATIO_MAX = 3;

/* buildViewModel for a page holding a filter pair, on a 400-param module divided
 * by the same on a 16-param one. The page is identical; only the rest of the
 * module grows. The off-page filter-mode search made this ~5x, which is what a
 * dense module (helm, 180 params) paid on every frame of every knob turn. */
const FILTER_VM_RATIO_MAX = 2;

/* Opening the file overlay on a 1024-file folder, divided by the same on a
 * 16-file one. Some growth is inherent — the list really is longer — but the
 * five-pass scan made it ~50x. */
const FILE_OPEN_RATIO_MAX = 12;
/* os.stat calls when opening a 1024-file folder whose entries all match the
 * module's extension filter. Each is a syscall on device; a filtered entry is
 * taken as a file, so this should be nil. */
const FILE_OPEN_STATS_MAX = 8;

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
    let maxGets = 0, totalGets = 0;
    for (let i = 0; i < 70; i++) {
        getParamCount = 0;
        model.tick();
        totalGets += getParamCount;
        if (getParamCount > maxGets) maxGets = getParamCount;
    }
    check('helm: max shadow_get_param calls per tick', maxGets, GET_PARAM_PER_TICK_MAX);
    /* The page-first cursor splits its reads between the current page and the
     * global sweep — it must not ADD IPC, whatever the module's page count. */
    check('helm: avg shadow_get_param calls per tick',
          +(totalGets / 70).toFixed(2), GET_PARAM_PER_TICK_MAX);

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

/* ── Test 4z: chunked WAV peak read — per-TICK cost ──────────────────────── */

_origLog('\nTest 4z: WAV peak read cost per tick (movy\'s tick period is its MIDI sampling interval)');

{
    const FR = 500000;                      // ~11 s of 44.1 kHz mono 16-bit
    const bytes = new Uint8Array(44 + FR * 2);
    const ws = (o, t) => { for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i); };
    const w32 = (o, v) => { bytes[o] = v & 255; bytes[o+1] = (v>>8)&255; bytes[o+2] = (v>>16)&255; bytes[o+3] = (v>>>24)&255; };
    const w16 = (o, v) => { bytes[o] = v & 255; bytes[o+1] = (v>>8)&255; };
    ws(0, 'RIFF'); w32(4, 36 + FR * 2); ws(8, 'WAVE');
    ws(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1);
    w32(24, 44100); w32(28, 88200); w16(32, 2); w16(34, 16);
    ws(36, 'data'); w32(40, FR * 2);
    for (let i = 0; i < FR; i++) { const v = Math.round(Math.sin(i * 0.01) * 30000); w16(44 + i * 2, v < 0 ? v + 65536 : v); }
    /* perf.mjs stubs globals directly (no installEnv), so std/os are provided
     * here rather than via env.setFiles. */
    const files = { '/perf/big.wav': bytes };
    globalThis.os = { ...(globalThis.os ?? {}),
        stat: (p) => (files[p] ? [{ size: files[p].length, mtime: 1 }, 0] : [null, -1]) };
    globalThis.std = {
        open(p2) {
            const d = files[p2]; if (!d) return null;
            let pos = 0;
            return {
                read(buffer, offset, length) {
                    const n = Math.max(0, Math.min(length, d.length - pos));
                    new Uint8Array(buffer, offset, n).set(d.subarray(pos, pos + n));
                    pos += n; return n;
                },
                seek(o) { pos = o; return 0; }, close() {},
            };
        },
    };
    resetWavPeaks();

    const times = [];
    let ticks = 0;
    while (!wavPeaks('/perf/big.wav')?.done && ticks < 400) {
        const t0 = performance.now();
        wavPeaksTick('/perf/big.wav');
        times.push(performance.now() - t0);
        ticks++;
    }
    const worst = Math.max(...times);
    check('worst single tick', worst, WAV_TICK_MAX_MS, 'ms');
    _origLog(`    (${ticks} ticks, median ${median(times).toFixed(3)}ms, worst ${worst.toFixed(3)}ms — a 1 MB file)`);

    /* Once done it must cost NOTHING: a completed read that kept re-reading
     * would be a permanent tax on every tick for as long as the page is open. */
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) wavPeaksTick('/perf/big.wav');
    const idle = (performance.now() - t0) / 100;
    check('idle tick after completion', idle, 0.02, 'ms');
}

/* ── Test 4a: waveform silhouettes, cells and overlay ────────────────────── */

_origLog('\nTest 4a: fill_rect calls with waveform silhouettes (wave_cells)');

{
    mockState = { ...MOCK_SYNTHS.wave_cells };
    const model = createModel(0, 'synth');
    for (let i = 0; i < 120; i++) model.tick();

    fillRectCount = 0;
    renderKnobsView(model.getViewModel(), false);
    check('fill_rect calls (6 wave cells)', fillRectCount, FILL_RECT_PER_RENDER_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls — a silhouette is one 1px rect per column)`);

    /* Overlay open on a 7-entry waveform list. Only the 6 visible rows draw a
     * glyph no matter how long the list is, so this is the whole cost. */
    model.handleKnobTouch(0);
    for (let i = 0; i < LONG_PRESS_TICKS + 10; i++) model.tick();
    const ovm = model.getViewModel();
    check('overlay is actually open', ovm.overlay ? 1 : 0, 1);
    check('overlay carries glyph ids', ovm.overlay?.shapeIds ? 1 : 0, 1);

    fillRectCount = 0;
    renderKnobsView(ovm, false);
    check('fill_rect calls (wave overlay)', fillRectCount, FILL_RECT_PER_RENDER_MAX);
    _origLog(`    (baseline: ${fillRectCount} calls — 6 rows × 13 columns max)`);
}

/* ── Test 4b: Main Params page (4-knob Tempo/Swing/Root/Key view) ──────────── */

_origLog('\nTest 4b: fill_rect calls per renderKnobsView (main params page)');

{
    /* Initialize sequencer and keyboard state. */
    resetSeqState();
    resetMainPage();
    keyboardState.rootPc = 0; keyboardState.octave = [5, 5, 5, 5];
    keyboardState.mode = 0; keyboardState.layout = 0;
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
    keyboardState.rootPc = 0; keyboardState.octave = [5, 5, 5, 5];
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.scale = 0;
    seqState.bpmX100 = 12000;
    seqState.swingPct = 50;

    /* Simulate the scale overlay being open. */
    mainPageState.overlayKnob = 5;
    mainPageState.overlaySel = 5;

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

    // Knob-ring LEDs used to be force-written every tick (16 packets: notes 0-7
    // plus CCs 71-78) purely to out-shout Move firmware's repaints. Now that the
    // host strips those repaints, an unchanged page must cost nothing on the
    // wire — otherwise we are back to spending a quarter of the ~60-packet LED
    // budget on a picture that did not change.
    const { updateKnobLEDs, resetKnobLedCache } =
        await import('../dist/esm/renderer/knob-leds.js');
    const knobCell = (nv) => ({ normalizedValue: nv, trigger: null });
    const knobVm = { rows: [
        [knobCell(0.5), knobCell(0.5), knobCell(0.5), knobCell(0.5)],
        [knobCell(0.5), knobCell(0.5), knobCell(0.5), knobCell(0.5)],
    ] };
    resetKnobLedCache();
    updateKnobLEDs(knobVm);          // cold frame paints all 8 knobs
    ledCount = 0;
    for (let i = 0; i < 50; i++) updateKnobLEDs(knobVm);
    check('knob LED sends when idle (50 ticks)', ledCount, 0);

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

/* ── Test 5: cost of turning a knob ──────────────────────────────────────── */

_origLog('\nTest 5: shadow_get_param calls per knob detent (plain + preset)');

{
    const { resetUndoState } = await import('../dist/esm/undo/state.js');
    const { resetUndoGroups, endEdit } = await import('../dist/esm/undo/group.js');

    /* Every knob turn goes through applyKnobDelta, and one class of param —
     * anything flagged capturesModuleState — snapshots the whole module for
     * undo. That snapshot is one blocking read per published param, so it must
     * happen ONCE per gesture. Doing it per detent put ~300 reads (Surge XT)
     * between the knob and the screen, several ms each on device: the display
     * fell seconds behind the hand. Nothing else here measured a knob turn, so
     * nothing caught it. */
    const detent = (model, k) => {
        getParamCount = 0;
        model.handleKnobDelta(k, 3);
        model.tick();
        return getParamCount;
    };

    mockState = { ...MOCK_SYNTHS.moog, 'synth:preset': '0' };
    resetUndoState(); resetUndoGroups();
    const model = createModel(0, 'synth');
    for (let i = 0; i < 40; i++) model.tick();   // settle hierarchy + first reads

    const params = model.dumpLayout().params;
    const presetGi = params.findIndex((p) => p?.capturesModuleState);
    /* Both knobs must be on the page the model is showing, or the physical slot
     * maps to a different param than intended. */
    let plainK = -1;
    for (let k = 0; k < 8; k++) {
        const p = params[k];
        if (p && !p.capturesModuleState && p.type !== 'file') { plainK = k; break; }
    }

    /* A plain knob must stay flat — it has no snapshot to take. */
    let plainMax = 0;
    for (let i = 0; i < 8; i++) plainMax = Math.max(plainMax, detent(model, plainK));
    check('plain knob: GETs per detent', plainMax, KNOB_DETENT_GETS_MAX);
    endEdit();

    if (presetGi >= 0) {
        for (let i = 0; i < model.dumpLayout().params.length && model.getKnobPage() !== Math.floor(presetGi / 8); i++) {
            model.changePage(1);
        }
        const k = presetGi % 8;
        const first = detent(model, k);          // the gesture's one snapshot
        let restMax = 0;
        for (let i = 0; i < 8; i++) restMax = Math.max(restMax, detent(model, k));
        check('preset knob: GETs per detent after the first', restMax, KNOB_DETENT_GETS_MAX);
        _origLog(`    (first detent ${first} GETs — the once-per-gesture snapshot; then ${restMax})`);
        endEdit();
    } else {
        fail('preset knob detent cost', 'no capturesModuleState param in the mock');
    }

    resetUndoState(); resetUndoGroups();
}

/* ── Test 6: view-model cost must not scale with an enum's option count ─── */

_origLog('\nTest 6: buildViewModel with a long enum (8 vs 1024 options)');

{
    /* A preset list of a thousand entries is ordinary (Surge XT, minijv). The
     * view model is rebuilt every frame, and it used to classify every enum on
     * the page from scratch each time — three regex passes over the whole list,
     * because isSlopeEnum re-runs isFilterModeEnum before its own. Opening or
     * scrolling a long enum overlay lagged behind the knob. */
    const build = (nOpts) => {
        const opts = Array.from({ length: nOpts }, (_, i) => 'Preset ' + i);
        mockState = {
            'synth:name': 'Test',
            'synth:ui_hierarchy': JSON.stringify({ levels: { root: { knobs: ['sel'], params: [] } } }),
            'synth:chain_params': JSON.stringify([{ key: 'sel', name: 'Sel', type: 'enum', options: opts }]),
            'synth:sel': opts[0],
        };
        const m = createModel(0, 'synth');
        for (let i = 0; i < 40; i++) m.tick();
        return m;
    };
    const median50 = (m) => {
        const runs = [];
        for (let i = 0; i < 50; i++) {
            const t0 = process.hrtime.bigint();
            m.getViewModel();
            runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
        return median(runs);
    };

    const small = median50(build(8));
    const large = median50(build(1024));
    /* Ratio, not absolute time: the machine running this is irrelevant, the
     * SHAPE of the curve is the invariant. 128x the options must not cost
     * meaningfully more — it was ~17x before the classification was cached. */
    const ratio = small > 0 ? large / small : 1;
    check('view-model cost ratio, 1024 options vs 8', ratio, ENUM_VM_RATIO_MAX, 'x');
    _origLog(`    (8 opts: ${small.toFixed(4)}ms, 1024 opts: ${large.toFixed(4)}ms)`);
}

/* ── Test 8: a filter page's VM must not scale with the module's param count ─ */

_origLog('\nTest 8: buildViewModel for a filter page (16 vs 400 module params)');

{
    /* When a filter pair has no mode enum on its own page, the type is looked up
     * from a mode enum elsewhere in the chain. That search walked EVERY param in
     * the module and ran a regex/split/join qualifier over each enum — every
     * frame, and a knob turn dirties every frame. It is why helm's Main page
     * (180 params, no same-page mode enum) turned visibly slower than its other
     * pages while ob-xd's structurally identical Main page was fine. */
    const build = (nFillers) => {
        const params = [
            { key: 'cutoff',    name: 'Cutoff', type: 'float', min: 0, max: 1, step: 0.01 },
            { key: 'resonance', name: 'Res',    type: 'float', min: 0, max: 1, step: 0.01 },
        ];
        /* Filler enums that LOOK like filter modes (so the qualifier work runs)
         * but whose qualifier never matches the pair — the worst case, and the
         * one a real module with several filters actually hits. */
        for (let i = 0; i < nFillers; i++) {
            params.push({ key: 'osc' + i + '_mode', name: 'Osc' + i, type: 'enum',
                          options: ['LP', 'HP', 'BP', 'Notch'] });
        }
        const knobs = params.map(p => p.key);
        mockState = {
            'synth:name': 'Test',
            'synth:ui_hierarchy': JSON.stringify({ levels: { root: { knobs, params: [] } } }),
            'synth:chain_params': JSON.stringify(params),
            'synth:cutoff': '0.5',
            'synth:resonance': '0.5',
        };
        for (let i = 0; i < nFillers; i++) mockState['synth:osc' + i + '_mode'] = 'LP';
        const m = createModel(0, 'synth');
        for (let i = 0; i < 40; i++) m.tick();
        return m;
    };
    const median50 = (m) => {
        const runs = [];
        for (let i = 0; i < 50; i++) {
            const t0 = process.hrtime.bigint();
            m.getViewModel();
            runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
        return median(runs);
    };

    const small = median50(build(14));
    const large = median50(build(398));
    const ratio = small > 0 ? large / small : 1;
    check('filter-page VM cost ratio, 400 params vs 16', ratio, FILTER_VM_RATIO_MAX, 'x');
    _origLog(`    (16 params: ${small.toFixed(4)}ms, 400 params: ${large.toFixed(4)}ms)`);
}

/* ── Test 7: opening the file overlay must not scale with the folder ────── */

_origLog('\nTest 7: file overlay open cost (16 vs 1024 files)');

{
    /* A sample folder can hold hundreds of files. Building the overlay ran five
     * chained array passes and called os.stat on every surviving entry — a
     * syscall each — before the list could appear, so it opened visibly late.
     * One pass now, and an entry that matched the module's own extension filter
     * is taken as a file without statting. */
    let statCalls = 0;
    const origOs = globalThis.os;
    const mkFiles = (n) => Array.from({ length: n }, (_, i) => `sample_${i}.wav`);

    const openCost = (n) => {
        const files = mkFiles(n);
        globalThis.os = {
            readdir: () => [files, 0],
            stat: () => { statCalls++; return [{ mode: 0x8000 }, 0]; },
        };
        mockState = {
            'synth:name': 'T',
            'synth:chain_params': JSON.stringify([
                { key: 'smp', name: 'Smp', type: 'filepath', root: '/d',
                  start_path: '/d', filter: ['.wav'] },
            ]),
            'synth:smp': '/d/sample_0.wav',
        };
        const m = createModel(0, 'synth');
        for (let i = 0; i < 40; i++) m.tick();
        statCalls = 0;
        const runs = [];
        for (let i = 0; i < 10; i++) {
            m.clearTouch();
            const t0 = process.hrtime.bigint();
            m.handleKnobTouch(0);
            for (let t = 0; t < 175; t++) m.tick();     // long-press opens it
            runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
        const opened = !!m.getViewModel().overlay;
        return { ms: median(runs), stats: Math.round(statCalls / 10), opened };
    };

    const small = openCost(16);
    const large = openCost(1024);
    globalThis.os = origOs;

    check('file overlay opened at all', large.opened ? 0 : 1, 0);
    /* Ratio, so the machine does not matter. 64x the files measured ~50x the
     * time before the scan was made single-pass. */
    const ratio = small.ms > 0 ? large.ms / small.ms : 1;
    check('file overlay open cost ratio, 1024 files vs 16', ratio, FILE_OPEN_RATIO_MAX, 'x');
    /* The syscalls are the part that hurts on device, where each is real I/O. */
    check('os.stat calls when opening 1024 filtered files', large.stats, FILE_OPEN_STATS_MAX);
    _origLog(`    (16 files: ${small.ms.toFixed(3)}ms/${small.stats} stats, ` +
             `1024: ${large.ms.toFixed(3)}ms/${large.stats} stats)`);
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
