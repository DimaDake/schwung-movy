/* browser-test/logic/gen-drift.mjs — DRIFT (src/gen/drift.ts): a knob that
 * walks a take away from itself one small move per click, and back again;
 * on every Variation and Smart Double generator with a knob to spare.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureInput } from '../gen-fixtures.mjs';

const sig = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}.${n.vel}`).join(',');
const cellSet = (ns) => new Set(ns.map((n) => `${n.tick}:${n.pitch}`));
const moved = (a, b) => { const A = cellSet(a), B = cellSet(b); let d = 0; for (const x of A) if (!B.has(x)) d++; return d; };
const by = (id) => G.PRESETS.find((p) => p.id === id);
function walkOf(ctx, p) {
    const i = G.knobIndex(p, 'DRIFT');
    const v = G.defaults(p, ctx);
    return Array.from({ length: 21 }, (_, d) => { const w = [...v]; w[i] = d; return G.regenerate(ctx, p, w); });
}

export async function run() {
_log('\nTest: generator drift');

const withDrift = G.PRESETS.filter((p) => p.knobs.some((k) => k.name === 'DRIFT'));
ok('drift_on_variation_double_and_new_clip', withDrift.length >= 40
    && withDrift.every((p) => p.task !== 'quantize'));
ok('drift_never_on_smart_quantize', !G.PRESETS.some((p) => p.task === 'quantize' && p.knobs.some((k) => k.name === 'DRIFT')));
ok('drift_opens_off', withDrift.every((p) => G.defaults(p, G.prepare(fixtureInput(p.drum ? 'drums' : 'lead', { task: p.task, scene: 'free' })))[G.knobIndex(p, 'DRIFT')] === 0));

/* A line walks: each click a note or two, further and further away. */
const lead = G.prepare(fixtureInput('lead', { scene: 'free' }));
const w = walkOf(lead, by('v-walk'));
const steps = w.slice(1).map((x, d) => moved(w[d], x));
ok('drift_moves_a_little_each_click', steps.every((n) => n <= 3) && steps.filter((n) => n > 0).length >= 15);
const away = w.map((x) => moved(w[0], x));
ok('drift_gets_further_away', away[20] > away[5] && away[5] > 0);

/* A chord part: voices move to other chord tones, the chord keeps its size. */
const pad = G.prepare(fixtureInput('pad', { scene: 'free' }));
const padP = G.PRESETS.find((p) => p.task === 'variation' && !p.drum && G.serves(p, pad) && G.knobIndex(p, 'DRIFT') >= 0 && G.generateOption(pad, p, G.defaults(p, pad)).notes);
const pw = walkOf(pad, padP);
const sizes = (ns) => G.toEvents(ns).map((e) => e.voices.length).join();
eq('drift_keeps_chord_sizes', sizes(pw[12]), sizes(pw[0]));
ok('drift_revoices_chords', moved(pw[0], pw[12]) > 0);

/* Smart Double: only the answer drifts; the first half stays as played. */
const dbl = G.prepare(fixtureInput('lead', { task: 'double', scene: 'free' }));
const dw = walkOf(dbl, by('x-turnaround'));
const firstHalf = (ns) => sig(ns.filter((n) => n.tick < dbl.end / 2));
eq('drift_leaves_a_doubles_first_half', firstHalf(dw[20]), firstHalf(dw[0]));
ok('drift_moves_a_doubles_second_half', moved(dw[0], dw[20]) > 0);

/* Drums: hits slide or ghost; the downbeat stays. */
const dr = G.prepare(fixtureInput('drums', { scene: 'free' }));
const kw = walkOf(dr, by('d-kick'));
const ones = (ns) => ns.filter((n) => n.tick % G.BAR === 0).map((n) => `${n.tick}.${n.pitch}`).join();
eq('drift_keeps_the_downbeat', ones(kw[20]), ones(kw[0]));
ok('drift_moves_drum_hits', sig(kw[20]) !== sig(kw[0]));

/* SEED, ordered close to far (plans/2026-11-01-generator-ux-design.md §2.8):
 * position 0 is the take as it was, each next one further from it. */
{
    const sc = G.prepare(fixtureInput('lead', { scene: 'free' }));
    const p = by('v-connect');
    const v = G.defaults(p, sc);
    const si = G.knobIndex(p, 'SEED');
    eq('seed_has_sixteen_takes', p.knobs[si].steps(sc), G.SEED_TAKES);
    ok('seed_knob_is_flagged', p.knobs[si].seed === true);
    const order = G.drain(G.seedOrder(sc, p, v, si));
    eq('seed_zero_is_default_take', order[0], 0);
    eq('seed_order_holds_every_take_once', [...order].sort((a, b) => a - b).join(), Array.from({ length: G.SEED_TAKES }, (_, i) => i).join());
    const take = (raw) => { const w = [...v]; w[si] = raw; return G.regenerate(sc, p, w) ?? []; };
    const base = take(0);
    const dists = order.map((raw) => G.spread(base, take(raw)));
    ok('seed_order_runs_close_to_far', dists.every((d, i) => i === 0 || d >= dists[i - 1] - 1e-9));
    let n = 0;
    const g = G.seedOrder(sc, p, v, si);
    while (!g.next().done) n++;
    ok('seed_order_is_staged', n >= G.SEED_TAKES - 1);
}
}
