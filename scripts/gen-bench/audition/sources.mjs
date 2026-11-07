/* Where audition cases come from (plans/2026-11-07-gen-audition-plan.md, Task
 * 2): the quality benches' own builders, replayed from a recipe so the same
 * case can be rebuilt at any later build. `rebuild` is the only builder; the
 * exporter and the regression bench both call it.
 *
 *   path    New Clip on order[step] after order[0..step) were made (paths.mjs)
 *   chainB  Variation into scene B on order[step] after the others (chains.mjs)
 *   double  Smart Double of one track of scene A (chains.mjs)
 *   loo     a real scene, its part against New Clip's as an A/B (loo.mjs)
 * Ratings of the first page also name two older recipes, still rebuilt for
 * the report and the regression: `loo` with a `truth` (one part alone) and
 * `flagged: true` (the take the scripted user keeps, not the six). */
import { makeCase, recipeKey, sceneOf } from './case.mjs';
import { judge } from '../quality/keep.mjs';
import { LENS, emptySet, newClip, orders, ROLE_PRESETS } from '../quality/paths.mjs';
import { request, sceneA, spread, vary } from '../quality/chains.mjs';
import { looRequest, refSet } from '../quality/loo.mjs';
import { clip, put } from '../quality/piece.mjs';
import { copySet, ROLE, sceneAt, scaleOf } from '../quality/scene.mjs';

const clipAt = (set, i, slot) => set.tracks[i].clips.find((c) => c.slot === slot);
const verdict = (j) => ({ ok: j.ok, bad: j.bad });
const tester = (bands, set, i, slot, len) => judge(bands, ROLE[i], (ns) => sceneAt(set, slot, scaleOf(set), { track: i, clip: clip(i, slot, len, ns) }));
const partOf = (set, i, slot, len, ns) => sceneOf(set, slot, { track: i, clip: clip(i, slot, len, ns) }).tracks[ROLE[i]];

/** One request's result as a case: the six (`set`) or the kept take (`flagged`). */
function asCase(recipe, build, bands, { set, i, slot, len, task, pick, picks }) {
    const test = tester(bands, set, i, slot, len);
    const base = { recipe, build, target: ROLE[i] };
    if (recipe.flagged) {
        if (!pick?.notes.length) return null;
        return makeCase({ ...base, kind: 'flagged', scene: sceneOf(set, slot, { track: i, clip: clip(i, slot, len, pick.notes) }),
            generator: pick.preset.id, knobs: [...pick.knobs], bench: verdict(test(pick.notes)) });
    }
    const options = picks.filter((p) => p.notes?.length).map((p) => ({ preset: p.preset.id, knobs: [...p.knobs],
        notes: partOf(set, i, slot, len, p.notes), bench: verdict(test(p.notes)) }));
    if (!options.length) return null;
    return makeCase({ ...base, kind: 'set', scene: sceneOf(set, slot, { track: i, clip: null }), generator: `${task}:${ROLE[i]}`,
        knobs: [], options, bench: { ok: options.some((o) => o.bench.ok), bad: [] } });
}

function fromPath(G, { seed, order, step }) {
    const set = emptySet(seed), len = LENS[seed % LENS.length];
    for (const i of order.slice(0, step)) {
        const { pick } = newClip(G, set, i, 0, len, seed);
        if (pick) put(set.tracks, i, 0, clip(i, 0, len, pick.notes));
    }
    const i = order[step];
    const { pick, r } = newClip(G, set, i, 0, len, seed);
    const ids = ROLE_PRESETS[ROLE[i]];
    return { set, i, slot: 0, len, task: 'create', pick, picks: ids ? r.picks.filter((p) => ids.includes(p.preset.id)) : r.picks };
}

function fromChainB(G, { seed, order, step }, bands) {
    const set = copySet(sceneA(G, seed));
    for (const i of order.slice(0, step)) vary(G, set, i, 0, 1, bands, seed + i);
    const i = order[step];
    const len = clipAt(set, i, 0).len;
    const { pick, r } = vary(G, set, i, 0, 1, bands, seed + i);
    return { set, i, slot: 1, len, task: 'variation', pick, picks: r.picks };
}

function fromDouble(G, { seed, track: i }, bands) {
    const set = copySet(sceneA(G, seed));
    spread(set, 0, [2]);
    const c = clipAt(set, i, 2);
    if (!c || c.len * 2 > 256) return null;
    const { pick, r } = request(G, set, i, 2, c.len * 2, { task: 'double', source: null }, bands, seed + i + 1);
    return { set, i, slot: 2, len: c.len * 2, task: 'double', pick, picks: r.picks };
}

function fromLoo(G, recipe, bands, refs, build) {
    const ref = refs.find((r) => r.src === recipe.ref);
    const rs = ref && refSet(G, ref);
    const i = recipe.track;
    if (!rs || !rs.set.tracks[i].clips.length) return null;
    const { without, options } = looRequest(G, ref, rs, i);
    const test = tester(bands, without, i, 0, rs.steps);
    const real = rs.set.tracks[i].clips[0].notes;
    const gen = options[0];
    if (!gen?.notes.length) return null;
    const base = { recipe, build, target: ROLE[i], refKind: ref.kind };
    if (recipe.truth) {
        const ns = recipe.truth === 'real' ? real : gen.notes;
        return makeCase({ ...base, kind: 'blind', truth: recipe.truth, scene: sceneOf(without, 0, { track: i, clip: clip(i, 0, rs.steps, ns) }),
            generator: recipe.truth === 'real' ? 'real' : gen.preset.id, knobs: recipe.truth === 'real' ? [] : [...gen.knobs], bench: verdict(test(ns)) });
    }
    const part = (truth, preset, knobs, ns) => ({ preset, truth, knobs, notes: partOf(without, i, 0, rs.steps, ns), bench: verdict(test(ns)) });
    const two = [part('real', 'real', [], real), part('gen', gen.preset.id, [...gen.knobs], gen.notes)];
    /* Which side the real part is on follows the recipe, so it is fixed per case and even over many. */
    if (parseInt(recipeKey(recipe)[0], 16) & 1) two.reverse();
    return makeCase({ ...base, kind: 'ab', scene: sceneOf(without, 0, { track: i, clip: null }), generator: gen.preset.id, knobs: [], options: two, bench: two.find((o) => o.truth === 'gen').bench });
}

/** The case `recipe` names, built at the current generators; null when it plays nothing. */
export function rebuild(G, recipe, bands, refs, build) {
    G.forgetOptions();
    if (recipe.src === 'loo') return fromLoo(G, recipe, bands, refs, build);
    const at = recipe.src === 'path' ? fromPath(G, recipe) : recipe.src === 'chainB' ? fromChainB(G, recipe, bands)
        : recipe.src === 'double' ? fromDouble(G, recipe, bands) : null;
    return at ? asCase(recipe, build, bands, at) : null;
}

/** Every distinct prefix of the 24 orders (4 + 12 + 24 + 24), by New Clip and
 *  by Variation, and Smart Double on each track, for `seeds` seeds. */
export function setRecipes(seeds) {
    const prefixes = [...new Set(orders().flatMap((o) => o.map((_, k) => o.slice(0, k + 1).join())))].map((s) => s.split(',').map(Number));
    const out = [];
    for (let seed = 0; seed < seeds; seed++) {
        for (const order of prefixes) {
            out.push({ src: 'path', seed, order, step: order.length - 1 });
            out.push({ src: 'chainB', seed, order, step: order.length - 1 });
        }
        for (const track of [0, 1, 2, 3]) out.push({ src: 'double', seed, track });
    }
    return out;
}

const hasPart = (ref, i) => (i === 0 ? ref.kick.length + ref.snare.length + ref.hats.length + ref.perc.length
    : i === 1 ? ref.bass.length : i === 2 ? ref.chords.flat().length : ref.lead.length) > 0;

/** Every real scene x part as an A/B, the user's and the public scenes alternating. */
export function abRecipes(refs) {
    const of = (kind) => refs.filter((r) => r.kind === kind).flatMap((r) => [0, 1, 2, 3].filter((i) => hasPart(r, i)).map((track) => ({ src: 'loo', ref: r.src, track })));
    const u = of('user'), p = of('public'), out = [];
    for (let k = 0; k < Math.max(u.length, p.length); k++) { if (u[k]) out.push(u[k]); if (p[k]) out.push(p[k]); }
    return out;
}

/** An older recipe as the page asks it now: a lone blind part becomes its A/B, a kept take its press. */
export function current(recipe) {
    const { truth, flagged, ...now } = recipe;
    return now;
}
