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
const { appState, VIEW_KNOBS, VIEW_CHAIN } = await import('../dist/esm/app/state.js');
const { resetSeqState } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { setFlag } = await import('../dist/esm/seq/flags.js');
const { setSchwungGridMode, schwungPageFor, schwungGridReload } =
    await import('../dist/esm/renderer/schwung-grid.js');

const fail = (m) => { _log('FAIL: ' + m); process.exit(1); };
const advance = (n = 1) => { for (let i = 0; i < n; i++) globalThis.tick(); };

function boot(preset) {
    engine.reset();
    env.setParams(MOCK_SYNTHS[preset]);
    resetSeqState(); resetSeqEngine();
    schwungGridReload();
    /* Mirrors browser-test/app-loop.mjs's own reset, and both flags are load
     * bearing since movy 0.30:
     *   chtracks — the mocked instrument is a schwung SLOT, so tracks 1-4 must
     *     be slots; on movy's own chains there is no module to find.
     *   setcommit — the loading splash now waits on a WALL-CLOCK Set commit, so
     *     with instant ticks movy never leaves `settling` and draws the splash
     *     forever. That is what this check hit after the merge: "the app loop
     *     drew nothing at all".
     */
    setFlag('chtracks', 0);
    setFlag('setcommit', 0);
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

/* ---- 5. EVERY view that draws a module grid, not just the one I patched ----
 *
 * This is the check that was missing. movy draws a module's knobs from
 * renderKnobsView AND from renderChainView, and VIEW_CHAIN is the view movy
 * OPENS ON. Routing only VIEW_KNOBS passed every local check and shipped a
 * device build that drew movy's widgets — the bug was invisible precisely
 * because the check chose the view instead of using the one the app lands on.
 */
{
    const grids = [['VIEW_KNOBS', VIEW_KNOBS], ['VIEW_CHAIN', VIEW_CHAIN]];
    for (const [name, view] of grids) {
        if (view === undefined) fail(name + ' is not exported — cannot check it');

        /* ON A FULL PAGE. obxd_like's first page is a single Preset cell in
         * movy and EMPTY in Schwung, so comparing there comes to 86 px and
         * passes a bare "not identical" test while saying nothing. Both sides
         * are moved to a page carrying eight parameters first. */
        setSchwungGridMode('off');
        boot('obxd_like');
        appState.currentView = view;
        appState.trackModels[0][1].changePage(1);
        advance(6);
        const off = frame();
        if (!ink(off)) fail(name + ' drew nothing with the mode off');

        setSchwungGridMode('page');
        boot('obxd_like');
        appState.currentView = view;
        /* MOVE BOTH MODELS TO THE SAME PAGE.
         *
         * Advancing only the Schwung page left movy's own model on page 0, so
         * the two runs differed by WHICH PAGE MOVY WAS ON as well as by who
         * drew it. With the chain-view override deleted the check still saw
         * 763 px and passed — it was measuring movy page 0 against movy page 1.
         * Both models are stepped so the only remaining variable is the
         * renderer. */
        appState.trackModels[0][1].changePage(1);
        schwungPageFor(0, 'synth').goToPage(1);
        advance(6);
        const on = frame();
        if (!ink(on)) fail(name + ' drew nothing under mode=page');

        let dv = 0;
        for (let i = 0; i < off.length; i++) if (off[i] !== on[i]) dv++;
        /* A real body swap moves ~1000 px of the body band (measured across the
         * mock presets). A two-figure delta means the two sides were compared
         * on a near-empty page, not that the renderers nearly agree. */
        if (dv < 300) {
            fail(name + ' differs by only ' + dv + ' px under mode=page - too little for '
               + 'a body swap. Either that view still draws movy own widgets, or the '
               + 'pages being compared are empty.');
        }
        _log(`  ${name}: body swap changes ${dv} px`);
    }
}

_log('');
_log(`PASS: movy's own app loop renders Schwung's pages — frame differs by ${d} px from `
   + `movy's, the Schwung page set drives it (${sp.pageCount} pages), paging repaints `
   + `(${dp} px), and the sequencer's own screens are untouched.`);
