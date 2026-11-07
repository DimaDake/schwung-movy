/* Evolving a Set with generators only, and generators over real music
 * (plans/2026-11-07-generation-paths-bench.md): chains.mjs and loo.mjs, judged
 * against real scenes.
 *
 *   npm run build:browser && node scripts/gen-bench/quality/chains-run.mjs --label base [--seeds 6] [--loo 300]
 *
 * Writes .gen-data/chains/<label>/: report.md, result.json, rolls/ (scene A and
 * B side by side for a few B orders). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { depthChain, doubled, quantized, rhythmOf, sceneA, sceneB } from './chains.mjs';
import { leaveOneOut } from './loo.mjs';
import { orders } from './paths.mjs';
import { expTable, inBand, loadBands, score, table } from './paths-score.mjs';
import { relations } from './relations.mjs';
import { roll } from './roll.mjs';
import { ROLE, sceneAt, scaleOf } from './scene.mjs';
import { judgeRole } from './keep.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', 'chains'), SEEDS = Number(arg('seeds', 6)), LOO = Number(arg('loo', 1000));
const { raw, bands } = loadBands(DATA);
const G = await import('../../../dist/esm/gen/index.js');
const t0 = Date.now();
const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '–' : `${Math.round(x * 100)}%`);
const med = (v) => { const s = v.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const f2 = (x) => (x === null ? '–' : x.toFixed(2));
/** The share of a role's metrics in band, over rows of measured scenes. */
const usable = (ms, role) => ms.filter((m) => judgeRole(m, bands, role).ok).length / Math.max(1, ms.length);
const fails = (ms, role) => {
    const c = new Map();
    for (const m of ms) for (const b of judgeRole(m, bands, role).bad) c.set(b, (c.get(b) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ') || '–';
};
/** Mean pairwise distance of rhythms (onset sets) across seeds: 0 = all the same. */
const spread = (rs) => { let d = 0, n = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = new Set(rs[i]), b = new Set(rs[j]); const both = [...a].filter((x) => b.has(x)).length; d += 1 - both / (a.size + b.size - both || 1); n++; } return n ? d / n : null; };

const As = Array.from({ length: SEEDS }, (_, s) => sceneA(G, s));

/* 1. Scene B by Variation, every order. */
const Bs = As.flatMap((A, s) => orders().map((o) => sceneB(G, A, s, o, bands)));
const bRows = Bs.map((b) => ({ ...b, m: relations(b.scene) }));
const aRows = As.map((A) => relations(sceneAt(A, 0, scaleOf(A))));
const bKept = ROLE.map((r) => `| ${r} | ${pct(usable(aRows, r))} | ${pct(usable(bRows.map((b) => b.m), r))} | ${f2(med(Bs.map((b) => b.kept[r]?.notes)))} | ${f2(med(Bs.map((b) => b.kept[r]?.rhythm)))} | ${fails(bRows.map((b) => b.m), r)} |`);
/* Per Variation generator: how much of A's part it keeps, the user's Step 14 New Clip options included. */
const byVar = new Map();
for (const b of Bs) for (const [r, k] of Object.entries(b.kept)) { const key = `${r} ${k.preset}`; if (!byVar.has(key)) byVar.set(key, []); byVar.get(key).push(k); }
const varLines = [...byVar].sort().map(([k, ks]) => `| ${k} | ${ks.length} | ${f2(med(ks.map((x) => x.notes)))} | ${f2(med(ks.map((x) => x.rhythm)))} |`);

/* 2. Variation depth. */
const depth = As.flatMap((A, s) => ROLE.map((_, i) => depthChain(G, A, s, i, bands)));
const nudge = As.flatMap((A, s) => [1, 2, 3].map((i) => depthChain(G, A, s, i, bands, 5, 'v-nudge')));
const depthTable = (chains, roles) => roles.flatMap((r) => [0, 1, 2, 3, 4, 5].map((d) => {
    const rows = chains.filter((c) => c.role === r).map((c) => c.rows[d]).filter(Boolean);
    return `| ${r} | ${d} | ${rows.length} | ${pct(usable(rows.map((x) => x.m), r))} | ${f2(med(rows.map((x) => x.identity)))} | ${f2(med(rows.map((x) => x.rhythmId ?? 1)))} | ${f2(med(rows.map((x) => x.step ?? null)))} | ${f2(spread(rows.map((x) => x.rhythm)))} | ${d ? fails(rows.map((x) => x.m), r) : ''} |`;
}));
const depthLines = depthTable(depth, ROLE), nudgeLines = depthTable(nudge, ROLE.slice(1));

/* 3. Smart Double, 4. Smart Quantize. */
const dbl = As.map((A, s) => doubled(G, A, s, bands));
const qnt = As.flatMap((A, s) => ROLE.map((_, i) => quantized(G, A, s, i, bands)));
const qLines = ROLE.map((r) => { const q = qnt.filter((x) => x.role === r);
    return `| ${r} | ${q.length} | ${pct(usable(q.map((x) => x.m), r))} | ${f2(med(q.map((x) => x.loose)))} | ${f2(med(q.map((x) => x.back)))} | ${fails(q.map((x) => x.m), r)} |`; });

/* 5. Leave one out over the real scenes. */
const loo = raw.slice(0, LOO).flatMap((ref) => leaveOneOut(G, ref, bands));
const looLines = [];
for (const r of ROLE) for (const kind of ['user', 'public']) {
    const rs = loo.filter((x) => x.role === r && x.kind === kind);
    if (!rs.length) continue;
    const presets = [...new Set(rs.flatMap((x) => x.options.map((o) => o.preset)))];
    looLines.push(`| ${r} | ${kind} | ${rs.length} | ${pct(rs.filter((x) => x.real.ok).length / rs.length)} | ${pct(rs.filter((x) => x.options.some((o) => o.abs)).length / rs.length)} | ${pct(rs.filter((x) => x.options.some((o) => o.ok)).length / rs.length)} | `
        + presets.map((p) => { const os = rs.flatMap((x) => x.options.filter((o) => o.preset === p)); return `${p.replace('n-', '')} ${pct(os.filter((o) => o.ok).length / os.length)}`; }).join(', ')
        + ` | ${(() => { const c = new Map(); for (const x of rs) for (const o of x.options) for (const b of o.bad) c.set(b, (c.get(b) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', '); })()} |`);
}

const exps = [...Bs.flatMap((b) => b.exps), ...depth.flatMap((c) => c.rows.slice(1).map((x) => ({ task: 'depth', role: c.role, ...x.exp }))),
    ...dbl.flatMap((d) => d.exps), ...qnt.map((q) => ({ task: 'quantize', role: q.role, ...q.exp })), ...loo.map((x) => x.exp)];

const dir = DATA + `chains/${label}/`;
mkdirSync(dir + 'rolls', { recursive: true });
for (const b of bRows.filter((_, k) => k % 37 === 0)) {
    const A = As[b.seed];
    writeFileSync(dir + `rolls/s${b.seed}-${b.order.map((x) => x[0]).join('')}.txt`, roll(sceneAt(A, 0, scaleOf(A)), `A seed ${b.seed} ${A.root} ${A.mode}`) + '\n\n' + roll(b.scene, `B ${b.order.join('>')} ${JSON.stringify(b.picks)}`) + '\n');
}
const md = `# Chains bench: ${label}\n\n${SEEDS} seeds, ${Bs.length} B scenes, ${depth.length} depth chains, ${loo.length} leave-one-out parts; ${Date.now() - t0} ms.\n`
    + `Usable = at most one metric touching the part, or the scene's own, outside the real scenes' band (keep.mjs SLACK; real parts in the user's scenes: 74-82%).\n\n`
    + `## 1. Scene B by Variation, every order\n\n"before"/"after": the metric's first role varied before/after its second in B.\n\n${table(score(bRows, bands), null)}\n\n`
    + `| part | usable in A | usable in B | notes kept of A (1 = copy) | rhythm kept of A | B fails most on |\n|---|---|---|---|---|---|\n${bKept.join('\n')}\n\n`
    + `| part and the Variation kept | n | notes kept | rhythm kept |\n|---|---|---|---|\n${varLines.join('\n')}\n\n`
    + `## 2. Variation, again and again\n\nIdentity: 1 - distance to A's part; step: distance to the depth before; spread: how different the rhythms are across seeds (falling = collapse).\n\n`
    + `| part | depth | n | usable | identity (notes) | identity (rhythm) | step | spread | fails most on |\n|---|---|---|---|---|---|---|---|---|\n${depthLines.join('\n')}\n\n`
    + `### Keeping NUDGE every time (the small steps)\n\n| part | depth | n | usable | identity (notes) | identity (rhythm) | step | spread | fails most on |\n|---|---|---|---|---|---|---|---|---|\n${nudgeLines.join('\n')}\n\n`
    + `## 3. Smart Double (every track, slot 2)\n\nScenes usable for every part: ${pct(dbl.filter((d) => ROLE.every((r) => judgeRole(d.m, bands, r).ok)).length / dbl.length)}; parts realign: ${pct(dbl.filter((d) => d.m.realign !== 0).length / dbl.length)}.\n\n`
    + `## 4. Smart Quantize (option 1) of a loosely played part\n\nloose / back: likeness to the clean part before and after.\n\n| part | n | usable | loose | back | fails most on |\n|---|---|---|---|---|---|\n${qLines.join('\n')}\n\n`
    + `## 5. Leave one out: New Clip over real scenes\n\n"As good as real": at most one metric out of band that the real part had in band. Per generator and "worse on" use that test.\n\n`
    + `| part | scenes | n | real part usable | any option usable | any option as good as real | per generator as good as real | options worse than real on |\n|---|---|---|---|---|---|---|---|\n${looLines.join('\n')}\n\n`
    + `## 6. Options and clicks, every request\n\n${expTable(exps, (e) => `${e.task} ${e.role}`)}\n`;
writeFileSync(dir + 'report.md', md);
writeFileSync(dir + 'result.json', JSON.stringify({ label, b: bRows.map((b) => ({ seed: b.seed, order: b.order, picks: b.picks, m: b.m, kept: b.kept })),
    depth: depth.map((c) => ({ seed: c.seed, role: c.role, rows: c.rows.map((x) => ({ depth: x.depth, m: x.m, identity: x.identity, preset: x.preset })) })),
    loo: loo.map((x) => ({ src: x.src, kind: x.kind, role: x.role, real: x.real, options: x.options })) }));
console.log(md);
