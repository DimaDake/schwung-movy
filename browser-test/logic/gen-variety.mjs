/* browser-test/logic/gen-variety.mjs — every press a new part, every SEED
 * turn a new take (plans/2026-11-07-generation-paths-bench.md, round 5,
 * scripts/gen-bench/quality/variety-run.mjs).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput, fixtureInput, messy, PARTS } from '../gen-fixtures.mjs';
import * as AI from '../../dist/esm/ai/index.js';
import { emptySet } from '../../scripts/gen-bench/quality/paths.mjs';
import { optionVariety, presses, takeVariety } from '../../scripts/gen-bench/quality/variety.mjs';
import { sceneA } from '../../scripts/gen-bench/quality/chains.mjs';

const sig = (ns) => ns.map((n) => `${n.tick}.${n.pitch}`).sort().join();
const beat = (ns) => [...new Set(ns.map((n) => Math.round(n.tick / G.TPS)))].sort((a, b) => a - b).join();
const pickOf = (r, id) => r.picks.find((p) => p.preset.id === id);
const seedTurns = (ctx, p, knobs) => {
    const k = G.knobIndex(p, 'SEED');
    return new Set(Array.from({ length: 6 }, (_, s) => { const v = [...knobs]; v[k] = s; return sig(G.regenerate(ctx, p, v) ?? []); })).size;
};

export async function run() {
_log('\nTest: generator variety');

/* A second press of Variation or Smart Double is a new run (its own nonce,
 * ai/job-algo.ts); without one it stays a function of the Set (the benches). */
{
    const input = fixtureInput('lead');
    const a = G.generateAll({ ...input, nonce: 1 }, 6), b = G.generateAll({ ...input, nonce: 2 }, 6);
    ok('variation_a_second_press_is_new', a.picks.filter((p, i) => b.picks[i] && sig(p.notes) !== sig(b.picks[i].notes)).length >= 3);
    eq('variation_without_a_nonce_is_the_sets', sig(G.generateAll(input, 6).picks[0].notes), sig(G.generateAll(input, 6).picks[0].notes));
}

/* ...and the device's job gives each press its nonce, but a quantize's. */
{
    const input = fixtureInput('lead');
    const seedOf = (task, nonce) => AI.startAlgo({ task, tracks: input.tracks, track: 0, slot: 1, nonce,
        ctx: { len: input.len, scale: [1, 1], drum: false, kit: [] } }, 0).ctx.seed;
    ok('a_variation_job_seeds_each_press', seedOf('variation', 1) !== seedOf('variation', 2));
    eq('a_quantize_job_does_not', seedOf('quantize', 1), seedOf('quantize', 2));
}

/* New Clip's adopted generators draw their own knobs: a second line is not
 * the same line every press. */
{
    const lines = new Set(), loops = new Set();
    G.forgetOptions();
    for (let k = 0; k < 6; k++) {
        const r = G.generateAll(createInput(false, 'locked', 900 + k, { melody: true }));
        const h = pickOf(r, 'n-harmonize');
        if (h) lines.add(sig(h.notes));
        const l = pickOf(r, 'n-looper');
        if (l) loops.add(beat(l.notes));
    }
    ok('harmonize_differs_press_to_press', lines.size >= 3, `${lines.size} of 6`);
    ok('looper_rhythm_differs_press_to_press', loops.size >= 2, `${loops.size} of 6`);
}

/* A bass alone comes back on new rhythms, not one figure most presses
 * (ten presses with the history on, as on the device). */
{
    const tops = [1, 2, 3].map((k) => takeVariety(G, presses(G, emptySet(k), 1, [64, 128][k % 2], 10, k).get('n-bass')).top);
    ok('bass_alone_varies_its_rhythm', tops.every((t) => t <= 0.5), tops.join(' '));
}

/* SEED turns: every position another take, on MELODY and Smart Quantize's DECORATE. */
{
    const mel = G.generateAll(createInput(false, 'free', 7, { len: 64 }));
    const m = pickOf(mel, 'n-melody');
    /* Phrased (SPACE past FULL), where SEED had little to move. */
    const phrased = [...m.knobs];
    phrased[G.knobIndex(m.preset, 'SPACE')] = 2;
    ok('melody_seed_turns_are_new_takes', seedTurns(mel.ctx, m.preset, phrased) >= 5);
    const input = fixtureInput('lead', { task: 'quantize' });
    input.tracks[0].clips[0].notes = messy(PARTS.lead);
    const ctx = G.prepare(input);
    const p = G.PRESETS.find((x) => x.id === 'q-embellish');
    ok('decorate_seed_turns_are_new_takes', seedTurns(ctx, p, G.defaults(p, ctx)) >= 4);
    /* WALK as a Variation's own New Clip option on a bass track: its walks
     * were all the SEED could move, and they went where the line was. */
    const walk = optionVariety(G, sceneA(G, 3), 1, 'variation', null).seeds.find((x) => x.id === 'n-walk');
    ok('walk_seed_turns_are_new_takes', walk && walk.distinct >= 4, JSON.stringify(walk));
}
}
