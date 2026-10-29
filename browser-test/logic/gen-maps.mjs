/* browser-test/logic/gen-maps.mjs — PATTERN and HARMONY as maps
 * (plans/2026-10-29-rhythm-harmony-maps.md): every position on the knob a
 * different comp or loop, a turn moving one onset or one chord, the named
 * figures and loops on it whole, the takes landing on them, in budget.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';

const N = (step, pitch, len, vel) => ({ tick: step * G.TPS, gate: len * G.TPS, pitch, vel });
const by = (id) => G.PRESETS.find((p) => p.id === id);
const sig = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}`).join(',');
const apart = (a, b) => a.filter((x) => !b.includes(x)).length + b.filter((x) => !a.includes(x)).length;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (f, n = 30) => median(Array.from({ length: n }, () => { const t = performance.now(); f(); return performance.now() - t; }));

export async function run() {
_log('\nTest: rhythm and harmony maps');

/* The rhythm map: Barlow's ranking, nested densities, a serpentine. */
{
    const r = G.ranking([2, 6, 10, 14]);
    eq('a_flavour_ranks_its_own_steps_first', r.slice(0, 4).sort((a, b) => a - b).join(), '2,6,10,14');
    eq('the_rest_follow_the_metre', r.slice(4, 8).join(), '0,8,12,4');
    const ctx = G.prepare(createInput(false, 'empty', 1));
    for (const [name, spec, id] of [['comp', G.COMP_MAP, 'n-chords'], ['stab', G.STAB_MAP, 'n-stabs']]) {
        const m = G.patternMap(ctx, spec);
        const steps = m.steps.map((s) => s.join());
        ok(`${name}_map_reaches_a_hundred_or_more`, m.steps.length >= 90 && m.steps.length <= 128);
        eq(`${name}_map_never_repeats_a_pattern`, new Set(steps).size, steps.length);
        const d = m.steps.slice(1).map((s, i) => apart(m.steps[i], s));
        ok(`${name}_most_turns_move_one_onset`, d.filter((x) => x === 1).length >= 0.85 * d.length);
        /* The serpentine: flavours meet where they share most (1.75 laid end to end). */
        ok(`${name}_turns_average_under_one_and_a_half_onsets`, d.reduce((a, b) => a + b, 0) / d.length < 1.5);
        ok(`${name}_covers_sparse_to_dense`, Math.min(...m.steps.map((s) => s.length)) === spec.lo && Math.max(...m.steps.map((s) => s.length)) === spec.hi);
        ok(`${name}_every_named_figure_is_on_the_map`, spec.figs.every((f) => steps.includes([...f].sort((a, b) => a - b).join())));
        const p = by(id);
        const k = G.knobIndex(p, 'PATTERN');
        eq(`${name}_knob_spans_the_map`, p.knobs[k].steps(ctx), m.steps.length);
        const rolls = new Set(Array.from({ length: 60 }, (_, n) => G.rolled(p, ctx, n % 4, n)[k]));
        ok(`${name}_takes_land_on_named_figures`, [...rolls].every((v) => m.takes.includes(v)) && rolls.size >= 4);
        /* Every position is heard: a different take each click. */
        const outs = m.steps.map((_, v) => { const w = G.defaults(p, ctx); w[k] = v; return sig(G.regenerate(ctx, p, w) ?? []); });
        ok(`${name}_every_click_is_a_new_take`, new Set(outs).size === outs.length && outs.every((o) => o.length));
    }
    const figs = [...G.COMP_MAP.figs, ...G.euclids([[3, 0], [5, 0], [7, 0]])];
    ok('rhythm_map_builds_in_budget', time(() => G.rhythmMap(figs, 8, 1, 10)) < 1);
    /* The band's accents are a figure of their own. */
    const band = createInput(false, 'empty', 1);
    band.tracks.push({ index: 1, name: 'Track 2', module: 'obxd', drum: false, padNames: null,
        clips: [{ track: 1, slot: 1, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0,
            notes: [0, 16].flatMap((b) => [3, 7, 10, 14].map((s) => N(b + s, 48, 1, 120))) }] });
    const bc = G.prepare(band);
    const acc = G.bandSteps(bc).slice(0, 5).sort((a, b) => a - b).join();
    ok('band_accents_are_on_the_map', acc.split(',').length >= 2 && G.patternMap(bc, G.COMP_MAP).steps.some((s) => s.join() === acc));
}

/* The grammar: one chord a rule, plausible loops ranked first. */
{
    const ctx = G.prepare(createInput(false, 'empty', 1));
    const k = ctx.key;
    const pop = [0, 4, 5, 3].map((d) => G.diatonic(k, d));
    const ds = G.derive(pop, k);
    ok('a_rule_changes_one_chord', ds.length > 10 && ds.every(([p]) => p.length === 4 && p.filter((c, i) => G.chordName(c) !== G.chordName(pop[i])).length === 1));
    ok('diatonic_rules_stay_in_the_key', ds.filter(([, x]) => !x).every(([p]) => p.every((c) => c.pcs.every((x) => G.inKey(x, k)))));
    ok('the_home_chord_is_only_substituted', ds.filter(([p]) => G.chordName(p[0]) !== G.chordName(pop[0])).every(([p]) => G.degreeOf(p[0], k) >= 0));
    const odd = [0, 2, 6, 1].map((d) => G.diatonic(k, d));
    ok('the_corpus_prefers_pop_to_an_odd_loop', G.plausible(pop, k) > G.plausible(odd, k));
    const C = G.diatonic(k, 0), Am = G.diatonic(k, 5), F = G.diatonic(k, 3);
    ok('lerdahl_relative_is_closer_than_far', G.chordDistance(C, Am, k) < G.chordDistance(C, G.chordOf(k.tonic + 6, 'maj'), k)
        && G.chordDistance(C, F, k) < G.chordDistance(C, G.chordOf(k.tonic + 6, 'maj'), k) && G.chordDistance(C, C, k) === 0);
}

/* The harmony map: most turns change one chord; built in budget. */
{
    for (const len of [32, 128]) {
        const ctx = G.prepare(createInput(false, 'empty', 1, { len }));
        const per = ctx.plans[0].chords.length >= 8 ? 2 : 1;
        const slot = (p) => p.chords.filter((_, i) => i % per === 0).map(G.chordName);
        const ch = ctx.plans.slice(1).map((p, i) => { const a = slot(ctx.plans[i]), b = slot(p); return b.filter((c, j) => c !== a[j % a.length]).length; });
        ok(`harmony_${len}_a_turn_changes_a_chord_or_two`, ch.filter((x) => x <= 2).length >= (len > 64 ? 0.45 : 0.75) * ch.length && ch.every((x) => x > 0));
        eq(`harmony_${len}_every_position_is_a_new_loop`, new Set(ctx.plans.map((p) => p.chords.map(G.chordName).join())).size, ctx.plans.length);
    }
    ok('harmony_map_builds_in_budget', time(() => G.prepare(createInput(false, 'empty', 7)), 20) < 6);
    /* A request builds the map a stage a tick before its first take, and
     * ends with the map prepare() builds at once. */
    const req = G.startRequest(createInput(false, 'empty', 5));
    let stages = 0;
    while (req.plans) { G.stepRequest(req); stages++; }
    const once = G.prepare(createInput(false, 'empty', 5));
    ok('a_request_stages_its_harmony', stages >= 4 && req.todo.length > 0 && req.done.length === 0);
    eq('a_staged_map_is_the_prepared_one', req.ctx.plans.map((p) => p.label).join(), once.plans.map((p) => p.label).join());
}
}
