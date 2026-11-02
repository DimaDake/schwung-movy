/* browser-test/logic/gen-merges.mjs — the merges' no-loss rule
 * (plans/2026-11-01-generator-ux-design.md §2.7): a removed generator's
 * default take, recorded before the merge (data/gen-merge-baseline.json), is
 * what the merged generator plays at the mapped knobs, within the bench's
 * MIN_PAIR. A merge that cannot pass is reported, not forced.
 *
 * Run by browser-test/logic.mjs.
 */

import { readFileSync } from 'node:fs';
import { _log, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { inputOf, REMOVED, SURVIVORS } from '../gen-merge-fixtures.mjs';

const B = JSON.parse(readFileSync(new URL('../data/gen-merge-baseline.json', import.meta.url), 'utf8'));
const notesOf = (rows) => rows.map(([tick, pitch, gate, vel]) => ({ tick, pitch, gate, vel }));

/** True when `notes` sounds like the recorded default of `id` on `key`. */
export function noLoss(id, key, notes) {
    const want = B[id]?.[key];
    return !!want && !!notes && G.difference(notesOf(want), notes) < G.MIN_PAIR;
}

/** Every fixture key the baseline holds for `id`. */
export const keysOf = (id) => Object.keys(B[id] ?? {});

export async function run() {
_log('\nTest: generator merges lose nothing');

ok('merge_baseline_complete', [...REMOVED, ...SURVIVORS].every((id) => keysOf(id).length > 0));
ok('merge_baseline_reads_back', keysOf('q-tight').every((k) => {
    const ctx = G.prepare(inputOf(k));
    const p = G.presetById('q-tight');
    return noLoss('q-tight', k, G.regenerate(ctx, p, G.defaults(p, ctx)));
}));
}
