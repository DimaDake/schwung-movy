/* browser-test/logic/gen-follow.mjs — the generator follow-ups
 * (plans/2026-10-29-generator-follow-ups.md): BASS on the rhythm map, comps
 * that push into the next chord, Variation's chords voiced for the whole
 * part, DRUM MAP's groove × density, lines on guide tones.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput, fixtureInput } from '../gen-fixtures.mjs';

const by = (id) => G.PRESETS.find((p) => p.id === id);
const turn = (ctx, p, knobs) => { const v = G.defaults(p, ctx); for (const [k, x] of Object.entries(knobs)) v[G.knobIndex(p, k)] = x; return G.regenerate(ctx, p, v) ?? []; };
const sig = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}`).join(',');
const S = G.TPS;

export async function run() {
_log('\nTest: generator follow-ups');

/* #5: a strike just before a change, the change unstruck, plays the next chord. */
{
    const ctx = G.prepare(createInput(false, 'empty', 1, { len: 64 }));
    const h = G.runPlan(ctx);
    const at = (t) => G.chordName(G.chordUnder(ctx, h, t));
    ok('the_fixture_changes_chord_at_the_bar', at(14 * S) !== at(16 * S));
    eq('a_push_plays_the_next_chord', G.chordName(G.struck(ctx, h, [0, 14 * S, 20 * S])[1]), at(16 * S));
    eq('a_struck_change_is_not_pushed', G.chordName(G.struck(ctx, h, [0, 14 * S, 16 * S])[1]), at(14 * S));
    eq('a_strike_further_off_is_not_pushed', G.chordName(G.struck(ctx, h, [0, 10 * S, 20 * S])[1]), at(10 * S));
}

/* #2: BASS walks the rhythm map; a named figure keeps its parts. */
{
    const ctx = G.prepare(createInput(false, 'empty', 1));
    const p = by('n-bass');
    const m = G.patternMap(ctx, G.BASS_MAP);
    ok('bass_map_reaches_a_hundred_or_more', m.steps.length >= 90 && p.knobs[G.knobIndex(p, 'PATTERN')].steps(ctx) === m.steps.length);
    const full = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}.${n.gate}`).join(',');
    const outs = m.steps.map((_, v) => full(turn(ctx, p, { PATTERN: v, GATE: 10 })));
    eq('bass_every_click_is_a_new_take', new Set(outs).size, outs.length);
    const oct = m.steps.findIndex((s) => s.join() === '0,2,4,6,8,10,12,14' && m.flavour[m.steps.indexOf(s)] === 2);
    const ns = turn(ctx, p, { PATTERN: oct, NOTES: 0 }).filter((n) => n.tick < 16 * S).sort((a, b) => a.tick - b.tick);
    ok('bass_named_figure_keeps_its_octaves', oct >= 0 && ns.length === 8 && ns[1].pitch - ns[0].pitch === 12);
}

/* #3: Variation's chords, voiced for the whole part, follow the source's top line. */
{
    const ctx = G.prepare(fixtureInput('pad', { scene: 'free' }));
    const evs = G.toEvents(ctx.src);
    const out = G.realise(ctx, evs, { plan: ctx.plans[Math.min(1, ctx.plans.length - 1)], tension: 0.5, range: 1 });
    ok('realised_chords_keep_the_voice_count', out.every((e, i) => e.voices.length === evs[i].voices.length));
    const [lo, hi] = [ctx.lo - 15, ctx.hi + 15];
    ok('realised_chords_stay_in_register', out.every((e) => e.voices.every((v) => v.pitch >= lo && v.pitch <= hi)));
    const third = out.filter((e, i) => { const c = G.chordAt(ctx.plans[Math.min(1, ctx.plans.length - 1)].chords, e.tick, ctx.k); return c && e.voices.some((v) => v.pitch % 12 === c.pcs[1]); });
    ok('realised_chords_hold_their_thirds', third.length >= 0.9 * out.length);
    const comp = by('v-comp');
    ok('variation_comp_walks_the_map', comp.knobs[G.knobIndex(comp, 'PATTERN')].steps(ctx) >= 90);
}

/* #4, #10: DRUM MAP — a density click is one hit, GROOVE morphs gently. */
{
    const ctx = G.prepare(createInput(true, 'empty', 1, { len: 16 }));
    const p = by('n-drum-map');
    const count = (ns) => ns.length;
    const kicks = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => turn(ctx, p, { KICK: k, SNARE: 0, HATS: 0 }));
    ok('drum_map_each_kick_click_adds_one_hit', kicks.every((ns, k) => count(ns) === k));
    ok('drum_map_densities_nest', kicks.every((ns, k) => k === 0 || sig(kicks[k - 1]).split(',').every((x) => !x || sig(ns).includes(x.split('.')[0]))));
    const apart = (a, b) => a.filter((x) => !b.includes(x)).length;
    const K = [4, 2, 8];
    const moves = Array.from({ length: p.knobs[0].steps(ctx) - 1 }, (_, g) => [0, 1, 2].map((r) => apart(G.hitsAt(g, r, K[r]), G.hitsAt(g + 1, r, K[r]))));
    ok('drum_map_a_groove_click_moves_a_hit_a_voice_at_most', moves.every((m) => m.every((x) => x <= 1)));
    /* Neighbouring genres share most hits at one density: there a click
     * moves the velocities, which blend with the groove. */
    const loud = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}.${n.vel}`).join(',');
    const grooves = Array.from({ length: p.knobs[0].steps(ctx) }, (_, g) => loud(turn(ctx, p, { GROOVE: g, KICK: 4, SNARE: 2, HATS: 8, HUMAN: 0, DYN: 5 })));
    ok('drum_map_every_groove_click_is_heard', new Set(grooves).size >= 0.9 * grooves.length);
    eq('drum_map_four_floor_at_its_density', turn(ctx, p, { GROOVE: 0, KICK: 4, SNARE: 0, HATS: 0 }).map((n) => n.tick / S).sort((a, b) => a - b).join(), '0,4,8,12');
}

/* #6: lines land on guide tones where chords change and step into the next. */
{
    const ctx = G.prepare(createInput(false, 'empty', 2, { len: 64 }));
    const h = G.runPlan(ctx);
    const g = G.guideLine(ctx, h, 60, 84, 72);
    ok('guide_line_moves_by_small_steps', g.slice(1).every(([, p], i) => Math.abs(p - g[i][1]) <= 5));
    ok('guide_line_holds_guide_tones', g.every(([t, p]) => G.guidePcs(G.chordUnder(ctx, h, t), ctx).includes(p % 12)));
    /* A line on its guide tones starts a chord on its 3rd or 7th, never the
     * root, which the nearest chord tone often is (bench: a third of them). */
    for (const id of ['n-melody', 'n-counter']) {
        let firsts = 0, roots = 0;
        for (const seed of [0, 1, 2, 3]) {
            const ns = turn(ctx, by(id), { SEED: seed }).sort((a, b) => a.tick - b.tick);
            for (const [t, , ] of g) {
                const n = ns.find((x) => x.tick >= t && x.tick < t + 2 * S);
                if (!n || n.tick + 16 * S >= ctx.end) continue;
                firsts++;
                if (n.pitch % 12 === G.chordUnder(ctx, h, n.tick).root) roots++;
            }
        }
        ok(`${id}_starts_chords_off_the_root`, firsts >= 4 && roots <= 0.1 * firsts, `${roots}/${firsts}`);
    }
}
}
