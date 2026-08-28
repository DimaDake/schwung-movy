#!/usr/bin/env node
/* schwung-grid-preview.mjs — movy's UI, with Schwung's widgets in the body.
 *
 * Boots movy's real model and its real renderKnobsView, flips the flag, and
 * prints the frame. movy's header, bank bar and overlays are movy's in both
 * shots; only the body band changes hands.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-grid-preview.mjs [preset] [page]
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

const { createModel } = await import('../dist/esm/model/index.js');
const { portFor } = await import('../dist/esm/track/registry.js');
const { renderKnobsView } = await import('../dist/esm/renderer/knob-view.js');
const { setSchwungGrid } = await import('../dist/esm/renderer/schwung-flag.js');
const { MOCK_SYNTHS } = await import('../browser-test/mock-synth.mjs');

const preset = process.argv[2] || 'test8';
const page = parseInt(process.argv[3] || '0', 10);
const model = createModel(portFor(0), 'synth');

function settle() {
    let idle = 0, total = 0;
    while (idle < 5 && total < 200) {
        const dirty = model.tick();
        idle = dirty ? 0 : idle + 1;
        total++;
    }
}

/* An automation lane on knob 0, so the p-lock mark has something to draw. This
 * is the sequencer half of the seam: movy owns the lane, Schwung draws it. */
/* laneForKey is asked with the RAW param key (viewmodel.ts:103), not the
 * component-qualified one and not the label — the first cut matched on
 * fullName, which is the LABEL, so no cell was ever automated and the mark
 * silently drew nothing. Latching the first key it is asked about marks exactly
 * one cell whatever the preset. */
let lanedKey = null;
const auto = {
    assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
    heldValues: new Map(), liveValues: new Map(),
    laneForKey: (k) => {
        if (lanedKey === null && k) lanedKey = k;
        return k && k === lanedKey ? 0 : -1;
    },
};

function shot(useSchwung, withAutomation) {
    env.setParams(MOCK_SYNTHS[preset]);
    model.reset(); model.reload(); settle();
    if (page) { model.changePage(page); settle(); }
    setSchwungGrid(useSchwung);
    fb = new Uint8Array(W * H);
    const vm = model.getViewModel(withAutomation ? auto : undefined);
    renderKnobsView(vm, false, 0);
    return { fb: fb.slice(), vm };
}

const art = (g) => {
    const out = [];
    for (let y = 0; y < H; y += 2) {
        let row = '';
        for (let x = 0; x < W; x++) {
            const t = g[y * W + x], b = (y + 1 < H) ? g[(y + 1) * W + x] : 0;
            row += [' ', '▀', '▄', '█'][t + b * 2];
        }
        out.push(row);
    }
    return out.join('\n');
};

const movy = shot(false, false);
const schwung = shot(true, false);
const schwungAuto = shot(true, true);

console.log(`\n=== ${preset} page ${page} — MOVY (its own widgets) ===`);
console.log(art(movy.fb));
console.log(`\n=== ${preset} page ${page} — MOVY header + SCHWUNG widgets ===`);
console.log(art(schwung.fb));
console.log(`\n=== ${preset} page ${page} — SCHWUNG widgets, knob 0 automated (p-lock mark) ===`);
console.log(art(schwungAuto.fb));

let d = 0;
for (let i = 0; i < fb.length; i++) if (movy.fb[i] !== schwung.fb[i]) d++;
let dAuto = 0;
for (let i = 0; i < fb.length; i++) if (schwung.fb[i] !== schwungAuto.fb[i]) dAuto++;
const inkOf = (g) => g.reduce((a, v) => a + (v ? 1 : 0), 0);

console.log(`\nink  movy=${inkOf(movy.fb)}  schwung=${inkOf(schwung.fb)}`);
console.log(`body swap changes ${d} px`);
console.log(`automation mark changes ${dAuto} px  ` +
    (dAuto > 0 ? '(the sequencer reaches the grid)' : '(NOTHING DREW — the lane did not reach it)'));

/* Header must be movy's in every shot: the whole point of the band split. */
let headerDiff = 0;
for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) {
    if (movy.fb[y * W + x] !== schwung.fb[y * W + x]) headerDiff++;
}
console.log(`header pixels changed by the swap: ${headerDiff}  `
    + (headerDiff === 0 ? '(movy kept its chrome)' : '(!! the body swap moved movy chrome)'));
