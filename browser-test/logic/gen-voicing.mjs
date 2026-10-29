/* browser-test/logic/gen-voicing.mjs — chord voicing and progression engine
 * (plans/2026-10-29-chord-voicing-engine.md): VOICING styles, the
 * whole-loop voicing search, MOTION, STRUM's performance modes and the
 * Markov progression walks with their chromatic colour.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';

const by = (id) => G.PRESETS.find((p) => p.id === id);
const turn = (ctx, p, knobs) => { const v = G.defaults(p, ctx); for (const [k, x] of Object.entries(knobs)) v[G.knobIndex(p, k)] = x; return G.regenerate(ctx, p, v) ?? []; };
const sig = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}.${n.gate}`).join(',');
/* Strikes of a chord part, with the chord planned under each. */
function strikes(ctx, p, ns) {
    const h = turn(ctx, p, {}).length && G.defaults(p, ctx)[G.knobIndex(p, 'HARMONY')];
    const at = new Map();
    for (const n of ns) { if (!at.has(n.tick)) at.set(n.tick, []); at.get(n.tick).push(n.pitch); }
    return [...at].map(([t, ps]) => ({ t, ps: ps.sort((a, b) => a - b), c: G.chordUnder(ctx, h, t) }));
}

export async function run() {
_log('\nTest: chord voicing and progression engine');

const C = (r, q) => G.chordOf(r, q);
const key = { tonic: 0, minor: false, score: 1 };
const style = (l) => G.STYLE_LABELS.indexOf(l);

/* Every style names its chord: the third (or a 7th chord's seventh) is in
 * every voicing, and only the rootless and quartal styles leave out the root. */
{
    const prog = [C(0, 'maj'), C(9, 'min'), C(5, 'maj'), C(7, '7'), C(11, 'dim'), C(2, 'm7')];
    const bad = [];
    G.STYLE_LABELS.forEach((l, s) => {
        const vs = G.voiceAll(prog, key, { style: s, anchor: 67, lo: 48, hi: 79, loop: true });
        vs.forEach((v, i) => { if (!v.length || !v.some((p) => p % 12 === prog[i].pcs[1])) bad.push(`${l}:${G.chordName(prog[i])}`); });
    });
    eq('every_voicing_style_holds_each_chords_third', bad.join(' '), '');
}

/* Drop 2 opens a close seventh chord past the octave; SHELL keeps the root
 * at the bottom; SPREAD spans more than an octave and a half. */
{
    const span = (v) => v[v.length - 1] - v[0];
    const [d2] = G.voiceAll([C(0, 'maj7')], key, { style: style('DROP 2'), anchor: 67, lo: 48, hi: 84 });
    ok('drop_2_spans_past_an_octave', d2.length === 4 && span(d2) > 12);
    const sh = G.voiceAll([C(0, 'maj'), C(7, 'maj')], key, { style: style('SHELL'), anchor: 67, lo: 48, hi: 84 });
    ok('shell_keeps_the_root_at_the_bottom', sh.every((v, i) => v.length === 3 && v[0] % 12 === [0, 7][i]));
    const [sp] = G.voiceAll([C(0, 'maj')], key, { style: style('SPREAD'), anchor: 72, lo: 48, hi: 90 });
    ok('spread_spans_over_an_octave_and_a_half', span(sp) > 18);
}

/* The search finds the smoothest path: C Am F G in triads moves fewer
 * semitones in all than re-stacking each chord in root position. */
{
    const prog = [C(0, 'maj'), C(9, 'min'), C(5, 'maj'), C(7, 'maj')];
    const vs = G.voiceAll(prog, key, { style: style('TRIAD'), anchor: 67, lo: 55, hi: 74, loop: true });
    const moved = vs.reduce((s, v, i) => s + G.movement(v, vs[(i + 1) % vs.length]), 0);
    ok('triads_voice_lead_round_the_loop_in_few_semitones', moved <= 12);
    const shares = (i) => prog[i].pcs.some((x) => prog[(i + 1) % prog.length].pcs.includes(x));
    ok('a_voicing_holds_a_common_tone_where_the_chords_share_one', vs.every((v, i) => !shares(i) || v.some((p) => vs[(i + 1) % vs.length].includes(p))));
}

/* The search is every candidate of every chord against every candidate of
 * the next, run on each knob turn on the device: a long loop in the widest
 * style must stay cheap (node is ~30x QuickJS; 25 ms here is a turn's budget). */
{
    const prog = Array.from({ length: 64 }, (_, i) => G.diatonic(key, [0, 5, 3, 4, 1, 6, 2][i % 7], i % 2 === 0));
    const t = performance.now();
    for (const m of G.MOTIONS) G.voiceAll(prog, key, { style: style('NEO SOUL'), anchor: 72, lo: 40, hi: 96, loop: true, motion: m, rung: 4 });
    ok('voicing_a_64_chord_loop_six_ways_is_cheap', (performance.now() - t) / G.MOTIONS.length < 25);
}

/* PARALLEL slides one shape; SMOOTH reshapes to move less. */
{
    const prog = [C(0, 'maj'), C(2, 'min'), C(4, 'min'), C(5, 'maj')];
    const member = (v, i) => prog[i].pcs.indexOf(v[0] % 12);
    const par = G.voiceAll(prog, key, { style: style('TRIAD'), anchor: 67, lo: 55, hi: 80, motion: 'PARALLEL' });
    ok('parallel_planes_one_inversion', new Set(par.map(member)).size === 1);
    const smooth = G.voiceAll(prog, key, { style: style('TRIAD'), anchor: 67, lo: 55, hi: 80 });
    ok('smooth_changes_inversion_to_move_less', new Set(smooth.map(member)).size > 1);
    const climb = G.voiceAll([...prog, ...prog], key, { style: style('TRIAD'), anchor: 64, lo: 50, hi: 74, motion: 'CLIMB' });
    ok('climb_ends_higher_than_it_starts', climb[7].at(-1) > climb[0].at(-1));
}

/* New Clip: every VOICING and MOTION position is a different take, and the
 * chord parts open on a chord tone in their bass. */
{
    const ctx = G.prepare(createInput(false, 'empty', 1));
    const chords = by('n-chords');
    const outs = G.STYLE_LABELS.map((_, s) => sig(turn(ctx, chords, { VOICING: s })));
    eq('voicing_every_click_is_a_new_take', new Set(outs).size, G.STYLE_LABELS.length);
    const pad = by('n-pad');
    const long = G.prepare(createInput(false, 'empty', 1, { len: 128 }));
    const motions = G.MOTIONS.map((_, m) => sig(turn(long, pad, { MOTION: m })));
    eq('motion_every_click_is_a_new_take', new Set(motions).size, G.MOTIONS.length);
    const lowBass = [];
    for (const l of ['TRIAD', 'OPEN', 'ADD9', 'SEVENTH', 'DROP 2', 'DROP 3', 'SPREAD']) {
        for (const s of strikes(ctx, chords, turn(ctx, chords, { VOICING: style(l) }))) {
            if (!s.c.pcs.slice(0, 3).includes(s.ps[0] % 12)) lowBass.push(`${l}@${s.t}`);
        }
    }
    eq('a_chord_part_has_a_chord_tone_in_its_bass', lowBass.slice(0, 4).join(' '), '');
}

/* STRUM: the first four positions are the old tick strums; HARP runs the
 * chord up an octave and ends with it; ROLL slows as it goes. */
{
    const ev = () => ({ tick: 0, voices: [60, 64, 67].map((pitch) => ({ pitch, dt: 0, gate: 96, vel: 90 })) });
    const r = G.rng(1);
    const e2 = ev(); G.strumEvent(e2, 2, 384, r);
    eq('strum_4_ticks_is_the_old_strum', e2.voices.map((v) => v.dt).join(), '0,4,8');
    const h = ev(); G.strumEvent(h, G.STRUMS.indexOf('HARP'), 384, r);
    ok('harp_adds_the_octave_above_within_half_the_chord', h.voices.length === 6 && h.voices.some((v) => v.pitch === 72)
        && Math.max(...h.voices.map((v) => v.dt)) < 192);
    const rl = ev(); G.strumEvent(rl, G.STRUMS.indexOf('ROLL'), 384, r);
    const d = rl.voices.map((v) => v.dt);
    ok('roll_slows_as_it_goes', d[2] - d[1] > d[1] - d[0]);
    const ctx = G.prepare(createInput(false, 'empty', 2));
    const pad = by('n-pad');
    const harp = turn(ctx, pad, { STRUM: G.STRUMS.indexOf('HARP') });
    const starts = [...new Set(turn(ctx, pad, {}).map((n) => n.tick))].sort((a, b) => a - b);
    const nextStart = (t) => starts.find((s) => s > t) ?? ctx.end;
    const owner = (t) => [...starts].reverse().find((s) => s <= t);
    ok('a_harp_never_rings_into_the_next_chord', harp.length > 0 && harp.every((n) => n.tick + n.gate <= nextStart(owner(n.tick)) + 1));
}

/* Walks: new loops per run, in the key, closing on themselves; colour plans
 * put a dominant seventh a fifth (or with TRITONE a semitone) above the chord
 * it leads to, at the end of HARMONY. */
{
    const walksOf = (n) => G.prepare(createInput(false, 'empty', n)).plans.filter((p) => p.label.startsWith('WALK ') && !p.ext);
    const a = walksOf(1);
    ok('a_new_scene_offers_three_walks', a.length === 3 && a.every((p) => !p.ext));
    eq('walks_are_seeded_by_the_run', a.map((p) => p.chords.map(G.chordName).join()).join('|'), walksOf(1).map((p) => p.chords.map(G.chordName).join()).join('|'));
    const runs = new Set([1, 2, 3, 4, 5, 6].map((n) => walksOf(n).map((p) => p.chords.map(G.chordName).join()).join('|')));
    ok('walks_differ_from_run_to_run', runs.size >= 4);
    const ctx = G.prepare(createInput(false, 'empty', 1));
    ok('walks_stay_in_the_key', a.every((p) => p.chords.every((c) => G.degreeOf(c, ctx.key) >= 0)));
    const plan = (l) => ctx.plans.find((p) => p.label === l);
    const leads = (p, by) => p.chords.some((c, i) => c && c.quality === '7'
        && (c.root - p.chords[(i + 1) % p.chords.length].root + 12) % 12 === by);
    ok('sec_dom_is_a_secondary_dominant', plan('SEC DOM')?.ext && leads(plan('SEC DOM'), 7));
    ok('tritone_slides_in_by_a_semitone', plan('TRITONE')?.ext && leads(plan('TRITONE'), 1));
}
}
