#!/usr/bin/env node
/* schwung-page-kinds-check.mjs — EVERY page kind draws, not just knobs.
 *
 * Reported from the device: "the presets page doesn't render". It did not.
 * schwung-page.ts planned the pages itself and called renderPageMovy, which
 * draws knob pages and nothing else — the preset, items, menu and child kinds
 * are drawn by Schwung's page_controller, which that code bypassed. A second
 * implementation, failing the way second implementations do.
 *
 * So this walks a module's WHOLE page set and requires ink on every page. A
 * kind that renders blank is the bug; a kind that renders is the point.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-page-kinds-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
const paint = (x, y, w, h, v) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) fb[yy * W + xx] = v ? 1 : 0;
};
const env = installEnv();
globalThis.fill_rect = (x, y, w, h, v) => paint(x, y, w, h, v);
globalThis.clear_screen = () => paint(0, 0, W, H, 0);

const { portFor } = await import('../dist/esm/track/registry.js');
const { createSchwungPage } = await import('../dist/esm/renderer/schwung-page.js');
const { MOCK_SYNTHS } = await import('../browser-test/mock-synth.mjs');

const fail = (m) => { console.log('FAIL: ' + m); process.exit(1); };
const ink = (g) => g.reduce((a, v) => a + (v ? 1 : 0), 0);

/* movy's header band. Schwung is asked not to draw it, so ink there would mean
 * the embedding is scribbling on movy's chrome. */
const HEADER_ROWS = 7;
const inkIn = (g, y0, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (g[y * W + x]) n++;
    return n;
};

/* obxd_like's first page is a PRESET page — the exact kind reported blank. */
const CASES = ['obxd_like', 'dexed_like', 'plaits', 'test16', 'mrdrums'];

let checkedPages = 0, kinds = new Set();

for (const preset of CASES) {
    if (!MOCK_SYNTHS[preset]) continue;
    env.setParams(MOCK_SYNTHS[preset]);
    const sp = createSchwungPage(portFor(0), 'synth');
    for (let i = 0; i < 200 && !sp.ready; i++) sp.tick();
    if (!sp.ready) { console.log(`  ${preset}: no contract, skipped`); continue; }

    for (let p = 0; p < sp.pageCount; p++) {
        sp.goToPage(p);
        for (let i = 0; i < 30; i++) sp.tick();   /* let the read cursor fill */
        const kind = sp.ctl.page ? sp.ctl.page.kind : '(none)';
        kinds.add(kind);

        fb = new Uint8Array(W * H);
        sp.render('T1 > ' + preset, undefined, -1);
        const total = ink(fb);
        const body = inkIn(fb, HEADER_ROWS, H);
        checkedPages++;

        if (!body) {
            fail(`${preset} page ${p} (kind=${kind}) drew NOTHING below movy's header. `
               + `That is the reported bug: a page kind with no renderer behind it.`);
        }
        /* And Schwung must not paint movy's header band. */
        const head = inkIn(fb, 0, HEADER_ROWS);
        if (head) {
            fail(`${preset} page ${p} (kind=${kind}) drew ${head} px into movy's header `
               + `band — bands: {header:false} was not honoured for this kind`);
        }
        if (total < 20) fail(`${preset} page ${p} (kind=${kind}) drew only ${total} px`);
    }
    console.log(`  ${preset}: ${sp.pageCount} pages, all drawn`);
}

if (checkedPages < 10) fail(`only ${checkedPages} pages checked — too few to mean anything`);
/* The whole point is coverage BEYOND knobs. If the fixture only ever produced
 * knob pages this check would pass while proving nothing about presets. */
if (kinds.size < 2) {
    fail(`only one page kind (${[...kinds]}) appeared across ${checkedPages} pages — `
       + `this check is not exercising the kinds it exists for`);
}
if (!kinds.has('preset')) {
    fail(`no PRESET page in the whole sweep, and that is the kind that was reported `
       + `blank. Kinds seen: ${[...kinds].join(', ')}`);
}

console.log('');
console.log(`PASS: ${checkedPages} pages across ${CASES.length} modules, kinds: `
    + `${[...kinds].sort().join(', ')} — every one draws, none touches movy's header.`);
