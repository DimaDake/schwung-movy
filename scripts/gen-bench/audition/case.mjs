/* One audition case (plans/2026-11-07-gen-audition-design.md): a scene the
 * phone page plays, the part under test, and the recipe that rebuilds it.
 * The id joins a rating to one build's notes; the recipe key joins the same
 * case across builds, so a fix shows as before/after and the regression bench
 * finds the user's rated cases again. */
import { sceneAt, scaleOf } from '../quality/scene.mjs';

const r96 = (x) => Math.round(x * 96) / 96;
const note = (n) => [r96(n[0]), r96(n[1]), n[2], n[3]];

/** The scene at `slot` (with `swap` = { track, clip } in place) as the page plays it. */
export function sceneOf(set, slot, swap) {
    const s = sceneAt(set, slot, scaleOf(set), swap);
    return { len: s.len, bpm: set.bpm ?? 120, key: `${set.root} ${set.mode}`, tracks: {
        drums: [...s.kick, ...s.snare, ...s.hats, ...s.perc].map(note).sort((a, b) => a[0] - b[0]),
        bass: s.bass.map(note), chords: s.chords.flat().map(note), lead: s.lead.map(note) } };
}

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join()}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`).join()}}` : JSON.stringify(v));

/** FNV-1a over the recipe's sorted JSON, two passes for 12 hex digits. */
export function recipeKey(recipe) {
    const s = stable(recipe);
    const fnv = (h) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
    return (fnv(2166136261).toString(16).padStart(8, '0') + fnv(84696351).toString(16).padStart(8, '0')).slice(0, 12);
}

export function makeCase({ kind, recipe, build, scene, target, generator, knobs, options, truth, bench }) {
    const key = recipeKey(recipe);
    return { id: `${key}-${build}`, recipeKey: key, kind, build, recipe, scene, target, generator, knobs,
        ...(options ? { options } : {}), ...(truth ? { truth } : {}), bench };
}
