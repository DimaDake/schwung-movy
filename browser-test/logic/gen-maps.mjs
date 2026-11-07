/* browser-test/logic/gen-maps.mjs — PATTERN and HARMONY as maps
 * (plans/2026-10-29-rhythm-harmony-maps.md): every position on the knob a
 * different comp or loop, a turn moving one onset or one chord, the named
 * figures and loops on it whole, the takes landing on them, in budget.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput, fixtureInput } from '../gen-fixtures.mjs';

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
        /* CHORDS holds its chords at 0, the map follows one up (§2.8). */
        const off = id === 'n-chords' ? 1 : 0;
        eq(`${name}_knob_spans_the_map`, p.knobs[k].steps(ctx), m.steps.length + off);
        const rollsIn = (c) => new Set(Array.from({ length: 60 }, (_, n) => G.rolled(p, c, n % 4, n)[k] - off));
        /* Alone in its scene a take strikes beat 1 (pattern-knob.ts unpulsed). */
        const rolls = rollsIn(ctx);
        ok(`${name}_takes_land_on_named_figures`, [...rolls].every((v) => m.takes.includes(v)) && rolls.size >= 3);
        ok(`${name}_takes_alone_strike_beat_1`, [...rolls].every((v) => m.steps[v].includes(0)));
        const band = G.prepare(createInput(false, 'locked', 1));
        const banded = rollsIn(band);
        ok(`${name}_takes_in_a_band_reach_off_the_beat`, banded.size >= 4 && [...banded].some((v) => !G.patternMap(band, spec).steps[v].includes(0)));
        /* Every position is heard: a different take each click. */
        const outs = Array.from({ length: m.steps.length + off }, (_, v) => { const w = G.defaults(p, ctx); w[k] = v; return sig(G.regenerate(ctx, p, w) ?? []); });
        /* HELD may equal the map's one-a-bar position where the chords change by the bar. */
        const mapOuts = outs.slice(off);
        ok(`${name}_every_click_is_a_new_take`, new Set(mapOuts).size === mapOuts.length && outs.every((o) => o.length));
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
        /* Half-bars a chord in each section (create/plans.ts); a turn across a section changes the rate, not a chord. */
        const n = ctx.plans[0].chords.length;
        const perOf = (p) => (p.count === 2 ? (n >= 8 ? 4 : 2) : p.count === 8 ? 1 : n >= 8 ? 2 : 1);
        const slot = (p) => p.chords.filter((_, i) => i % perOf(p) === 0).map(G.chordName);
        const ch = ctx.plans.slice(1).flatMap((p, i) => { const q = ctx.plans[i]; if (q.count !== p.count) return [];
            const a = slot(q), b = slot(p); return [b.filter((c, j) => c !== a[j % a.length]).length]; });
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

/* HARMONY in plain words and in reach (plans/2026-11-01-generator-ux-design.md §2.5, §2.6, §2.8). */
{
    const am = G.chordOf(9, 'min'), f = G.chordOf(5, 'maj'), c = G.chordOf(0, 'maj'), g = G.chordOf(7, 'maj');
    eq('harmony_label_is_the_chords', G.chordsLabel([am, am, f, c, g]), 'AM F C G');
    eq('harmony_label_rest', G.chordsLabel([am, null, f, null]), 'AM - F -');
    const long = [G.chordOf(6, 'm7b5'), G.chordOf(11, '7'), G.chordOf(4, 'm7'), G.chordOf(9, '7'), G.chordOf(2, 'maj7'), G.chordOf(7, '7')];
    const L = G.chordsLabel(long);
    ok('harmony_label_fits_the_strip', L.length <= G.HARMONY_LABEL_MAX && L.endsWith('...'));
    const fr = G.prepare(createInput(false, 'free', 1));
    const hk = (p) => p.knobs[G.knobIndex(p, 'HARMONY')];
    eq('create_harmony_shows_chords', hk(G.presetById('n-chords')).label(1, fr), G.chordsLabel(fr.plans[1].chords));
    eq('create_harmony_zero_is_the_tonic', new Set(fr.plans[0].chords.map((x) => G.chordName(x))).size, 1);
    ok('tonic_is_never_a_takes_opening', G.runPlan(fr) !== 0);
    const vfree = G.prepare(fixtureInput('lead', { scene: 'free' }));
    ok('bold_moves_last_and_never_default', vfree.plans.findIndex((p) => p.ext) === -1
        || (vfree.plans.slice(vfree.plans.findIndex((p) => p.ext)).every((p) => p.ext) && !vfree.plans[G.defaultHarmony(vfree)].ext));
    ok('no_level_in_harmony', vfree.plans.length === G.prepare({ ...fixtureInput('lead', { scene: 'free' }), level: 'WILD' }).plans.length);
    const locked = G.prepare(fixtureInput('lead', { scene: 'locked' }));
    const next = G.presetById('v-next');
    eq('harmony_hidden_on_a_locked_follower', hk(next).steps(locked), 1);
    ok('harmony_kept_on_a_locked_bass', hk(next).steps(G.prepare(fixtureInput('bass', { scene: 'locked' }))) > 1);
    eq('locked_sits_keep_their_words', hk(next).label(0, G.prepare(fixtureInput('bass', { scene: 'locked' }))), 'AS PLAYED');
    const cp = G.presetById('n-chords');
    const pk = G.knobIndex(cp, 'PATTERN');
    eq('chords_pattern_zero_is_held', cp.knobs[pk].label(0, fr), 'HELD');
    const w = G.defaults(cp, fr); w[pk] = 0;
    const heldNotes = G.regenerate(fr, cp, w);
    const onsets = [...new Set(heldNotes.map((n) => n.tick))];
    ok('chords_held_strikes_once_per_change', onsets.length <= fr.plans[w[G.knobIndex(cp, 'HARMONY')]].chords.length && onsets.length >= 1);
}
}
