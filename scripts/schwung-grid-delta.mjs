#!/usr/bin/env node
/* schwung-grid-delta.mjs — how different is Schwung's knob grid from movy's?
 *
 * Phase 1 of docs/plans/2026-08-28-param-pages-embeddable.md (schwung repo):
 * before proposing that movy drop its own knob widgets and draw Schwung's, put
 * a NUMBER on what that would change. Both engines plan and draw from the same
 * declared contract — movy's mock presets are `synth:ui_hierarchy` +
 * `synth:chain_params`, which is exactly what Schwung's planner consumes — so
 * the same preset can be rendered through both and the frames compared.
 *
 * This measures; it changes nothing. movy's own renderer is untouched.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-grid-delta.mjs [--png]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installEnv } from '../browser-test/env.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const MOVY = join(__dir, '..');
const SCHWUNG = process.env.SCHWUNG;
if (!SCHWUNG) { console.error('set SCHWUNG=/path/to/schwung'); process.exit(2); }
const WANT_PNG = process.argv.includes('--png');
/* Separates "the two engines draw the same widget differently" from "the two
 * engines chose a DIFFERENT WIDGET" — Schwung's viz detector groups cells into
 * one picture where movy draws discrete knobs. */
const NO_VIZ = process.argv.includes('--no-viz');

const W = 128, H = 64;

/* ── movy side ───────────────────────────────────────────────────────────── */

/* movy draws through these globals; capture into a 1-bit buffer so the two
 * engines are compared in the same representation. */
let movyFb = new Uint8Array(W * H);
const paint = (x, y, w, h, v) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) movyFb[yy * W + xx] = v ? 1 : 0;
};
const env = installEnv();
globalThis.fill_rect = (x, y, w, h, v) => paint(x, y, w, h, v);
globalThis.clear_screen = () => paint(0, 0, W, H, 0);

const { createModel } = await import('../dist/esm/model/index.js');
const { portFor } = await import('../dist/esm/track/registry.js');
const { renderKnobsView } = await import('../dist/esm/renderer/knob-view.js');
const { MOCK_SYNTHS } = await import('../browser-test/mock-synth.mjs');

const model = createModel(portFor(0), 'synth');

/* The model resolves its params over ticks, so a VM read straight after
 * reload() describes a module that has not loaded yet — which is what a first
 * cut of this script measured, reporting an identical 91 ink pixels for every
 * preset because every one of them rendered the same empty page. */
function settle() {
    let idle = 0, total = 0;
    while (idle < 5 && total < 200) {
        const dirty = model.tick();
        idle = dirty ? 0 : idle + 1;
        total++;
    }
}

function movyRender(presetId, pageIndex) {
    env.setParams(MOCK_SYNTHS[presetId]);
    model.reset(); model.reload();
    settle();
    if (pageIndex) { model.changePage(pageIndex); settle(); }
    movyFb = new Uint8Array(W * H);
    renderKnobsView(model.getViewModel());
    const vm = model.getViewModel();
    const names = [];
    for (const row of (vm.rows || [])) {
        for (const c of row) names.push(c ? String(c.fullName || c.shortName || '').toUpperCase() : null);
    }
    return { fb: movyFb, vm, names };
}

/* ── schwung side ────────────────────────────────────────────────────────── */

const P  = await import(join(SCHWUNG, 'src/shared/param_pages/page_plan.mjs'));
const M  = await import(join(SCHWUNG, 'src/shared/param_pages/param_meta.mjs'));
const RM = await import(join(SCHWUNG, 'src/shared/param_pages/render_page_movy.mjs'));
const V  = await import(join(SCHWUNG, 'src/shared/param_pages/viz.mjs'));
const HR = await import(join(SCHWUNG, 'tools/param-pages/harness.mjs'));

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

function schwungRender(presetId, pageIndex, bands) {
    const raw = MOCK_SYNTHS[presetId];
    const hierarchy = parse(raw['synth:ui_hierarchy']);
    const chainParams = parse(raw['synth:chain_params']);
    const { pages } = P.planPages({ hierarchy, chainParams, mode: null, visible: null });
    const metaIndex = M.buildMetaIndex({ hierarchy, chainParams });

    /* Values come from the same mock params, keyed bare the way the grid
     * addresses them. */
    const values = {};
    for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith('synth:')) values[k.slice(6)] = v;
    }

    const page = pages[pageIndex];
    if (!page || page.kind !== P.PAGE_KNOBS) return null;

    const fb = HR.createFramebuffer();
    const groups = NO_VIZ ? [] : V.resolveViz({ keys: page.keys || [], metaIndex }).groups;
    RM.renderPageMovy(HR.drawContext(fb), {
        page, metaIndex, values,
        title: presetId, pageIndex, pageCount: pages.length,
        touched: -1, viz: groups, bands,
    });
    const names = (page.keys || []).map(k => {
        if (!k) return null;
        const m = metaIndex.getOrGuess(k);
        return String((m && (m.label || m.key)) || k).toUpperCase();
    });
    return { fb: fb.pixels, pages, page, names, clipped: fb.clipped ? fb.clipped() : 0 };
}

/* ── compare ─────────────────────────────────────────────────────────────── */

function diff(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if ((a[i] ? 1 : 0) !== (b[i] ? 1 : 0)) n++;
    return n;
}
/* Per-band, because a difference in the header is a different argument from a
 * difference in the widgets: movy keeps its own header under the plan that
 * matters, so header pixels are not part of what it would inherit. */
function bandDiff(a, b, y0, y1) {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if ((a[i] ? 1 : 0) !== (b[i] ? 1 : 0)) n++;
    }
    return n;
}
const ink = (fb, y0, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (fb[y * W + x]) n++;
    return n;
};

/* Presets whose synth mock is a plain knob page in both engines. */
const CASES = [
    ['test8', 0], ['test16', 0], ['test_enum', 0], ['test_steps', 0],
    ['obxd_like', 1], ['obxd_like', 3], ['plaits', 0], ['wurl', 0],
    ['forge', 0], ['signal', 0], ['env_dual', 0], ['env_ad', 0],
    ['filter_demo', 0], ['eq_bands', 0], ['cut_filters', 0], ['faders', 0],
    ['switches', 0], ['wave_cells', 0], ['env_stages', 0], ['triggers', 0],
];

const BODY_Y0 = RM.ROW0_Y, BODY_Y1 = RM.LBL1_Y + 7;

const rows = [];
for (const [id, pg] of CASES) {
    if (!MOCK_SYNTHS[id]) { rows.push({ id, pg, note: 'no such mock' }); continue; }
    let m, s;
    try { m = movyRender(id, pg); } catch (e) { rows.push({ id, pg, note: 'movy: ' + e.message }); continue; }
    try { s = schwungRender(id, pg); } catch (e) { rows.push({ id, pg, note: 'schwung: ' + e.message }); continue; }
    if (!s) { rows.push({ id, pg, note: 'schwung planned no knob page here' }); continue; }

    /* DO THE TWO ENGINES HAVE THE SAME PARAMS ON THIS PAGE?
     * Schwung paginates overflow (knobs[] is the author's chosen eight, not
     * their parameter set), so page N on one side is not necessarily page N on
     * the other. Comparing pixels across two different parameter sets would
     * produce a large, meaningless delta. Names are the only shared handle —
     * the VM carries no key — so alignment is judged on those. */
    const alignedCells = m.names.filter((n, i) => n && s.names[i] && n === s.names[i]).length;
    const filledCells = Math.max(m.names.filter(Boolean).length, s.names.filter(Boolean).length);
    const aligned = filledCells > 0 && alignedCells === filledCells;

    rows.push({
        id, pg, aligned, alignedCells, filledCells,
        total: diff(m.fb, s.fb),
        header: bandDiff(m.fb, s.fb, 0, RM.ROW0_Y),
        body: bandDiff(m.fb, s.fb, BODY_Y0, BODY_Y1),
        footer: bandDiff(m.fb, s.fb, BODY_Y1, H),
        movyInk: ink(m.fb, BODY_Y0, BODY_Y1),
        schwungInk: ink(s.fb, BODY_Y0, BODY_Y1),
        clipped: s.clipped,
    });

    if (WANT_PNG) {
        const dir = join(MOVY, 'schwung-delta');
        mkdirSync(dir, { recursive: true });
        const toPgm = (fb) => {
            const out = [`P2\n${W} ${H}\n1`];
            for (let y = 0; y < H; y++) {
                const line = [];
                for (let x = 0; x < W; x++) line.push(fb[y * W + x] ? 1 : 0);
                out.push(line.join(' '));
            }
            return out.join('\n');
        };
        writeFileSync(join(dir, `${id}-${pg}-movy.pgm`), toPgm(m.fb));
        writeFileSync(join(dir, `${id}-${pg}-schwung.pgm`), toPgm(s.fb));
    }
}

const all = rows.filter(r => r.total !== undefined);
/* Only aligned pages carry a meaningful pixel delta. */
const ok = all.filter(r => r.aligned);
const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(pad('preset', 16) + pad('pg', 4) + pad('same?', 7) + pad('total', 8)
            + pad('header', 8) + pad('body', 8) + pad('footer', 8)
            + pad('movy ink', 10) + pad('schw ink', 10));
console.log('-'.repeat(82));
for (const r of rows) {
    if (r.note) { console.log(pad(r.id, 16) + pad(r.pg, 4) + r.note); continue; }
    console.log(pad(r.id, 16) + pad(r.pg, 4)
                + pad(r.aligned ? 'yes' : `${r.alignedCells}/${r.filledCells}`, 7)
                + pad(r.total, 8) + pad(r.header, 8)
                + pad(r.body, 8) + pad(r.footer, 8) + pad(r.movyInk, 10) + pad(r.schwungInk, 10));
}
/* SELF-CHECK. If movy renders the same ink for every preset it is drawing the
 * same page every time — an unloaded model, not a real similarity — and every
 * number below is noise. This is the failure the first run actually had. */
{
  const inks = new Set(ok.map(r => r.movyInk));
  if (ok.length > 3 && inks.size < 3) {
    console.error(`\nABORT: movy body ink takes only ${inks.size} distinct value(s) `
      + `across ${ok.length} pages (${[...inks].join(', ')}). The model is not loading `
      + `the preset; these numbers would be meaningless.`);
    process.exit(3);
  }
}

const sum = (f) => ok.reduce((a, r) => a + f(r), 0);
const PIXELS = W * H;
console.log('-'.repeat(72));
console.log(`${ok.length} ALIGNED pages of ${all.length} rendered, ${rows.length} cases`);
if (all.length !== ok.length) {
    console.log(`  (${all.length - ok.length} excluded: the two engines put different params `
        + `on that page, so their pixel delta says nothing about widget style)`);
}
if (ok.length) {
    console.log(`mean total delta : ${(sum(r => r.total) / ok.length).toFixed(0)} px `
        + `(${(100 * sum(r => r.total) / (ok.length * PIXELS)).toFixed(1)}% of the screen)`);
    console.log(`mean BODY delta  : ${(sum(r => r.body) / ok.length).toFixed(0)} px `
        + `(${(100 * sum(r => r.body) / (ok.length * W * (BODY_Y1 - BODY_Y0))).toFixed(1)}% of the body band)`);
    console.log(`body ink movy    : ${sum(r => r.movyInk)}   schwung: ${sum(r => r.schwungInk)}`);
    const clip = sum(r => r.clipped || 0);
    console.log(`schwung pixels drawn off-screen: ${clip}`);
}
