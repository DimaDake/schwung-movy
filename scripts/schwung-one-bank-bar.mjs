#!/usr/bin/env node
/*
 * schwung-one-bank-bar.mjs — there must be exactly ONE bank bar.
 *
 * Two files disagreed about who owns it, and both acted on their answer:
 *
 *   schwung-page.ts:  BANDS = { header: false, bank: TRUE, footer: false }
 *                     "The bank bar IS Schwung's: it indexes param pages,
 *                      which is what the jog moves through here."
 *   knob-view.ts:     drawBankBar(...) unconditionally, before the override
 *                     "the header and bank bar above are movy's in both cases"
 *
 * So the screen grew a second one. Measured on the device: with the grid on,
 * rows 7 AND 8 are both full-width rules where movy alone draws one at row 8.
 * It costs a row of the body band and reads as a rendering fault.
 *
 * Which one goes is decided by WHAT THE JOG MOVES, and it differs per view:
 *
 *   VIEW_KNOBS  the jog calls schwungChangePage — Schwung's pages. movy's bank
 *               index is superseded, so the bar must count Schwung's pages.
 *   VIEW_CHAIN  the jog calls setChainIndex — CHAIN SLOTS. Schwung's paging is
 *               not reachable from here at all, so movy's bar is live and is
 *               the only thing naming the fx slot you are on. Dropping it in
 *               favour of a page bar the jog cannot move would be a straight
 *               loss, and was the first thing caught in review.
 *
 * So Schwung stops drawing a bar (`bands.bank:false`) and movy draws the one
 * bar on both views, taking pageIndex/pageCount from Schwung only where
 * Schwung owns the paging. That keeps one visual language and lets movy
 * compose the bar — which the step page, still movy's, also depends on.
 *
 * Asserted on both views: VIEW_CHAIN is the one movy OPENS on, and a check on
 * VIEW_KNOBS alone would pass while the default screen was wrong.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-one-bank-bar.mjs
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
const { setSchwungGridMode, schwungGridReload, schwungPageFor } =
    await import('../dist/esm/renderer/schwung-grid.js');

let failed = 0;
const fail = (m) => { _log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };
const ok   = (m) => _log(`  \x1b[32m✓\x1b[0m ${m}`);
const advance = (n = 1) => { for (let i = 0; i < n; i++) globalThis.tick(); };

function boot(preset, view) {
    engine.reset();
    env.setParams(MOCK_SYNTHS[preset]);
    resetSeqState(); resetSeqEngine();
    schwungGridReload();
    setFlag('chtracks', 0);
    setFlag('setcommit', 0);
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(14);
    appState.currentView = view;
    advance(6);
}

/* A bank bar is a RULE: a row that spans essentially the whole screen. Counting
 * near-full rows rather than looking at one y keeps the check honest if either
 * engine moves its bar by a pixel. Only the band above the widgets can hold
 * one, so the scan stops before the knob row. */
const RULE_MIN = Math.floor(W * 0.9);
function rulesAboveBody() {
    const rows = [];
    for (let y = 0; y < 12; y++) {
        let n = 0;
        for (let x = 0; x < W; x++) if (fb[y * W + x]) n++;
        if (n >= RULE_MIN) rows.push(y);
    }
    return rows;
}

_log('schwung-one-bank-bar: exactly one bank bar, whoever draws the body\n');

/* How many segments the bar is divided into — the count it is indexing. Read
 * from the gaps in the rule, so it measures what was DRAWN rather than what
 * either engine says it drew. */
function barSegments(row) {
    let runs = 0, inRun = false;
    for (let x = 0; x < W; x++) {
        const on = !!fb[row * W + x];
        if (on && !inRun) runs++;
        inRun = on;
    }
    return runs;
}

let movyChainSlots = 0;
for (const [label, view] of [['VIEW_KNOBS', VIEW_KNOBS], ['VIEW_CHAIN', VIEW_CHAIN]]) {
    /* movy alone is the REFERENCE, not a constant: the point is that turning
     * the grid on does not ADD a bar. A hardcoded 1 would pass if movy's own
     * renderer ever grew a second one. */
    setSchwungGridMode('off');
    boot('plaits', view);
    const movyRules = rulesAboveBody();
    if (label === 'VIEW_CHAIN' && movyRules.length) movyChainSlots = barSegments(movyRules[0]);

    setSchwungGridMode('page');
    boot('plaits', view);
    const gridRules = rulesAboveBody();

    _log(`${label}:  movy draws rules at rows [${movyRules}]   `
       + `grid draws them at rows [${gridRules}]`);
    if (gridRules.length === movyRules.length) {
        ok(`${label}: the grid adds no second bar (${gridRules.length} rule row(s), same as movy)`);
    } else {
        fail(`${label}: movy draws ${movyRules.length} full-width rule row(s) above the body, `
           + `the grid draws ${gridRules.length}. Both schwung-page.ts (BANDS.bank) and `
           + `knob-view.ts/chain-view.ts (drawBankBar) are drawing one.`);
    }

    /*
     * ...AND IT MUST COUNT THE RIGHT THING. Deleting Schwung's bar and leaving
     * movy's stale one would pass the count above while the bar still indexed
     * banks the jog no longer moves — which is the bug this half exists for.
     * Segments are read off the drawn rule, not asked of either engine.
     */
    const segs = gridRules.length ? barSegments(gridRules[0]) : 0;
    const sp = schwungPageFor(0, 'synth');
    if (label === 'VIEW_KNOBS') {
        if (segs === sp.pageCount) {
            ok(`VIEW_KNOBS: the bar counts SCHWUNG's ${sp.pageCount} pages, which is what the jog moves`);
        } else {
            fail(`VIEW_KNOBS: the bar is divided into ${segs} segments but Schwung has `
               + `${sp.pageCount} pages. Under the grid the jog pages Schwung's set, so a bar `
               + `counting anything else sits still while the body pages.`);
        }
    } else {
        /* The chain view's jog moves CHAIN SLOTS, so its bar must NOT have been
         * repointed at Schwung's pages. */
        if (segs !== sp.pageCount || sp.pageCount === movyChainSlots) {
            ok(`VIEW_CHAIN: the bar still counts chain slots (${segs}), not Schwung's `
             + `${sp.pageCount} pages — the fx-slot indicator survives`);
        } else {
            fail(`VIEW_CHAIN: the bar counts ${segs}, the same as Schwung's page count. This `
               + `view's jog moves chain slots; repointing its bar at pages loses the only `
               + `thing naming which fx slot you are on.`);
        }
    }
}

setSchwungGridMode('off');
if (failed) { _log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
_log('\n\x1b[32m\x1b[1mPASS: one bank bar on both views — the grid does not add a second.\x1b[0m');
