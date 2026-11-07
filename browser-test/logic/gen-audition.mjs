/* browser-test/logic/gen-audition.mjs — the audition app's exporter, queue,
 * page core and rating benches (plans/2026-11-07-gen-audition-plan.md).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { makeCase, recipeKey, sceneOf } from '../../scripts/gen-bench/audition/case.mjs';
import { blindRecipes, rebuild, setRecipes } from '../../scripts/gen-bench/audition/sources.mjs';

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
}

function sceneOfRef(r) { return [...r.bass].map((n) => [Math.round(n[0] * 96) / 96, Math.round(n[1] * 96) / 96, n[2], n[3]]); }

