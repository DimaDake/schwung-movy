#!/usr/bin/env node
/* schwung-app-check.mjs — the REAL app loop, drawing Schwung's pages.
 *
 * schwung-pagination-check.mjs proves the planner and the lane resolution in
 * isolation. This proves the wiring: globalThis.tick() — movy's actual frame —
 * renders through Schwung when the mode is 'page', and renders through movy
 * when it is not.
 *
 * Wiring is exactly what isolated checks cannot see. This branch has already
 * shipped two probes that passed against the wrong renderer entirely.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-app-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';
import { installMockEngine } from '../browser-test/mock-engine.mjs';
import { MOCK_SYNTHS } from '../browser-test/mock-synth.mjs';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
const paint = (x, y, w, h, v) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) fb[yy * W + xx] = v ? 1 : 0;
};
const env = installEnv();
const engine = installMockEngine();
globalThis.fill_rect = (x, y, w, h, v) => paint(x, y, w, h, v);
globalThis.clear_screen = () => paint(0, 0, W, H, 0);
globalThis.setLED = () => {};
globalThis.setButtonLED = () => {};

const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };

await import('../dist/esm/app/globals.js');
const { appState, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
const { resetSeqState } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { setSchwungGridMode, schwungPageFor, schwungGridReload } =
    await import('../dist/esm/renderer/schwung-grid.js');

const fail = (m) => { _log('FAIL: ' + m); process.exit(1); };
const advance = (n = 1) => { for (let i = 0; i < n; i++) globalThis.tick(); };

function boot(preset) {
    engine.reset();
    env.setParams(MOCK_SYNTHS[preset]);
    resetSeqState(); resetSeqEngine();
    schwungGridReload();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(14);
    /* The app boots onto its session view, not the module params view. The
     * delegation only applies to VIEW_KNOBS — the module's own page — so a
     * check that never navigates there proves nothing about it. */
    appState.currentView = VIEW_KNOBS;
    advance(2);
}

function frame() {
    fb = new Uint8Array(W * H);
    advance(1);
    /* A non-dirty tick draws nothing, so ask until something is painted. */
    for (let i = 0; i < 30 && !fb.some(Boolean); i++) { advance(1); }
    return fb.slice();
}
const ink = (g) => g.reduce((a, v) => a + (v ? 1 : 0), 0);

/* ---- 1. the loop draws movy's grid with the mode off ------------------- */
setSchwungGridMode('off');
boot('obxd_like');
const movyFrame = frame();
if (!ink(movyFrame)) fail('the app loop drew nothing at all with the mode off');

/* ---- 2. the loop draws SCHWUNG's grid with the mode on ----------------- */
setSchwungGridMode('page');
boot('obxd_like');
const schwungFrame = frame();
if (!ink(schwungFrame)) fail('the app loop drew nothing with mode=page — the grid never rendered');

let d = 0;
for (let i = 0; i < movyFrame.length; i++) if (movyFrame[i] !== schwungFrame[i]) d++;
if (!d) {
    fail('mode=page produced a byte-identical frame. The app loop is still going through '
       + "movy's renderer — the wiring, not the grid, is what this checks.");
}

/* ---- 3. it is SCHWUNG's page set, not movy's -------------------------- */
const sp = schwungPageFor(0, 'synth');
if (!sp.ready) fail('the Schwung page never became ready inside the app loop');
const movyPages = appState.trackModels[0][1].getViewModel().bankCount;
_log(`  movy pages ${movyPages}, schwung pages ${sp.pageCount}`);
if (!sp.pageCount) fail('Schwung planned no pages inside the app loop');

/* The page the loop is drawing must be the one Schwung is on: move Schwung's
 * page and the frame must change. */
const before = frame();
sp.changePage(1);
const after = frame();
let dp = 0;
for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) dp++;
if (!dp) fail('changing the Schwung page did not change the frame — the loop is drawing '
            + 'something else');

/* ---- 4. movy's own pages are NOT hijacked ----------------------------- */
/* VIEW_MAIN_PARAMS and VIEW_CLIP_PARAMS are the sequencer's own screens; a
 * module planner has nothing to plan for them, and routing them through it
 * would replace the sequencer's screens with an empty grid. */
{
    const { VIEW_MAIN_PARAMS } = await import('../dist/esm/app/state.js');
    if (VIEW_MAIN_PARAMS !== undefined) {
        setSchwungGridMode('page');
        appState.currentView = VIEW_MAIN_PARAMS;
        const main = frame();
        if (!ink(main)) fail('the sequencer main-params page drew nothing under mode=page — '
                           + 'it was routed through the module planner');
        _log(`  sequencer main-params page still draws (${ink(main)} px) under mode=page`);
    }
}

_log('');
_log(`PASS: movy's own app loop renders Schwung's pages — frame differs by ${d} px from `
   + `movy's, the Schwung page set drives it (${sp.pageCount} pages), paging repaints `
   + `(${dp} px), and the sequencer's own screens are untouched.`);
