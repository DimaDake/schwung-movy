/* browser-test/logic/gen-audition.mjs — the audition app's exporter, queue,
 * page core and rating benches (plans/2026-11-07-gen-audition-plan.md).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { makeCase, recipeKey, sceneOf } from '../../scripts/gen-bench/audition/case.mjs';
import { blindRecipes, rebuild, setRecipes } from '../../scripts/gen-bench/audition/sources.mjs';
import { chunks, interleave, packCase } from '../../scripts/gen-bench/audition/queue.mjs';
import { compareCase, firstList, regression, summarise } from '../../scripts/gen-bench/audition/summary.mjs';
import { caseMidi, drop, earVsBench, enqueue, markAt, nextIndex, ratingDoc, schedule, tracksFor } from '../../scripts/gen-bench/audition/page/core.mjs';

const set2 = () => ({ root: 'C', mode: 'minor', bpm: 124, tracks: [
    { index: 0, name: 'Drums', drum: true, clips: [{ track: 0, slot: 0, len: 16, notes: [{ tick: 0, gate: 12, pitch: 36, vel: 100 }, { tick: 96, gate: 12, pitch: 38, vel: 90 }] }] },
    { index: 1, name: 'Bass', drum: false, clips: [{ track: 1, slot: 0, len: 16, notes: [{ tick: 10, gate: 50, pitch: 36, vel: 100 }] }] },
    { index: 2, name: 'Chords', drum: false, clips: [] },
    { index: 3, name: 'Lead', drum: false, clips: [] }] });

export async function run() {
_log('\nTest: audition case model');

eq('recipe_key_ignores_key_order', recipeKey({ a: 1, b: [2, 3] }), recipeKey({ b: [2, 3], a: 1 }));
eq('recipe_key_is_12_hex', /^[0-9a-f]{12}$/.test(recipeKey({ src: 'path', seed: 1 })), true);
ok('recipe_key_differs_by_value', recipeKey({ seed: 1 }) !== recipeKey({ seed: 2 }));

const sc = sceneOf(set2(), 0);
eq('scene_has_four_tracks', Object.keys(sc.tracks).sort().join(), 'bass,chords,drums,lead');
eq('scene_missing_track_empty', sc.tracks.lead.length, 0);
eq('scene_bpm_from_set', sc.bpm, 124);
eq('scene_key_from_set', sc.key, 'C minor');
eq('scene_drums_keep_pitches', sc.tracks.drums.map((n) => n[2]).sort().join(), '36,38');
/* tick 10 of 96 per beat = 0.104166..., kept at 1/96 resolution. */
eq('scene_notes_rounded_to_96th', sc.tracks.bass[0][0], Math.round((10 / 96) * 96) / 96);

const recipe = { src: 'path', seed: 3, order: [0, 1], step: 1 };
const a = makeCase({ kind: 'set', recipe, build: 'aaa111', scene: sc, target: 'bass', generator: 'n-bass', knobs: [1], bench: { ok: true, bad: [] } });
const b = makeCase({ kind: 'set', recipe: { step: 1, order: [0, 1], seed: 3, src: 'path' }, build: 'bbb222', scene: sc, target: 'bass', generator: 'n-bass', knobs: [1], bench: { ok: true, bad: [] } });
eq('same_recipe_same_recipe_key_across_builds', a.recipeKey, b.recipeKey);
ok('same_recipe_new_id_per_build', a.id !== b.id);
eq('case_id_is_key_and_build', a.id, a.recipeKey + '-aaa111');

_log('\nTest: audition case sources');

const notesOf = (c) => JSON.stringify(c.options ? c.options.map((o) => o.notes) : c.scene.tracks[c.target]);
const pr = { src: 'path', seed: 2, order: [1, 3], step: 1 };
const c1 = rebuild(G, pr, {}, [], 'b1'), c2 = rebuild(G, pr, {}, [], 'b1');
ok('rebuild_path_gives_a_case', !!c1 && c1.kind === 'set' && c1.target === 'lead');
eq('rebuild_is_deterministic', notesOf(c1), notesOf(c2));
ok('set_case_options_have_notes', c1.options.length >= 1 && c1.options.every((o) => o.notes.length > 0));
const cb = rebuild(G, { src: 'chainB', seed: 1, order: [2], step: 0 }, {}, [], 'b1');
ok('chain_b_case_is_variation_set', !!cb && cb.options.length >= 1 && cb.target === 'chords');
const fl = rebuild(G, { ...pr, flagged: true }, {}, [], 'b1');
ok('flagged_case_plays_the_kept_take', fl.kind === 'flagged' && !fl.options && fl.scene.tracks.lead.length > 0);
eq('set_recipes_cover_steps', setRecipes(1).filter((r) => r.src === 'path').length, 4 + 12 + 24 + 24);

/* A real scene, one bar of C minor over four bars. */
const bar = (b, xs) => xs.map(([s, d, p]) => [b * 4 + s, d, p, 100]);
const four = (xs) => [0, 1, 2, 3].flatMap((b) => bar(b, xs));
const ref = (src, kind) => ({ src, kind, len: 16, kick: four([[0, 0.25, 36], [2, 0.25, 36]]), snare: four([[1, 0.25, 38], [3, 0.25, 38]]),
    hats: four([[0.5, 0.25, 42], [1.5, 0.25, 42], [2.5, 0.25, 42], [3.5, 0.25, 42]]), perc: [],
    bass: four([[0, 1, 36], [2, 1, 43]]), chords: [four([[0, 4, 60], [0, 4, 63], [0, 4, 67]])], lead: four([[0, 1, 72], [1, 1, 75], [2, 2, 74]]) });
const refs = [ref('u1', 'user'), ref('p1', 'public'), ref('u2', 'user'), ref('p2', 'public')];
const real = rebuild(G, { src: 'loo', ref: 'u1', track: 1, truth: 'real' }, {}, refs, 'b1');
const gen = rebuild(G, { src: 'loo', ref: 'u1', track: 1, truth: 'gen' }, {}, refs, 'b1');
eq('blind_real_plays_the_ref_part', JSON.stringify(real.scene.tracks.bass), JSON.stringify(sceneOfRef(refs[0])));
ok('blind_gen_plays_another_part', JSON.stringify(gen.scene.tracks.bass) !== JSON.stringify(real.scene.tracks.bass));
eq('blind_real_and_gen_share_recipe_but_truth', real.truth + gen.truth, 'realgen');
eq('blind_recipes_alternate_user_public', blindRecipes(refs).slice(0, 4).map((r) => refs.find((x) => x.src === r.ref).kind).join(), 'user,public,user,public');

_log('\nTest: audition queue');

const fake = (kind, n, gens) => Array.from({ length: n }, (_, k) => ({ id: `${kind}${k}`, kind, generator: gens[k % gens.length] }));
const pools = { set: fake('set', 100, ['create:bass', 'create:lead', 'variation:chords', 'double:drums']), flagged: fake('flagged', 60, ['n-bass', 'n-arp']), blind: fake('blind', 40, ['real', 'n-pad']) };
const q = interleave(pools, undefined, 7);
const share = (k) => q.slice(0, 50).filter((c) => c.kind === k).length / 50;
ok('queue_set_share_near_half', Math.abs(share('set') - 0.5) <= 0.05);
ok('queue_flagged_share_near_30', Math.abs(share('flagged') - 0.3) <= 0.05);
ok('queue_blind_share_near_20', Math.abs(share('blind') - 0.2) <= 0.05);
eq('queue_keeps_every_case', q.length, 200);
eq('queue_every_generator_early', new Set(q.filter((c) => c.kind === 'set').slice(0, 4).map((c) => c.generator)).size, 4);
eq('queue_deterministic_per_seed', interleave(pools, undefined, 7).map((c) => c.id).join(), q.map((c) => c.id).join());
ok('queue_seed_changes_order', interleave(pools, undefined, 8).map((c) => c.id).join() !== q.map((c) => c.id).join());
const packed = packCase(c1);
ok('pack_notes_are_integer_96ths', packed.options[0].notes.every((n) => n.every(Number.isInteger)));
eq('pack_keeps_onsets', packed.options[0].notes[0][0], Math.round(c1.options[0].notes[0][0] * 96));
eq('chunks_first_small_then_200', chunks(Array(450).fill(0)).map((c) => c.length).join(), '40,200,200,10');

_log('\nTest: audition page core');

const pc = { id: 'abc-b1', recipeKey: 'abc', build: 'b1', kind: 'set', generator: 'create:bass', target: 'bass',
    scene: { len: 4, bpm: 120, tracks: { drums: [[0, 24, 36, 100]], bass: [], chords: [], lead: [[360, 48, 72, 90]] } },
    options: [{ preset: 'n-bass', notes: [[0, 96, 36, 100]], bench: { ok: true, bad: [] } }, { preset: 'n-walk', notes: [[96, 48, 38, 100]], bench: { ok: false, bad: ['bc.rub'] } }] };
const d1 = ratingDoc(pc, 1, 'bad', ['clash'], [{ bar: 1, beat: 2 }], '', 5), d2 = ratingDoc(pc, 1, 'keep', [], [], '', 6);
eq('rating_same_case_option_same_doc', d1.id, d2.id);
ok('rating_other_option_other_doc', ratingDoc(pc, 0, 'bad', [], [], '', 5).id !== d1.id);
eq('rating_names_the_option_preset', d1.data.preset, 'n-walk');
eq('rating_plain_case_doc_id', ratingDoc({ ...pc, options: undefined }, null, 'meh', [], [], '', 1).id, 'abc-b1~p');
eq('tracks_for_option_swap_target', tracksFor(pc, 1).bass[0][2], 38);
/* Window beats 3..5 of a 4-beat loop at 120 bpm: lead at beat 3.75 (0.375 s), then the drum hit wrapped to beat 4 (0.5 s). */
const ev = schedule(tracksFor(pc, 0), 4, 3, 5, 120, new Set(), null);
eq('schedule_wraps_into_next_loop', ev.map((e) => `${e.track}@${e.t}`).join(), 'lead@0.375,drums@0.5,bass@0.5');
eq('schedule_muted_track_absent', schedule(tracksFor(pc, 0), 4, 0, 4, 120, new Set(['drums']), null).some((e) => e.track === 'drums'), false);
eq('schedule_solo_one_track', [...new Set(schedule(tracksFor(pc, 0), 4, 0, 8, 120, new Set(), 'bass').map((e) => e.track))].join(), 'bass');
eq('mark_at_fraction', JSON.stringify(markAt(0.51, { len: 8 })), '{"bar":2,"beat":1}');
eq('mark_at_end_stays_inside', JSON.stringify(markAt(1, { len: 8 })), '{"bar":2,"beat":4}');
eq('outbox_same_id_kept_once', enqueue(enqueue([], d1), d2).length, 1);
eq('outbox_keeps_latest', enqueue(enqueue([], d1), d2)[0].data.rating, 'keep');
eq('outbox_drop', drop(enqueue([], d1), d1.id).length, 0);
eq('next_index_skips_rated', nextIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Set(['a', 'b']), 0), 2);
eq('next_index_past_end', nextIndex([{ id: 'a' }], new Set(['a']), 0), 1);
eq('ear_vs_bench_ok_but_bad', earVsBench({ ok: true }, 'bad'), 'benchOkUserBad');
eq('ear_vs_bench_bad_but_keep', earVsBench({ ok: false }, 'keep'), 'benchBadUserKeep');
eq('ear_vs_bench_agree', earVsBench({ ok: true }, 'keep'), null);
const mid = caseMidi(pc, 0);
eq('midi_header', String.fromCharCode(...mid.slice(0, 4)), 'MThd');
eq('midi_four_tracks', mid[11], 4);

_log('\nTest: audition ratings report');

const bl = { id: 'bk-b1', recipeKey: 'bk', build: 'b1', kind: 'blind', truth: 'gen', generator: 'n-walk', target: 'bass', recipe: { src: 'loo' }, bench: { ok: true, bad: [] }, scene: pc.scene };
const rl = { id: 'rk-b1', recipeKey: 'rk', build: 'b1', kind: 'blind', truth: 'real', generator: 'real', target: 'bass', recipe: { src: 'loo' }, bench: { ok: false, bad: ['x'] }, scene: pc.scene };
const rs = [ratingDoc(pc, 1, 'keep', [], [], '', 1), ratingDoc(pc, 1, 'bad', ['clash'], [{ bar: 1, beat: 3 }], '', 2), ratingDoc(pc, 0, 'bad', ['boring'], [], '', 3),
    ratingDoc(bl, null, 'bad', ['off-groove'], [], '', 4), ratingDoc(rl, null, 'keep', [], [], '', 5)];
const sum = summarise(rs, [pc, bl, rl]);
const walk = sum.byGenerator.find((g) => g.generator === 'n-walk');
eq('report_rerating_counts_once', sum.byGenerator.find((g) => g.generator === 'n-bass').n, 1);
eq('report_latest_rating_wins', JSON.stringify(walk.reasons), '{"clash":1,"off-groove":1}');
eq('report_blind_counts_under_generator', walk.n, 2);
eq('report_blind_shares', JSON.stringify(sum.blind), '{"real":1,"realKeep":1,"gen":1,"genKeep":0}');
eq('report_ear_vs_bench_ok_but_bad', sum.byGenerator.find((g) => g.generator === 'n-bass').earVsBench.benchOkUserBad, 1);
eq('report_ear_vs_bench_bad_but_keep', sum.byGenerator.find((g) => g.generator === 'real').earVsBench.benchBadUserKeep, 1);
eq('report_marks_kept', walk.marks.length, 1);
eq('first_list_bad_generated_only', firstList(rs, [pc, bl, rl]).map((f) => f.recipeKey).sort().join(), 'abc,bk');

_log('\nTest: audition regression on rated cases');

const old = packCase(c1);
eq('regress_same_recipe_same_build_is_same', compareCase(G, old, packCase(rebuild(G, pr, {}, [], 'b2')), 0), 'same');
const moved = { ...old, options: old.options.map((o, k) => (k ? o : { ...o, notes: o.notes.map(([s, d, p, v]) => [s, d, p + 5, v]) })) };
eq('regress_altered_notes_changed', compareCase(G, old, moved, 0), 'changed');
eq('regress_missing_rebuild_changed', compareCase(G, old, null, 0), 'changed');
const reg = regression(G, [ratingDoc(old, 0, 'bad', [], [], '', 1), ratingDoc(old, 1, 'keep', [], [], '', 1), ratingDoc(rl, null, 'bad', [], [], '', 1)], [old, rl],
    (recipe) => (recipe.src === 'path' ? moved : null));
eq('regress_bad_changed_counted', reg.bads.changed, 1);
eq('regress_keep_unchanged_not_listed', reg.keeps.changed.length, 0);
eq('regress_real_blind_skipped', reg.skipped, 1);
}

function sceneOfRef(r) { return [...r.bass].map((n) => [Math.round(n[0] * 96) / 96, Math.round(n[1] * 96) / 96, n[2], n[3]]); }

