/* browser-test/logic/gen-audition.mjs — the audition app's exporter, queue,
 * page core and rating benches (plans/2026-11-07-gen-audition-plan.md).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import { makeCase, recipeKey, sceneOf } from '../../scripts/gen-bench/audition/case.mjs';

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
}
