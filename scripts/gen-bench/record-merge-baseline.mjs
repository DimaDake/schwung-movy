/* Records the default takes of every generator a merge removes or changes
 * (plans/2026-11-02-generator-ux-implementation.md Task 1), BEFORE the
 * merges, so the no-loss test compares against the old sound and not the
 * new code. Run once: node scripts/gen-bench/record-merge-baseline.mjs */

import { writeFileSync } from 'node:fs';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureKeys, inputOf, REMOVED, SURVIVORS } from '../../browser-test/gen-merge-fixtures.mjs';

const out = {};
for (const id of [...REMOVED, ...SURVIVORS]) {
    const p = G.presetById(id);
    if (!p) throw new Error('no preset ' + id);
    out[id] = {};
    for (const key of fixtureKeys(p.task, p.drum)) {
        const ctx = G.prepare(inputOf(key));
        if (!G.serves(p, ctx)) continue;
        const notes = G.regenerate(ctx, p, G.defaults(p, ctx));
        if (notes) out[id][key] = notes.map((n) => [n.tick, n.pitch, n.gate, n.vel]);
    }
}
writeFileSync(new URL('../../browser-test/data/gen-merge-baseline.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(Object.entries(out).map(([id, f]) => `${id}:${Object.keys(f).length}`).join(' '));
