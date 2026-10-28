/* browser-test/logic/gen-double.mjs — Smart Double
 * (plans/2026-10-28-smart-double-design.md): the clip twice, only its seams
 * rewritten. The first part stays the user's, no option is the plain Double
 * Loop, and each ending does what its name says.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureInput, ROLES } from '../gen-fixtures.mjs';

const sig = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}.${n.vel}`).join(',');
const by = (id) => G.PRESETS.find((p) => p.id === id);
const take = (ctx, id, set = {}) => {
    const p = by(id);
    const v = G.defaults(p, ctx);
    for (const [name, x] of Object.entries(set)) v[G.knobIndex(p, name)] = x;
    return { v, notes: G.generateOption(ctx, p, v).notes };
};

export async function run() {
_log('\nTest: generator smart double');

/* The source is the clip's loop window played twice, from its start. */
const lead = G.prepare(fixtureInput('lead', { task: 'double' }));
const half = lead.end / 2;
eq('double_source_is_the_clip_twice', sig(lead.src.filter((n) => n.tick >= half).map((n) => ({ ...n, tick: n.tick - half }))),
    sig(lead.src.filter((n) => n.tick < half)));
const shifted = fixtureInput('lead', { task: 'double' });
const me = shifted.tracks[0].clips[0];
shifted.tracks[0].clips[0] = { ...me, loopStart: 16, len: 16, notes: me.notes };
const win = G.prepare({ ...shifted, len: 32 });
eq('double_reads_the_loop_window', sig(win.src.filter((n) => n.tick < 16 * G.TPS)),
    sig(me.notes.filter((n) => n.tick >= 16 * G.TPS).map((n) => ({ ...n, tick: n.tick - 16 * G.TPS }))));

/* Every double preset, on every role and scene it serves: everything before
 * its seams is the clip as played, and the result is never the plain double. */
const touched = [], copies = [];
let served = 0;
for (const scene of ['locked', 'partial', 'free']) {
    for (const role of ROLES) {
        const c = G.prepare(fixtureInput(role, { task: 'double', scene }));
        for (const p of G.PRESETS.filter((x) => x.task === 'double' && G.serves(x, c))) {
            const v = G.defaults(p, c);
            const out = G.generateOption(c, p, v).notes;
            if (!out) continue;
            served++;
            const e = G.knobIndex(p, 'ENDING'), s = G.knobIndex(p, 'SEAMS');
            const first = Math.min(...G.seams(c, e < 0 ? G.ENDING.steps(c) - 1 : v[e], s < 0 ? 0 : v[s]).map((x) => x.from));
            const before = (ns) => sig(ns.filter((n) => n.tick < first));
            if (before(out) !== before(c.src)) touched.push(`${p.id}@${scene}/${role}`);
            if (sig(out) === sig(c.src)) copies.push(`${p.id}@${scene}/${role}`);
        }
    }
}
eq('double_keeps_everything_before_its_seams', touched.join(' '), '');
eq('double_never_offers_the_plain_double', copies.join(' '), '');
ok('double_presets_ran', served > 40);

/* A request: six options, each different, over the doubled length. */
const all = G.generateAll(fixtureInput('lead', { task: 'double' }));
eq('double_request_offers_six', all.picks.length, 6);
ok('double_options_differ', all.picks.every((a, i) => all.picks.every((b, j) => i === j || sig(a.notes) !== sig(b.notes))));
const dr = G.generateAll(fixtureInput('drums', { task: 'double' }));
eq('double_request_offers_six_for_drums', dr.picks.length, 6);

/* TURNAROUND steps into the first note: its last note is one scale step
 * below it (BELOW), a semitone below (CHROMATIC). */
const target = G.nextEv(lead).voices.at(-1).pitch;
const lastNote = (ns) => [...ns].sort((a, b) => a.tick - b.tick).at(-1);
eq('turnaround_below_steps_up_into_the_first_note', lastNote(take(lead, 'x-turnaround', { APPROACH: 0, TENSION: 10 }).notes).pitch,
    G.stepScale(target, -1, lead.key));
eq('turnaround_chromatic_is_a_semitone_below', lastNote(take(lead, 'x-turnaround', { APPROACH: 3, TENSION: 10 }).notes).pitch, target - 1);

/* RUN UP rises through the ending; DOWN falls. */
const tail = (ns, ctx) => [...ns].filter((n) => n.tick >= ctx.end - G.ENDING_STEPS[1] * G.TPS).sort((a, b) => a.tick - b.tick).map((n) => n.pitch);
const up = tail(take(lead, 'x-run', { ENDING: 1, DIRECTION: 0, NOTES: 0 }).notes, lead);
const down = tail(take(lead, 'x-run', { ENDING: 1, DIRECTION: 1, NOTES: 0 }).notes, lead);
ok('run_up_rises', up.length > 2 && up.every((p, i) => i === 0 || p > up[i - 1]));
ok('run_down_falls', down.length > 2 && down.every((p, i) => i === 0 || p < down[i - 1]));

/* CADENCE on TONIC lands on A (the fixture is A minor) and holds to the end. */
const cad = take(lead, 'x-cadence', { LAND: 2, HOLD: 3 });
const land = cad.notes.filter((n) => n.tick >= lead.end - G.ENDING_STEPS[cad.v[0]] * G.TPS);
ok('cadence_lands_on_the_tonic_and_holds', land.length === 1 && G.pc(land[0].pitch) === 9 && land[0].tick + land[0].gate === lead.end);

/* STOP: silence, then PICKUP notes into the first note. */
const stop = take(lead, 'x-stop', { KIND: 0, PICKUP: 2 });
const stopFrom = lead.end - G.ENDING_STEPS[stop.v[0]] * G.TPS;
const inStop = stop.notes.filter((n) => n.tick >= stopFrom);
ok('stop_leaves_only_the_pickup', inStop.length === 2 && inStop.every((n) => n.tick >= lead.end - 4 * G.TPS));
ok('stop_cuts_what_rings_into_it', stop.notes.every((n) => n.tick >= stopFrom || n.tick + n.gate <= stopFrom));

/* TURN changes chords only where no other track sets them. */
const lockedLead = G.prepare(fixtureInput('lead', { task: 'double', scene: 'locked' }));
const freeLead = G.prepare(fixtureInput('lead', { task: 'double', scene: 'free' }));
ok('turn_not_offered_when_others_set_the_chords', !G.serves(by('x-turn'), lockedLead));
ok('turn_offered_in_a_free_scene', G.serves(by('x-turn'), freeLead));

/* Drums: FILL and ROLL play the snare in the ending; BREAK drops the kick and
 * hats; REPEAT repeats the slice before the ending. */
const drums = G.prepare(fixtureInput('drums', { task: 'double' }));
const endOf = (r) => r.notes.filter((n) => n.tick >= drums.end - G.ENDING_STEPS[r.v[0]] * G.TPS);
ok('fill_plays_snare_or_toms_in_the_ending', endOf(take(drums, 'xd-fill')).some((n) => [38, 45, 48].includes(n.pitch)));
const roll = endOf(take(drums, 'xd-roll', { RATE: 1 })).filter((n) => n.pitch === 38);
ok('roll_is_a_rising_snare_run', roll.length >= 4 && roll.at(-1).vel > roll[0].vel);
const brk = take(drums, 'xd-break', { KEEP: 0, PICKUP: 1 });
eq('break_leaves_one_pickup_hit', endOf(brk).map((n) => n.pitch).join(), '38');
const rep = take(drums, 'xd-repeat', { GRAIN: 1, DECAY: 0 });
const g = 2 * G.TPS, rFrom = drums.end - G.ENDING_STEPS[rep.v[0]] * G.TPS;
const slice = drums.src.filter((n) => n.tick >= rFrom - g && n.tick < rFrom).map((n) => `${n.tick - rFrom + g}.${n.pitch}`).sort().join();
ok('repeat_repeats_the_slice_before', endOf(rep).length > 0
    && endOf(rep).every((n) => slice.split(',').includes(`${(n.tick - rFrom) % g}.${n.pitch}`)));

/* The knobs answer: ENDING longer rewrites more, SEAMS BOTH reaches the
 * first half's end too. */
const changed = (ns, ctx) => { const a = new Set(ctx.src.map((n) => `${n.tick}.${n.pitch}`)); return ns.filter((n) => !a.has(`${n.tick}.${n.pitch}`)).length; };
ok('ending_longer_changes_more', changed(take(lead, 'x-run', { ENDING: 2 }).notes, lead) > changed(take(lead, 'x-run', { ENDING: 0 }).notes, lead));
const both = take(lead, 'x-turnaround', { SEAMS: 1 }).notes;
ok('seams_both_touches_the_first_half', both.filter((n) => n.tick < half).some((n) => !lead.src.some((s) => s.tick === n.tick && s.pitch === n.pitch)));
}
