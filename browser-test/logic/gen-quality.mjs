/* browser-test/logic/gen-quality.mjs — what the generator quality bench
 * found and fixed (plans/2026-10-29-generator-quality-metrics.md): parts that
 * rub against the band or sit on the bass, a chord part that sank, and knobs
 * whose clicks did nothing (TENSION, VARY, PITCH FIX), and a Smart Double that
 * broke its part's role.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput, fixtureInput, messy, PARTS } from '../gen-fixtures.mjs';
import { rubs, verdict } from '../../scripts/gen-bench/quality/musical.mjs';
import { positions, spearman } from '../../scripts/gen-bench/quality/sweep.mjs';
import { writeMidi } from '../../scripts/gen-bench/quality/midi-write.mjs';
import { parseMidi } from '../../scripts/gen-bench/midi.mjs';

const S = 24;
const N = (step, pitch, len = 1, vel = 100) => ({ tick: step * S, gate: len * S, pitch, vel });
const sig = (ns) => (ns ? [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}.${n.gate}.${n.vel}`).join(',') : '-');
const by = (id) => G.PRESETS.find((p) => p.id === id);
const turn = (ctx, p, name, pos) => { const v = G.defaults(p, ctx); v[G.knobIndex(p, name)] = pos; return G.regenerate(ctx, p, v); };
const held = (notes, t) => notes.filter((n) => n.tick <= t && n.tick + n.gate > t).map((n) => n.pitch);

export async function run() {
_log('\nTest: generator quality fixes');

/* A chord part that puts a root under itself (HARMONY ROOTS) led each next
 * chord from that dropped root: over eight bars a pad sank to E0. */
{
    const input = fixtureInput('pad', { scene: 'locked' });
    input.len = 128;
    const ctx = G.prepare(input);
    const roots = ctx.plans.findIndex((p) => p.sit === 'roots');
    /* RANGE opened wide (1.8): the voicing spreads down, the root goes under it. */
    const out = G.realise(ctx, G.toEvents(ctx.src), { plan: ctx.plans[roots], tension: 0.5, range: 1.8 });
    const low = (bar) => Math.min(...out.filter((e) => Math.floor(e.tick / G.BAR) === bar).flatMap((e) => e.voices.map((v) => v.pitch)));
    ok('chord_part_does_not_sink_over_eight_bars', low(7) >= low(1) - 2 && low(5) >= low(1) - 2);
    ok('chord_part_root_stays_within_an_octave_under_its_range', Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(low)) >= ctx.lo - 3 - 10 - 12);
}

/* New Clip chords over a high bass line keep above it. */
{
    const input = createInput(false, 'empty', 1);
    input.tracks.push({ index: 1, name: 'Track 2', module: 'obxd', drum: false, padNames: null,
        clips: [{ track: 1, slot: 1, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0,
            notes: [0, 4, 8, 12, 16, 20, 24, 28].map((s, i) => N(s, [48, 50, 52, 50][i % 4], 2)) }] });
    const ctx = G.prepare(input);
    eq('chord_floor_is_a_fifth_over_the_band_bass', G.chordFloor(ctx), 57);
    for (const id of ['n-chords', 'n-pad', 'n-stabs']) {
        const notes = turn(ctx, by(id), 'REGISTER', 0) ?? [];
        ok(`new_clip_${id}_low_register_stays_over_the_bass`, notes.length > 0 && Math.min(...notes.map((n) => n.pitch)) >= 57);
    }
}

/* A note never rubs a semitone against what the band holds: a chord voice
 * moves by an octave; a line in a one-bar clip is judged on every bar of a
 * two-bar scene it loops under. Scene B holds Fmaj7 G7 Am7 E7. */
{
    const ctx = G.prepare(createInput(false, 'locked', 1));
    const bandB = ctx.input.tracks.filter((t) => t.index && !t.drum).flatMap((t) => t.clips.filter((c) => c.slot === 1).flatMap((c) => c.notes));
    const out = G.clearRubs(ctx, [N(0, 65, 4), N(0, 69, 4), N(0, 72, 4)], 0);
    ok('clear_rubs_moves_a_chord_voice_off_a_semitone: F against the held E', out.length === 3
        && out.some((n) => n.pitch !== 65 && n.pitch % 12 === 5) && out.every((n) => !held(bandB, 0).some((b) => rubs(n.pitch, b))));
    const short = G.prepare(createInput(false, 'locked', 1, { len: 16 }));
    const band = short.input.tracks.filter((t) => t.index && !t.drum).flatMap((t) => t.clips.filter((c) => c.slot === 1).flatMap((c) => c.notes));
    const [g] = G.clearRubs(short, [N(8, 55, 4)], 0);
    ok('clear_rubs_judges_a_short_clip_on_every_repeat: G fits G7 but rubs the G# of E7 a bar later', g.pitch !== 55
        && ![8, 24].some((s) => held(band, s * S).some((b) => rubs(g.pitch, b))));
}

/* TENSION walks: 5 is the take as it was; up adds colour tones one group at
 * a time, down takes outside notes back to chord tones. */
{
    const ctx = G.prepare(fixtureInput('lead', { scene: 'free' }));
    const chords = ctx.plans[0].chords;
    const evs = G.toEvents(ctx.src);
    const at = (t) => G.tensionStage(ctx, evs, chords, t);
    const off = (e) => e.filter((x) => G.categoryOf(x.voices[0].pitch, G.chordAt(chords, x.tick, ctx.k), ctx.key) !== 'chord').length;
    const counts = Array.from({ length: 11 }, (_, v) => off(at(v / 10)));
    eq('tension_5_leaves_the_take', sig(G.fromEvents(at(0.5), ctx.end)), sig(G.fromEvents(evs, ctx.end)));
    ok('tension_colour_rises_with_the_knob', counts.every((c, i) => i === 0 || c >= counts[i - 1]) && counts[10] > counts[5]);
    ok('tension_every_click_up_changes_the_take', new Set(counts.slice(5)).size === 6);
}

/* VARY and PITCH FIX: every click changes the take while there is something left to change. */
{
    const ctx = G.prepare(createInput(false, 'empty', 3));
    const p = by('n-bass');
    const outs = Array.from({ length: 6 }, (_, v) => sig(turn(ctx, p, 'VARY', v)));
    eq('vary_every_click_changes_the_part', new Set(outs).size, outs.length);
}
{
    const input = fixtureInput('lead', { task: 'quantize' });
    input.tracks[0].clips[0].notes = messy(PARTS.lead);
    const ctx = G.prepare(input);
    const p = by('q-tight');
    const steps = p.knobs[G.knobIndex(p, 'PITCH FIX')].steps(ctx);
    const wrong = (ns) => ns.filter((n) => G.noteFit(n.pitch, G.chordAt(G.fixChords(ctx), n.tick, ctx.k), ctx.key, G.isStrong(n.tick)) < 0.95).length;
    const counts = Array.from({ length: steps }, (_, v) => wrong(turn(ctx, p, 'PITCH FIX', v)));
    ok('pitch_fix_has_one_position_per_fixable_note', steps === G.fixable(ctx) + 1 && steps > 2);
    ok('pitch_fix_each_click_fixes_one_more', counts.every((c, i) => i === 0 || c < counts[i - 1]) && counts[steps - 1] === 0);
    eq('pitch_fix_label_ends_at_all', p.knobs[G.knobIndex(p, 'PITCH FIX')].label(steps - 1, ctx), 'ALL');
}

/* A Smart Double keeps its part's role: a run of 16ths over a held drone is refused. */
{
    const ctx = G.prepare(fixtureInput('drone', { task: 'double', scene: 'free' }));
    const flood = [...ctx.src, ...Array.from({ length: 16 }, (_, i) => N(48 + i, 57 + (i % 5), 0.5))];
    const g = G.guard(ctx, flood);
    ok('double_guard_refuses_a_role_break', !g.ok && /role/.test(g.why));
}

/* Ranges (user, 2026-10-29): the takes stay where they were measured; the
 * knob reaches past them, and each click between is a change. */
{
    const ctx = G.prepare(createInput(false, 'empty', 1));
    for (const id of ['n-chords', 'n-pad', 'n-stabs']) {
        const p = by(id);
        const i = G.knobIndex(p, 'REGISTER');
        const outs = Array.from({ length: p.knobs[i].steps(ctx) }, (_, v) => sig(turn(ctx, p, 'REGISTER', v)));
        ok(`${id}_register_every_click_is_a_new_voicing`, outs.length === 9 && new Set(outs).size === 9);
    }
    const arp = by('n-arp');
    const tones = (v) => Math.max(...(turn(ctx, arp, 'OCTAVES', v) ?? []).map((n) => n.pitch));
    const t = [0, 1, 2, 3, 4, 5].map(tones);
    ok('arp_octaves_every_click_climbs_further', t.every((x, j) => j === 0 || x > t[j - 1]));
    const per = (v) => (turn(ctx, arp, 'RATE', v) ?? []).length;
    ok('arp_rate_turns_one_way', [0, 1, 2, 3, 4].map(per).every((x, j, a) => j === 0 || x > a[j - 1]));
    const reg = by('n-riff'), mid = (v) => { const ns = turn(ctx, reg, 'REGISTER', v) ?? []; return ns.reduce((a, n) => a + n.pitch, 0) / ns.length; };
    ok('riff_register_steps_by_octaves', [0, 1, 2, 3].every((v) => Math.abs(mid(v + 1) - mid(v) - 12) < 3));
    /* Takes are rolled inside the measured ranges, never at the new ends. */
    const rolled = (id, name) => { const p = by(id), k = p.knobs[G.knobIndex(p, name)]; const r = G.rng(7); return new Set(Array.from({ length: 200 }, () => k.roll(ctx, r))); };
    ok('takes_stay_in_the_measured_register', [...rolled('n-chords', 'REGISTER')].every((v) => v >= 2 && v <= 6)
        && [...rolled('n-bass', 'OCTAVE')].every((v) => v === 1 || v === 2) && [...rolled('n-melody', 'RANGE')].every((v) => v >= 1 && v <= 5));
}
/* RANGE stretches a line: past AS IS the scaled interval beats the mapped
 * tone, so the turn is heard; and it reaches x3. */
{
    const ctx = G.prepare(fixtureInput('lead', { scene: 'free' }));
    const p = by('v-form');
    const outs = [5, 7, 10, 12].map((v) => sig(turn(ctx, p, 'RANGE', v)));
    ok('range_turns_are_heard_on_a_line', new Set(outs).size === 4);
    eq('range_reaches_x3', p.knobs[G.knobIndex(p, 'RANGE')].label(12, ctx), 'X3.0');
}

/* The bench's own parts. */
eq('bench_rub_is_a_minor_second_or_ninth_not_a_major_seventh', [rubs(60, 61), rubs(60, 73), rubs(60, 71), rubs(60, 62)].join(), 'true,true,false,false');
eq('bench_refused_take_is_a_dead_click_not_a_broken_one', verdict(null, false)[0], 'refused');
eq('bench_positions_sample_a_long_knob', positions(100, 0).length, 12);
ok('bench_spearman', Math.abs(spearman([0, 1, 2, 3], [1, 2, 3, 9]) - 1) < 1e-9 && spearman([0, 1], [5, 5]) === null);
const mid = parseMidi(writeMidi([{ name: 'Bass', channel: 1, notes: [N(0, 40, 2), N(4, 43, 1, 90)] }], 120));
eq('bench_midi_writer_round_trips', JSON.stringify(mid.tracks.flatMap((t) => t.notes)), JSON.stringify([N(0, 40, 2), N(4, 43, 1, 90)]));
}
