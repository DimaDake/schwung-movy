/* The user's ear as a gate (plans/2026-11-07-gen-audition-design.md, step 4):
 * every generated case the user rated, rebuilt at the current generators.
 * A Bad that changed is a fix to listen to; a Keep that changed is listed for
 * re-listening, not failed, since a different take can be good too.
 *
 *   npm run build:browser && node scripts/gen-bench/audition/regress.mjs
 * (after report.mjs's step 1 has written .gen-data/audition/ratings.json) */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadBands } from '../quality/paths-score.mjs';
import { allCases } from './report.mjs';
import { packCase } from './queue.mjs';
import { rebuild } from './sources.mjs';
import { regression } from './summary.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const { raw, bands } = loadBands(DATA);
const G = await import('../../../dist/esm/gen/index.js');
const ratings = JSON.parse(readFileSync(DATA + 'audition/ratings.json', 'utf8'));
const r = regression(G, ratings, allCases(), (recipe) => { const c = rebuild(G, recipe, bands, raw, 'now'); return c && packCase(c); });
const lines = ['# Audition regression', '',
    `Your Bads: changed ${r.bads.changed} / still the same ${r.bads.same}.`,
    `Your Keeps: still the same ${r.keeps.same}, changed ${r.keeps.changed.length} (listen again):`, '',
    ...r.keeps.changed.map((k) => `- ${k.preset}: case ${k.caseId}${k.option !== null && k.option !== undefined ? ` option ${k.option + 1}` : ''}`),
    '', `Skipped (real parts, Meh, cases not on disk): ${r.skipped}.`];
writeFileSync(DATA + 'audition/regress.md', lines.join('\n') + '\n');
console.log(lines.slice(2, 4).join('\n'));
