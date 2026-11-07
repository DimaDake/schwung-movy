/* Variety bench (variety.mjs): do the metrics tell scenes apart, and do the
 * generators give different parts each time?
 *
 *   npm run build:browser && node scripts/gen-bench/quality/variety-run.mjs --label base [--presses 10] [--seeds 4]
 *
 * Writes .gen-data/variety/<label>/report.md and result.json. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { sceneA, sceneB } from './chains.mjs';
import { emptySet, orders, runPaths } from './paths.mjs';
import { loadBands } from './paths-score.mjs';
import { relations } from './relations.mjs';
import { copySet, ROLE } from './scene.mjs';
import { messy } from '../../../browser-test/gen-fixtures.mjs';
import { metricSpread, optionVariety, presses, takeVariety } from './variety.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', 'variety'), R = Number(arg('presses', 10)), SEEDS = Number(arg('seeds', 4));
const { refs, bands } = loadBands(DATA);
const G = await import('../../../dist/esm/gen/index.js');
const t0 = Date.now();
const f2 = (x) => (x === null || x === undefined ? '–' : x.toFixed(2));
const pct = (x) => `${Math.round(x * 100)}%`;
const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);

/* 1. Metrics: generated (New Clip in every order, scene B by Variation) against real. */
const As = Array.from({ length: SEEDS }, (_, s) => sceneA(G, s));
const gen = [...runPaths(G, 6).map((p) => relations(p.scene)),
    ...As.flatMap((A, s) => orders().filter((_, k) => k % 4 === 0).map((o) => relations(sceneB(G, A, s, o, bands).scene)))];
const spread = metricSpread(gen, refs.map((r) => r.m));
const mLines = spread.map(({ k, g, r, flag }) => `| ${k} | ${g.distinct} / ${r.distinct} | ${pct(g.mode)} / ${pct(r.mode)} | ${f2(g.lo)}–${f2(g.hi)} | ${f2(r.lo)}–${f2(r.hi)} | ${flag ? '**' + flag + '**' : ''} |`);

/* 2. New Clip pressed again and again: in an empty Set, and in a band (scene A without the part). */
const agg = new Map();
const add = (where, by) => { for (const [id, takes] of by) { const key = `${id}|${where}`; if (!agg.has(key)) agg.set(key, []); agg.get(key).push(takeVariety(G, takes)); } };
for (let s = 0; s < SEEDS; s++) {
    for (const i of [0, 1, 2, 3]) {
        const len = [64, 128][s % 2];
        add('empty', presses(G, emptySet(s), i, len, R, s));
        const band = copySet(As[s]);
        band.tracks[i].clips = [];
        add('in a band', presses(G, band, i, As[s].tracks[i].clips[0]?.len ?? len, R, s));
    }
}
const narrow = (v) => v.apart < 0.3 || v.top > 0.4 || v.rhythms / v.n < 0.5;
const pLines = [...agg].sort().map(([key, vs]) => {
    const [id, where] = key.split('|');
    const v = { n: mean(vs.map((x) => x.n)), apart: mean(vs.map((x) => x.apart ?? 0)), rhythms: mean(vs.map((x) => x.rhythms)), top: mean(vs.map((x) => x.top)), knobs: mean(vs.map((x) => x.knobs)) };
    return `| ${id} | ${where} | ${f2(v.apart)} | ${v.rhythms.toFixed(1)} / ${v.n.toFixed(0)} | ${pct(v.top)} | ${v.knobs.toFixed(1)} | ${narrow(v) ? '**low**' : ''} |`;
});

/* 3. Across scenes: one press of each generator in each scene A (part removed). */
const scenes = new Map();
for (let s = 0; s < SEEDS; s++) for (const i of [0, 1, 2, 3]) {
    const band = copySet(As[s]);
    band.tracks[i].clips = [];
    for (const [id, takes] of presses(G, band, i, As[s].tracks[i].clips[0]?.len ?? 64, 1, s + 50)) {
        if (!scenes.has(id)) scenes.set(id, []);
        scenes.get(id).push(takes[0]);
    }
}
const sLines = [...scenes].sort().map(([id, takes]) => { const v = takeVariety(G, takes); return `| ${id} | ${v.n} | ${v.rhythms} | ${pct(v.top)} | ${v.top > 0.5 ? '**one rhythm**' : ''} |`; });

/* 4. Variation, Double, Smart Quantize: the six, a second press, SEED; and
 * Variation across scenes (the option kept first, its rhythm). */
const TASKS = ['variation', 'double', 'quantize'];
const vv = As.flatMap((A) => TASKS.flatMap((task) => [0, 1, 2, 3].map((i) => optionVariety(G, A, i, task, messy)))).filter(Boolean);
const vLines = TASKS.flatMap((task) => ROLE.map((r) => { const xs = vv.filter((x) => x.task === task && x.role === r);
    return xs.length ? `| ${task} | ${r} | ${f2(mean(xs.map((x) => x.apart)))} | ${pct(mean(xs.map((x) => (x.same ? 1 : 0))))} |` : null; }).filter(Boolean));
const seedBy = new Map();
for (const x of vv) for (const s of x.seeds) { if (!seedBy.has(s.id)) seedBy.set(s.id, []); seedBy.get(s.id).push(s); }
const seedLines = [...seedBy].sort().map(([id, ss]) => `| ${id} | ${ss.length} | ${f2(mean(ss.map((s) => s.apart ?? 0)))} | ${mean(ss.map((s) => s.distinct)).toFixed(1)} / ${mean(ss.map((s) => s.n)).toFixed(0)} | ${mean(ss.map((s) => s.apart ?? 0)) < 0.2 ? '**low**' : ''} |`);

const md = `# Variety bench: ${label}\n\n${gen.length} generated scenes against ${refs.length} real; ${R} presses × ${SEEDS} seeds; ${Date.now() - t0} ms.\n\n`
    + `## 1. Do the metrics tell scenes apart?\n\nValues (rounded to 0.01) and the share of the commonest, generated / real; the P10–P90 range of each. `
    + `"generators constant": one value in 90% of generated scenes where real ones vary; "generators narrow": under 35% of the real width; "measures nothing": constant in both.\n\n`
    + `| metric | distinct values | commonest | generated P10–P90 | real P10–P90 | flag |\n|---|---|---|---|---|---|\n${mLines.join('\n')}\n\n`
    + `## 2. New Clip pressed again and again\n\nPer generator, the mean over ${SEEDS} scenes of ${R} presses (options offered lately remembered, as on the device): `
    + `apart = mean distance between its takes (0 same, 1 nothing shared); rhythms = distinct onset patterns; top = how often the commonest comes back; knobs = distinct knob settings. **low**: apart < 0.3, top > 40% or rhythms under half the presses.\n\n`
    + `| generator | where | apart | rhythms | top | knobs | |\n|---|---|---|---|---|---|---|\n${pLines.join('\n')}\n\n`
    + `## 3. The same generator across scenes (first press in each)\n\n| generator | scenes | rhythms | commonest | |\n|---|---|---|---|---|\n${sLines.join('\n')}\n\n`
    + `## 4. Variation, Smart Double, Smart Quantize\n\nThe six options' mean distance, and how often a second press gives the same six.\n\n`
    + `| task | part | six apart | same on a second press |\n|---|---|---|---|\n${vLines.join('\n')}\n\n`
    + `SEED turned 0-5 on each option that has it:\n\n| option | n | apart | distinct takes | |\n|---|---|---|---|---|\n${seedLines.join('\n')}\n`;
const dir = DATA + `variety/${label}/`;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'report.md', md);
writeFileSync(dir + 'result.json', JSON.stringify({ label, spread, presses: [...agg], scenes: [...scenes].map(([id, t]) => [id, takeVariety(G, t)]), variation: vv }));
console.log(md);
