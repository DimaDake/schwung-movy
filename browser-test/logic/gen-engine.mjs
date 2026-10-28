/* browser-test/logic/gen-engine.mjs — the algorithmic generators end to end
 * (plans/2026-10-27-algorithmic-generators-design.md): who owns the harmony,
 * the plans HARMONY steps through, the guard, the selection, and the knob
 * property — every knob of every preset moves the output.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureInput, messy, ROLES, createInput } from '../gen-fixtures.mjs';

const sig = (a) => (a ? a.map((n) => `${n.tick}.${n.pitch}.${n.gate}.${n.vel}`).join(',') : '-');
const names = (cs) => cs.map(G.chordName).join(' ');

function quantInput(role) {
    const input = fixtureInput(role, { task: 'quantize' });
    input.tracks[0].clips[0].notes = messy(input.tracks[0].clips[0].notes);
    return input;
}

export async function run() {
_log('\nTest: generator engine');

/* §2 — the freedom table. */
const locked = G.prepare(fixtureInput('lead', { scene: 'locked' }));
const partial = G.prepare(fixtureInput('lead', { scene: 'partial' }));
const free = G.prepare(fixtureInput('lead', { scene: 'free' }));
eq('freedom_locked_when_others_spell_chords', locked.freedom, 'locked');
eq('freedom_partial_when_a_bass_alone_pins', partial.freedom, 'partial');
eq('freedom_free_when_nobody_plays_there', free.freedom, 'free');
eq('locked_follows_the_scenes_chords', names(locked.plans[0].chords), 'FMA7 G7 AM7 E7');
eq('locked_harmony_steps_how_the_part_sits', locked.plans.map((p) => p.label).join(','), 'AS PLAYED,ROOTS,INVERSION,7TH,9TH');
eq('partial_fit_takes_the_pinned_bass_as_root', partial.plans[0].label + ': ' + names(partial.plans[0].chords).split(' ').map((c) => c[0]).join(''), 'FIT: FGAE');
eq('free_starts_from_the_sources_progression', free.plans[0].label, 'SAME');
eq('free_harmony_opens_on_a_move (a B changes harmony)', G.defaultHarmony(free), 1);
eq('locked_harmony_opens_as_played', G.defaultHarmony(locked), 0);
ok('sevenths_carry_over_from_a_seventh_chord_source', free.plans.filter((p) => /SEQ/.test(p.label)).every((p) => p.chords.every((c) => !c || c.pcs.length === 4)));

/* Quantize reads the clip's own scene: no HARMONY plans to choose from. */
const q = G.prepare(quantInput('pad'));
eq('quantize_one_plan', q.plans.length, 1);

/* The guard. */
const ctx = G.prepare(fixtureInput('lead', { scene: 'locked' }));
ok('guard_refuses_the_source_back (same loop)', !G.guard(ctx, ctx.src.map((n) => ({ ...n }))).ok);
ok('guard_refuses_the_source_transposed', !G.guard(ctx, ctx.src.map((n) => ({ ...n, pitch: n.pitch + 5 }))).ok);
ok('guard_refuses_chords_for_a_line (role)', !G.guard(ctx, ctx.src.flatMap((n) => [n, { ...n, pitch: n.pitch - 4 }, { ...n, pitch: n.pitch - 7 }])).ok);
const dctx = G.prepare(fixtureInput('drums'));
ok('guard_keeps_drums_on_the_kit', G.clampNotes(dctx, [{ tick: 0, gate: 12, pitch: 99, vel: 100 }, { tick: 0, gate: 12, pitch: 36, vel: 100 }]).length === 1);
ok('guard_refuses_an_unchanged_drum_pattern', !G.guard(dctx, dctx.src.map((n) => ({ ...n }))).ok);

/* FOLLOW planes a chord shape continuously (dub/house stabs). */
const fctx = G.prepare(fixtureInput('stabs', { scene: 'locked' }));
const follow = G.presetById('v-follow');
const fo = G.generateOption(fctx, follow, G.defaults(follow, fctx)).notes;
const first = fo.filter((n) => n.tick === fo[0].tick).map((n) => n.pitch);
const srcFirst = fctx.src.filter((n) => n.tick === fctx.src[0].tick).map((n) => n.pitch);
const shape = (a) => a.map((p) => p - a[0]).join(',');
ok('follow_keeps_the_voicing_shape_diatonically', shape(first).split(',').length === shape(srcFirst).split(',').length && first[0] !== srcFirst[0]);

/* TIMING lands a chord played a few ticks apart as one chord. */
const tq = G.prepare(quantInput('pad'));
const tight = G.presetById('q-tight');
const tn = G.generateOption(tq, tight, G.defaults(tight, tq)).notes;
ok('timing_chord_lands_together', tn.filter((n) => n.tick === 0).length >= 4 && !tn.some((n) => n.tick > 0 && n.tick < 12));

/* Selection. */
for (const level of ['SAFE', 'BALANCED', 'WILD']) {
    const r = G.generateAll(fixtureInput('lead', { scene: 'free', level }));
    eq(`select_six_variation_options_${level}`, r.picks.length, 6);
    ok(`select_never_one_preset_twice_${level}`, new Set(r.picks.map((p) => p.preset.id)).size === r.picks.length);
}
const sel = G.generateAll(fixtureInput('pad', { scene: 'locked' }));
const pairOk = sel.picks.every((a, i) => sel.picks.every((b, j) => i === j || G.difference(a.notes, b.notes) >= G.MIN_PAIR));
ok('select_options_differ_by_the_gate_threshold', pairOk);
const d = sel.picks.map((p) => G.difference(p.notes, sel.ctx.src));
ok('select_closest_first', d.every((x, i) => i === 0 || x >= d[i - 1]));
eq('select_is_deterministic', sel.picks.map((p) => sig(p.notes)).join('|'), G.generateAll(fixtureInput('pad', { scene: 'locked' })).picks.map((p) => sig(p.notes)).join('|'));
const qs = G.generateAll(quantInput('lead'));
eq('select_three_quantize_options', qs.picks.length, 3);
eq('select_quantize_opens_on_the_tightest', qs.picks[0].preset.cls, 'close');
eq('slots_three_of_six_keep_the_proportions', G.slotsFor('variation', 3, 'BALANCED').join(','), 'close,rhythm,exp');

/* §5.1 — every knob of every preset moves the output. Each knob must change
 * the option on at least one fixture its preset serves, and a preset keeps at
 * least half its knobs live on every fixture it serves (else it must not
 * serve that role). A knob dead on one material is hidden there (live.ts). */
const liveAny = new Map();
const thin = [];
let served = 0;
for (const task of ['variation', 'quantize', 'double', 'create']) {
    for (const scene of task === 'quantize' ? ['locked'] : task === 'create' ? ['empty', 'locked', 'free'] : ['locked', 'partial', 'free']) {
        for (const role of task === 'create' ? ['lead', 'drums'] : ROLES) {
            const input = task === 'quantize' ? quantInput(role) : task === 'create' ? createInput(role === 'drums', scene, 3)
                : fixtureInput(role, { task, scene });
            const c = G.prepare(input);
            for (const p of G.PRESETS) {
                if (!G.serves(p, c)) continue;
                const v = G.defaults(p, c);
                if (!G.generateOption(c, p, v).notes) { thin.push(`${p.id}@${role}:default fails`); continue; }
                served++;
                const dead = p.knobs.filter((k, i) => {
                    const live = G.knobLive(c, p, v, i);
                    if (live) liveAny.set(p.id + ':' + k.name, true);
                    else if (!liveAny.has(p.id + ':' + k.name)) liveAny.set(p.id + ':' + k.name, false);
                    return !live;
                });
                /* An added SEED (seeded.ts) that no dice reach on this part is hidden,
                 * and does not make the preset thin: its own knobs decide. */
                const own = p.knobs.filter((k) => k.name !== 'SEED' || p.knobs.length !== 5).length;
                if (dead.filter((k) => k.name !== 'SEED' || p.knobs.length !== 5).length * 2 > own) thin.push(`${p.id}@${task}/${scene}/${role}: ${dead.map((k) => k.name)}`);
            }
        }
    }
}
const never = [...liveAny].filter(([, l]) => !l).map(([k]) => k);
eq('knob_property_every_knob_live_somewhere', never.join(' '), '');
eq('knob_property_half_live_on_every_served_role', thin.join(' | '), '');
ok('knob_property_every_preset_served_by_a_fixture', G.PRESETS.every((p) => [...liveAny.keys()].some((k) => k.startsWith(p.id + ':'))));
ok('knob_property_presets_have_four_five_or_eight_knobs', G.PRESETS.every((p) => [4, 5, 8].includes(p.knobs.length)));
/* SEED where a preset rolls dice and had knobs to spare: #1 is the take it
 * always gave, another position another take. */
const seeded = G.PRESETS.filter((p) => p.knobs.length === 5);
eq('seed_added_where_knobs_were_free', seeded.map((p) => p.id).sort().join(' '),
    'd-fill q-embellish v-connect v-octave v-ornament v-pedal v-recombine v-retro v-thin v-walk xd-fill');
ok('seed_is_the_fifth_knob', seeded.every((p) => p.knobs[4].name === 'SEED'));
const sc = G.prepare(fixtureInput('lead', { scene: 'free' }));
const walk = G.PRESETS.find((p) => p.id === 'v-walk');
const wv = G.defaults(walk, sc);
const wsig = (k) => JSON.stringify(G.regenerate(sc, walk, [...wv.slice(0, 4), k]));
ok('seed_moves_the_take', new Set([0, 1, 2, 3, 4].map(wsig)).size > 2);
ok('knob_property_ran', served > 150);
}
