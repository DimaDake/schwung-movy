/* The paths bench (plans/2026-11-07-generation-paths-bench.md): every order of
 * New Clip over drums, bass, chords and lead, measured against real scenes.
 *
 *   node scripts/gen-bench/quality/refs.mjs        # once: .gen-data/refs.json
 *   npm run build:browser && node scripts/gen-bench/quality/paths-run.mjs --label base [--compare other] [--seeds 6]
 *
 * Writes .gen-data/paths/<label>/: report.md, result.json, and for the scenes
 * worth reading (out of band on a gapped metric, plus a few at random) a text
 * roll and a MIDI file each. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeMidi } from './midi-write.mjs';
import { runPaths } from './paths.mjs';
import { firstStep, groupOf, keyTable, inBand, refBands, score, table } from './paths-score.mjs';
import { relations } from './relations.mjs';
import { roll } from './roll.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', 'paths');
const PER_METRIC = 2, RANDOM = 4, GAP = 0.15;

if (!existsSync(DATA + 'refs.json')) { console.error('no refs: run scripts/gen-bench/quality/refs.mjs'); process.exit(1); }
const refs = JSON.parse(readFileSync(DATA + 'refs.json', 'utf8')).map((r) => ({ kind: r.kind, m: relations(r) }));
const bands = refBands(refs);
const G = await import('../../../dist/esm/gen/index.js');
const t0 = Date.now();
const paths = runPaths(G, Number(arg('seeds', 6)));
const rows = paths.map((p) => ({ ...p, m: relations(p.scene) }));
const sc = score(rows, bands);
const dir = DATA + `paths/${label}/`;
mkdirSync(dir + 'rolls', { recursive: true });

/* Scenes to read: out of band on each metric with an order gap, from the
 * worse group; then a few at random (seeded, so a re-run reads the same). */
const pick = new Map();
for (const r of sc.filter((x) => x.gap !== null && Math.abs(x.gap) >= GAP)) {
    const worse = r.gap < 0 ? 'after' : 'before';
    const bad = rows.filter((p) => p.m[r.metric] !== undefined && !inBand(r.band, p.m[r.metric]) && groupOf(r.metric, p.order) === worse);
    for (const p of bad.slice(0, PER_METRIC)) pick.set(p, [...(pick.get(p) ?? []), r.metric]);
}
for (let k = 0; k < RANDOM; k++) { const p = rows[(k * 37 + 11) % rows.length]; pick.set(p, [...(pick.get(p) ?? []), 'random']); }
const tick = (ns) => ns.map((n) => ({ ...n }));
for (const [p, why] of pick) {
    const id = `s${p.seed}-${p.order.map((r) => r[0]).join('')}`;
    const head = `${id}  ${p.key}  order ${p.order.join(' > ')}  takes ${Object.entries(p.picks).map(([r, x]) => `${r}=${x}`).join(' ')}\n`
        + `why: ${why.join(', ')}\n` + Object.entries(p.m).map(([k, v]) => `${k}=${Number.isInteger(v) ? v : v.toFixed(2)}`).join(' ');
    writeFileSync(dir + `rolls/${id}.txt`, roll(p.scene, head) + '\n');
    writeFileSync(dir + `rolls/${id}.mid`, writeMidi(p.set.tracks.map((t, i) => ({ name: t.name, channel: t.drum ? 9 : i, notes: tick(t.clips[0]?.notes ?? []) })), p.bpm));
}

const prevFile = DATA + `paths/${arg('compare', '')}/result.json`;
const prev = arg('compare') && existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')).score : null;
const md = `# Paths bench: ${label}\n\n${rows.length} scenes (${paths.length / 24} seeds × 24 orders), ${Date.now() - t0} ms; `
    + `refs ${refs.filter((r) => r.kind === 'public').length} public + ${refs.filter((r) => r.kind === 'user').length} user scenes.\n`
    + `"before"/"after": the metric's first role generated before/after its second (one role: first / not first). ⚠ = gap ≥ ${GAP * 100} points.\n\n`
    + table(sc, prev) + `\n\n## In the Set's key\n\n` + keyTable(rows) + `\n\n## After the first step\n\n` + firstStep(rows, bands) + `\n\nRolls: ${pick.size} scenes in .gen-data/paths/${label}/rolls/\n`;
writeFileSync(dir + 'report.md', md);
writeFileSync(dir + 'result.json', JSON.stringify({ label, score: sc, rows: rows.map((r) => ({ seed: r.seed, order: r.order, picks: r.picks, m: r.m })) }));
console.log(md);
