/* Audition exporter (plans/2026-11-07-gen-audition-plan.md, Task 3): every
 * case the benches can build, in listening order, as the phone page's files.
 *
 *   node scripts/gen-bench/quality/refs.mjs        # once: .gen-data/refs.json
 *   npm run build:browser && node scripts/gen-bench/audition/export.mjs [--seeds 6] [--limit N] [--first first.json]
 *
 * Writes .gen-data/audition/<build>/: manifest.json and cases-NNN.json.
 * `--first` (report.mjs writes it) puts the rebuild of every case answered
 * None or Neither at the head of the queue, marked "After fix", so a fix is
 * checked by ear first. */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadBands } from '../quality/paths-score.mjs';
import { chunks, packCase, prioritise } from './queue.mjs';
import { abRecipes, current, rebuild, setRecipes } from './sources.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const build = arg('label', execSync('git rev-parse --short HEAD').toString().trim());
const seeds = Number(arg('seeds', 6)), limit = Number(arg('limit', Infinity));

const { raw, bands } = loadBands(DATA);
const G = await import('../../../dist/esm/gen/index.js');
const t0 = Date.now();
const built = (rs) => rs.map((r) => rebuild(G, r, bands, raw, build)).filter(Boolean);
const pools = { set: built(setRecipes(seeds)), ab: built(abRecipes(raw)) };
const head = arg('first') ? JSON.parse(readFileSync(arg('first'), 'utf8')).flatMap(({ recipe }) => {
    const after = rebuild(G, current(recipe), bands, raw, build);
    return after ? [{ ...packCase(after), pair: 'after' }] : [];
}) : [];
const queue = [...head, ...prioritise([...pools.set, ...pools.ab]).map(packCase)].slice(0, limit);

const dir = DATA + `audition/${build}/`;
mkdirSync(dir, { recursive: true });
const files = chunks(queue).map((cs, k) => {
    const name = `cases-${String(k).padStart(3, '0')}.json`;
    writeFileSync(dir + name, JSON.stringify(cs));
    return name;
});
const counts = Object.fromEntries(Object.entries(pools).map(([k, v]) => [k, v.length]));
writeFileSync(dir + 'manifest.json', JSON.stringify({ build, files, counts: { ...counts, fixes: head.length, queued: queue.length } }));
console.log(`audition ${build}: ${queue.length} cases in ${files.length} files (${JSON.stringify(counts)}), ${Date.now() - t0} ms -> ${dir}`);
