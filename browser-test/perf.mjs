#!/usr/bin/env node
/* browser-test/perf.mjs — performance regression tests, no device required.
 *
 * The sequencer's LED, IPC and strip budgets, status parsing, and the per-frame
 * cost of movy's own screens. (The Schwung param page's cost is gated by
 * grid-cost.mjs.) Fails with exit 1 if any threshold is exceeded.
 *
 * Usage:
 *   cd movy
 *   node browser-test/perf.mjs
 */

import { performance } from 'perf_hooks';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeBulk, decodeBulk } from '../dist/esm/track/bulk.js';
import { portFor } from '../dist/esm/track/registry.js';
import { seqState, resetSeqState } from '../dist/esm/seq/state.js';
import { keyboardState } from '../dist/esm/keyboard/state.js';
import { MOCK_SYNTHS }     from './mock-synth.mjs';

/* ── Thresholds ──────────────────────────────────────────────────────────── */


/* ── Globals ─────────────────────────────────────────────────────────────── */

let fillRectCount = 0;
let getParamCount = 0;

let mockState = {};

globalThis.fill_rect          = () => { fillRectCount++; };
globalThis.clear_screen       = () => {};
globalThis.shadow_get_param   = (_s, key) => { getParamCount++; return mockState[key] ?? null; };
globalThis.shadow_set_param   = (_s, key, val) => { mockState[key] = val; return true; };
globalThis.host_read_file     = () => null;
/* The rest of movy-host's file surface, as "nothing there": src/platform calls
 * them without a typeof gate (WP9). */
globalThis.host_write_file    = () => true;
globalThis.host_file_exists   = () => false;
globalThis.host_ensure_dir    = () => true;
globalThis.host_remove_dir    = () => false;

/* Every track is a movy chain now, so `portFor(0)` in the tests below reaches
 * the engine's own param API (`ch0:<key>`), not the shadow slot API — a chain
 * read still counts against `getParamCount`, the same signal it always was, so
 * the call-count assertions below stay meaningful rather than reading zero
 * because nothing answered. Individual tests override these where a DIFFERENT
 * mock is the point (send buses, master FX, foreign-write detection). */
const CHAIN_KEY = /^ch[0-9]+:(.*)$/;
/* Only `MovyChainPort.getParam`/`.setParam` (the SINGLE-key path) call this —
 * `getMany`'s bulk path goes straight to `shadow_get_params` below and never
 * touches it. A count here during normal (bulk-mocked) operation means the
 * fallback fired: the bulk endpoint was missing or its response malformed,
 * which is not the shape a real device serves under normal operation. */
let individualGetCount = 0;
globalThis.host_module_get_param = (key) => {
    individualGetCount++;
    const m = CHAIN_KEY.exec(key);
    return globalThis.shadow_get_param(0, m ? m[1] : key);
};
globalThis.host_module_set_param = (key, val) => {
    const m = CHAIN_KEY.exec(key);
    return globalThis.shadow_set_param(0, m ? m[1] : key, val);
};
globalThis.host_module_set_param_blocking = (key, val) => globalThis.host_module_set_param(key, val);

/* Counts BULK round trips, the shape of the real IPC cost now that every
 * track's params are read via `shadow_get_params`/`shadow_set_params` — one
 * round trip for a whole page's worth of knobs, not one `shadow_get_param`
 * per key. Without this mock, `getMany`'s bulk endpoint is missing and it
 * falls back to N individual `shadow_get_param` calls landing on one tick,
 * which is the fallback path a real device only takes on a malformed
 * response — exercising it here would measure the wrong thing. */
let bulkGetCount = 0;
globalThis.shadow_get_params = (slot, _marker, payload) => {
    bulkGetCount++;
    const keys = decodeBulk(payload) ?? [];
    /* Per key, through `shadow_get_param` rather than reading `mockState`
     * directly — several tests below override that function to count or
     * intercept a SPECIFIC key, and a bulk path that skipped it would make
     * their counts read zero regardless of what actually happened. Stripped of
     * its `ch<N>:` prefix first: the payload carries the chain-namespaced key
     * (MovyChainPort.getMany encodes `this.key(k)`), and `synth:cutoff` — not
     * `ch0:synth:cutoff` — is the spelling every other mock and override here
     * still expects. */
    return encodeBulk(keys.map((k) => {
        const m = CHAIN_KEY.exec(k);
        return globalThis.shadow_get_param(slot, m ? m[1] : k) ?? '';
    }));
};
globalThis.shadow_set_params = (slot, _marker, payload) => {
    const flat = decodeBulk(payload) ?? [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
        const m = CHAIN_KEY.exec(flat[i]);
        globalThis.shadow_set_param(slot, m ? m[1] : flat[i], flat[i + 1]);
    }
    return true;
};
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

/* ── Test 5: sequencer LED cache + IPC + strip budgets ───────────────────── */

_origLog('\nTest 5: sequencer perf budgets');

{
    const { ENGINE_VERSION } = await import('../dist/esm/seq/constants.js');
    /* Saved and restored: every track is a movy chain now, so the model tests
     * below this block also read through `host_module_get_param` — an engine
     * stub left in place here (as it was, unrestored, before that was true)
     * silently answers null for every knob param in every test that follows. */
    const oldSetSeq = globalThis.host_module_set_param;
    const oldGetSeq = globalThis.host_module_get_param;
    const oldSnap = [globalThis.movy_engine_snapshot_seq, globalThis.movy_engine_snapshot];
    globalThis.host_module_set_param = () => true;
    globalThis.host_module_get_param = (k) => (k === 'ping' ? 'pong ' + ENGINE_VERSION : null);
    /* The status arrives as movy-host's snapshot, one per audio block. */
    let snapSeq = 0;
    globalThis.movy_engine_snapshot_seq = () => ++snapSeq;
    globalThis.movy_engine_snapshot = () => ({ seq: snapSeq, served: 0, text: 'play=1 tick=0' });

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
    const { updateKnobLEDsFrom, resetKnobLedCache } =
        await import('../dist/esm/renderer/knob-leds.js');
    const knobLevels = new Array(8).fill(0.5);
    resetKnobLedCache();
    updateKnobLEDsFrom(knobLevels);  // cold frame paints all 8 knobs
    ledCount = 0;
    for (let i = 0; i < 50; i++) updateKnobLEDsFrom(knobLevels);
    check('knob LED sends when idle (50 ticks)', ledCount, 0);

    // IPC: at most one set_param flush per tick regardless of queued ops.
    let setParamCalls = 0;
    globalThis.host_module_set_param = () => { setParamCalls++; return true; };
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

    /* Held-step piano: the densest zoom (2 px, 63 keys) with every key filled
     * is the worst frame, and it is drawn only when its notes change. */
    {
        const { drawStepPiano } = await import('../dist/esm/renderer/step-piano.js');
        const { windowAt } = await import('../dist/esm/seq/piano-range.js');
        const win = windowAt(36, 2);
        const all = Array.from({ length: win.n }, (_, i) => 36 + i);
        for (const [label, sel] of [['empty', []], ['every key filled', all]]) {
            fillRectCount = 0;
            const t0 = performance.now();
            drawStepPiano({ win, sel, x0: 0 });
            check(`step piano fill_rect (63 keys, ${label})`, fillRectCount, 160);
            _origLog(`    (step piano ${label}: ${fillRectCount} fill_rect, ${(performance.now() - t0).toFixed(3)} ms)`);
        }
    }

    /* Loop-mode note view (seq/note-view.ts): a full paint is bounded by the
     * runs, not by the note count, and a quiet tick touches only the playhead's
     * two columns. The densest case is a 16-bar clip at MAX_NOTES (512). */
    {
        const { noteViewTick, resetNoteView, seedNoteViewForTest } = await import('../dist/esm/seq/note-view.js');
        const { appState, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
        const notes = [];
        for (let i = 0; i < 512; i++) notes.push({ tick: (i % 256) * 24, gate: 24, pitch: 30 + (i * 7) % 40 });
        resetNoteView();
        seqState.loopMode = true; appState.currentView = VIEW_KNOBS;
        seqState.loopStart = 0; seqState.lenSteps = 256; seqState.barOffset = 0;
        seqState.playing = true; seqState.posTick = 0; seqState.noteHash = 'perf';
        seedNoteViewForTest(notes);
        fillRectCount = 0;
        const t0 = performance.now();
        noteViewTick(true);
        const fullMs = performance.now() - t0;
        check('note view full paint fill_rect (512 notes, 40 rows)', fillRectCount, 450);
        _origLog(`    (note view full paint: ${fillRectCount} fill_rect, ${fullMs.toFixed(2)} ms incl. layout)`);
        fillRectCount = 0;
        seqState.posTick = 24 * 9;
        noteViewTick(false);
        check('note view playhead tick fill_rect', fillRectCount, 40);
        _origLog(`    (note view playhead move: ${fillRectCount} fill_rect)`);
        fillRectCount = 0;
        noteViewTick(false);
        check('note view quiet tick fill_rect', fillRectCount, 0);
        seqState.loopMode = false; resetNoteView();
    }

    globalThis.host_module_set_param = oldSetSeq;
    globalThis.host_module_get_param = oldGetSeq;
    [globalThis.movy_engine_snapshot_seq, globalThis.movy_engine_snapshot] = oldSnap;
}

/* ── Test: status parse cost at 16 tracks ───────────────────────────────────
 *
 * The design predicted the 4x wider status string would have to be split — the
 * focused group in the normal poll, the rest on demand. That was a guess, so it
 * is measured here rather than implemented on faith. The poll runs every 8
 * ticks and its IPC round trip already costs ~0.3 ms on device, so parsing has
 * a lot of room before it matters. */
_origLog('\nTest: status parse cost, 4 vs 16 tracks');
{
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');

    const buildStatus = (n) => {
        const sess = new Array(n).fill('ff.2.-.3').join(',');
        const act  = new Array(n).fill('60.64.67').join(',');
        const mute = '0'.repeat(n);
        return `play=1 tick=4096 bpm=12000 ext=0 link=0 trk=0 step=4 pos=768 len=32 `
             + `lstart=0 rec=0 cin=0 metro=0 dirty=1 sess=${sess} act=${act} mute=${mute} `
             + `hlen=0 hnotes= occ=${'ff'.repeat(32)} alanes=00 aauto=00 hauto= hvel=0 `
             + `hgate=0 hgmix=0 hprob=100 hcond=1:1 hinv=0 hlmax=0 swing=50 csc=1/1 ctr=0 `
             + `quant=0 dquant=0 cap=0.0 mtr=${'79a0a2'.repeat(16)}`;
    };
    const timeIt = (fn, n) => {
        for (let i = 0; i < 200; i++) fn();          // warm
        const t0 = performance.now();
        for (let i = 0; i < n; i++) fn();
        return (performance.now() - t0) / n;
    };

    const s16 = buildStatus(16), s4 = buildStatus(4);
    const t16 = timeIt(() => parseStatusForTest(s16), 2000);
    const t4  = timeIt(() => parseStatusForTest(s4), 2000);
    _origLog(`    (4 tracks: ${t4.toFixed(4)}ms, 16 tracks: ${t16.toFixed(4)}ms)`);

    /* A whole tick is ~5-15 ms on device; the poll is 1 tick in 8. */
    check('16-track status parse', Number(t16.toFixed(4)), 0.5, 'ms');
    /* Widening tracks 4x must not cost more than ~4x — a superlinear result
     * would mean the parser is doing something quadratic in track count. */
    check('16-track parse vs 4-track', Number((t16 / t4).toFixed(2)), 4.5, 'x');
}

/* ── Test: every host IPC call is on the instrument ──────────────────────── */

/* The probe is how every claim in docs/track-performance.md is made, so a host
 * call it does not wrap is a hole in the evidence, not just a missing number.
 * host_module_set_param_blocking was exactly that until WP10 made every engine
 * write a plain queued set: `ipc_ms` reported none of them and a neighbouring
 * cost got the blame. The status snapshot is on it too, so the probe shows what
 * replaced the status poll. */
{
    _origLog('\nTest: perf probe wraps every host IPC entry point');

    /* What movy calls on movy-host (src/platform/standalone.ts). The slot API
     * (`shadow_get_param`/`shadow_set_param`) went with the shadow slots, WP9. */
    const IPC_GLOBALS = [
        'host_module_get_param',
        'host_module_set_param',
        'movy_engine_snapshot',
        'shadow_get_params',
        'shadow_set_params',
    ];
    const saved = {};
    for (const g of IPC_GLOBALS) { saved[g] = globalThis[g]; globalThis[g] = () => true; }

    const originals = IPC_GLOBALS.map(g => globalThis[g]);

    const { installPerfProbe, resetPerfProbeInstall } = await import('../dist/esm/app/perf-probe.js');
    installPerfProbe();
    const unwrapped = IPC_GLOBALS.filter(g => globalThis[g]._movyProbe !== true);
    if (unwrapped.length) _origLog('    (unmeasured: ' + unwrapped.join(', ') + ')');
    check('host IPC calls left unmeasured', unwrapped.length, 0);

    /* Re-opening the tool re-evaluates ui.js: fresh module state, same host
     * globals. A second install must hand the counting to the NEW evaluation —
     * skipping because the global is already wrapped leaves every call recorded
     * into counters nobody reports, which is how a whole call site went missing
     * from perf_ipc on device while it was demonstrably running. */
    /* A wrapper must report through a sink looked up at CALL time, not one
     * captured in its closure: on device the wrappers outlive every reopen and
     * even a stack restart, so a closure keeps filling counters that nothing
     * reports — which is how the batched chain refresh ran 122 times in eight
     * seconds and showed up in perf_ipc as nothing at all. */
    const realSink = globalThis.__movyPerfSink;
    let sunk = null;
    globalThis.__movyPerfSink = (name) => { sunk = name; };
    globalThis.host_module_get_param('probe:sink');
    globalThis.__movyPerfSink = realSink;
    check('a wrapper reports through the swappable sink', sunk === null ? 1 : 0, 0);

    /* A wrapper from a build with no `_movyOrig` must still be taken over, or
     * the call stays unmeasured for the life of the shadow_ui process — which
     * outlives reopens AND a Move stack restart. */
    const foreign = (...a) => globalThis.host_module_get_param._movyOrig?.(...a);
    foreign._movyProbe = true;                 // marked, but no _movyOrig
    const realGet = globalThis.host_module_get_param;
    globalThis.host_module_get_param = foreign;
    resetPerfProbeInstall();
    installPerfProbe();
    check('a wrapper with no recoverable original is taken over',
          globalThis.host_module_get_param === foreign ? 1 : 0, 0);
    globalThis.host_module_get_param = realGet;

    const firstWrappers = IPC_GLOBALS.map(g => globalThis[g]);
    resetPerfProbeInstall();
    installPerfProbe();
    /* The NEW evaluation must own the wrapper — same wrapper means the calls are
     * still being recorded into the previous evaluation's counters, which is the
     * failure that hid the batched chain refresh from perf_ipc entirely. */
    const stale = IPC_GLOBALS.filter((g, i) => globalThis[g] === firstWrappers[i]);
    if (stale.length) _origLog('    (still counted by the previous evaluation: ' + stale.join(', ') + ')');
    check('host IPC calls orphaned by a reopen', stale.length, 0);
    /* ...and it must wrap the ORIGINAL, not the previous wrapper: nesting would
     * count every call twice and add a layer per reopen. */
    const nested = IPC_GLOBALS.filter((g, i) => globalThis[g]._movyOrig !== originals[i]);
    if (nested.length) _origLog('    (wrapper nested on reopen: ' + nested.join(', ') + ')');
    check('host IPC wrappers nested by a reopen', nested.length, 0);

    for (const g of IPC_GLOBALS) {
        if (saved[g] === undefined) delete globalThis[g]; else globalThis[g] = saved[g];
    }
}

/* ── Test: the song band is free when nothing changed ────────────────────── */
/* A running song must cost nothing per tick. The band's content only moves on a
 * scene switch, so once drawn it must not redraw until the arrangement, the
 * position in it, or the view underneath changes. */

_origLog('\nTest: song band steady-state cost');
{
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { songBandTick, resetSongBand } = await import('../dist/esm/seq/render.js');
    resetSeqState(); resetSongBand();
    seqState.sessionMode = true;
    seqState.songScenes = [0, 1, 1, 2];
    seqState.songPos = 1;

    fillRectCount = 0;
    songBandTick(true);                 // the view repainted -> the band redraws
    const drawn = fillRectCount;
    check('the band actually draws when the view repainted', drawn > 0 ? 0 : 1, 0);

    fillRectCount = 0;
    for (let i = 0; i < 100; i++) songBandTick(false);
    check('fill_rect over 100 idle ticks', fillRectCount, 0);

    /* ...and it DOES redraw when the song moves on, or the readout would lie. */
    fillRectCount = 0;
    seqState.songPos = 3;
    songBandTick(false);
    check('a scene change redraws the band', fillRectCount > 0 ? 0 : 1, 0);

    resetSeqState(); resetSongBand();
}

/* ── Test: the SETS page costs nothing per frame ─────────────────────────── */
/* The library's answer is read on the page's own cadence and parsed only when
 * it changed; a frame draws from the parsed rows. So 100 idle ticks of the page
 * must read the engine a handful of times, not 100, and a 200-Set library must
 * draw no more than a 5-Set one (only the visible rows are drawn). */

_origLog('\nTest: SETS page steady-state cost');
{
    const { paramStats, resetParamStats } = await import('../dist/esm/host/param.js');
    const { resetLib, libState } = await import('../dist/esm/seq/sets-lib.js');
    const { setsPageTick } = await import('../dist/esm/seq/sets-page.js');
    const { renderSetsView } = await import('../dist/esm/renderer/sets-view.js');
    const { buildSetsPageVM } = await import('../dist/esm/seq/sets-page-vm.js');
    const wire = (n) => 'rev=1 cur=s0 made=- err=-\n'
        + Array.from({ length: n }, (_, i) => `s${i}\t${i}\t0\tSet number ${i}\n`).join('');
    const savedGet = globalThis.host_module_get_param;
    let answer = wire(200);
    globalThis.host_module_get_param = (k) => (k === 'lib' ? answer : savedGet(k));
    resetLib();

    resetParamStats();
    for (let i = 0; i < 100; i++) setsPageTick();
    check('engine reads over 100 page ticks', paramStats().gets, 8);

    const draw = (n) => {
        answer = wire(n); resetLib();
        for (let i = 0; i < 20; i++) setsPageTick();
        fillRectCount = 0;
        renderSetsView(buildSetsPageVM(libState().rows, 's0', 3, false));
        return fillRectCount;
    };
    const small = draw(5), big = draw(200);
    check('fill_rect: 200 Sets vs 5 (extra calls)', big - small, 0);

    globalThis.host_module_get_param = savedGet;
    resetLib();
}

/* ── Test: the Session mixer frame ───────────────────────────────────────── */
/* Sixteen strips at the meters' 30 Hz: drawn from the status text with no
 * param read, decoded only when that text changed, and in a bounded number of
 * runs — a fader is two runs, never seven pixels. */

_origLog('\nTest: Session mixer frame cost');
{
    const { drawMixerBody } = await import('../dist/esm/renderer/mixer-view.js');
    const { decodeMeter } = await import('../dist/esm/mixer/meter.js');
    let rects = 0;
    const ctx = { fillRect: () => { rects++; }, print() {}, textWidth: () => 0 };
    const band = { x: 0, y: 11, w: 128, h: 96 };
    const raw = Array.from({ length: 48 }, (_, i) => ((i * 37) % 200 + 20).toString(16).padStart(2, '0')).join('');
    getParamCount = 0;
    drawMixerBody(ctx, band, decodeMeter(raw), 4);
    check('param reads per mixer frame', getParamCount, 0);
    _origLog(`    (${rects} fillRect per frame)`);
    check('fillRect per mixer frame', rects, 180);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) drawMixerBody(ctx, band, decodeMeter(raw), -1);
    check('mixer frame (decode cached)', Number(((performance.now() - t0) / 1000).toFixed(4)), 0.2, 'ms');
}

/* The algorithmic generators run inside the UI tick, one preset per tick
 * (plans/2026-10-27-algorithmic-generators-design.md §7). QuickJS on the
 * device is some 20-50x slower than node: these bounds keep the densest clip
 * the engine allows (512 notes) to about one slow tick on the device. */
_origLog('\nTest: generator slice cost');
{
    const G = await import('../dist/esm/gen/index.js');
    const F = await import('./gen-fixtures.mjs');
    const big = F.fixtureInput('arpeggio', { scene: 'locked' });
    const notes = [];
    for (let i = 0; i < 128; i++) for (const p of [57, 60, 64, 67]) notes.push({ tick: i * 12, gate: 10, pitch: p + (i % 3), vel: 90 });
    big.tracks[0].clips[0].notes = notes;
    big.tracks[0].clips[0].len = 64;
    big.len = 64;
    let prep = 0, step = 0, regen = 0;
    for (let rep = 0; rep < 4; rep++) {
        /* The first pass warms the JIT; the device has none to warm. */
        if (rep === 1) { prep = 0; step = 0; regen = 0; }
        let t = performance.now();
        const req = G.startRequest(big);
        prep = Math.max(prep, performance.now() - t);
        while (req.todo.length) { t = performance.now(); G.stepRequest(req); step = Math.max(step, performance.now() - t); }
        for (const p of G.finishRequest(req)) { t = performance.now(); G.regenerate(req.ctx, p.preset, p.knobs); regen = Math.max(regen, performance.now() - t); }
    }
    check('generator: prepare a request (512 notes)', Number(prep.toFixed(2)), 12, 'ms');
    check('generator: one take slice (512 notes)', Number(step.toFixed(2)), 15, 'ms');
    check('generator: a knob turn regeneration (512 notes)', Number(regen.toFixed(2)), 12, 'ms');
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
