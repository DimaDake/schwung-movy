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

/* A preset's take with the named knobs turned: a number is a position, a
 * string picks the position whose label it is. */
export function turnAll(ctx, p, byName) {
    const v = G.defaults(p, ctx);
    for (const [name, want] of Object.entries(byName)) {
        const i = G.knobIndex(p, name);
        if (i < 0) return null;
        const k = p.knobs[i];
        v[i] = typeof want === 'number' ? want : Array.from({ length: k.steps(ctx) }, (_, j) => k.label(j, ctx)).indexOf(want);
        if (v[i] < 0) return null;
    }
    return G.regenerate(ctx, p, v);
}

/** Every baseline fixture of `removed` passes at `into`'s mapped knobs; the
 *  keys that fail, for the report. */
export function misses(removed, into, byName, except = []) {
    const p = G.presetById(into);
    if (!p) return ['no ' + into];
    return keysOf(removed).filter((k) => !except.includes(k)).filter((k) => {
        const ctx = G.prepare(inputOf(k));
        return !G.serves(p, ctx) || !noLoss(removed, k, turnAll(ctx, p, byName));
    });
}

const gone = (id) => !G.presetById(id);

export async function run() {
_log('\nTest: generator merges lose nothing');

ok('merge_baseline_complete', [...REMOVED, ...SURVIVORS].every((id) => keysOf(id).length > 0));
ok('merge_baseline_reads_back', keysOf('q-tight').every((k) => {
    const ctx = G.prepare(inputOf(k));
    const p = G.presetById('q-tight');
    return noLoss('q-tight', k, G.regenerate(ctx, p, G.defaults(p, ctx)));
}));

/* Quantize (Task 2): TIDY and GROOVE are TIGHT at their knobs, INVERT is
 * MODE at MIRROR, FULL is gone (TIGHT + DECORATE cover it). */
const report = (name, m) => ok(name, m.length === 0, m.join(' '));
report('merge_q_tidy_into_tight', misses('q-tidy', 'q-tight', { CLEAN: 5, VELOCITY: 2, LENGTH: 6 }));
report('merge_q_groove_into_tight', misses('q-groove', 'q-tight', { TIMING: 9, VELOCITY: 8 }));
report('merge_qd_tidy_into_tight', misses('qd-tidy', 'qd-tight', { CLEAN: 8, VELOCITY: 3 }));
report('merge_qd_groove_into_tight', misses('qd-groove', 'qd-tight', { TIMING: 9, VELOCITY: 8, FEEL: 'STRAIGHT' }));
report('merge_q_invert_into_mode', misses('q-invert', 'q-mode', { MODE: 'MIRROR', WHERE: '2ND HALF', PIVOT: 'MID' }));
report('q_tight_default_kept', misses('q-tight', 'q-tight', {}));
report('qd_tight_default_kept', misses('qd-tight', 'qd-tight', {}));
/* A drone is no longer offered MODE: its one pitch had no mode to move to. */
report('q_mode_default_kept', misses('q-mode', 'q-mode', {}, ['messy:drone/free/quantize']));
ok('quantize_merged_away', ['q-tidy', 'q-groove', 'q-full', 'q-invert', 'qd-tidy', 'qd-groove', 'qd-full'].every(gone));
}
