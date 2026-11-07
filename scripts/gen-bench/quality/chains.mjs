/* Evolving a Set with generators only (plans/2026-11-07-generation-paths-bench.md,
 * step 6): scene A is built with New Clip; then
 *   B      scene B made by Variation, track by track, in each of the 24 orders
 *          (the tracks already varied are B's band, the rest not yet there);
 *   depth  one part varied 5 times in a row, each from the last, the others fixed;
 *   double each track's A clip Smart Doubled, track by track;
 *   quant  one part played loosely (gen-fixtures messy) and Smart Quantized.
 * Every step is measured as relations.mjs reads the scene it lands in, and
 * its options judged (keep.mjs). */
import { messy } from '../../../browser-test/gen-fixtures.mjs';
import { base, clip, PARTS, put } from './piece.mjs';
import { experience, judge } from './keep.mjs';
import { buildPath } from './paths.mjs';
import { relations } from './relations.mjs';
import { copySet, ROLE, sceneAt, scaleOf } from './scene.mjs';

const clipAt = (set, i, slot) => set.tracks[i].clips.find((c) => c.slot === slot);
/** Onsets in 16ths: what the collapse measure compares across seeds. */
export const rhythmOf = (ns) => [...new Set(ns.map((n) => Math.round(n.tick / 24)))].sort((a, b) => a - b);
/** Rhythm likeness, 0..1: shared onsets over all onsets (a re-harmonised
 *  variation keeps its rhythm and shares no note cells). */
export function rhythmLike(a, b) {
    const A = new Set(rhythmOf(a)), B = new Set(rhythmOf(b));
    const both = [...A].filter((x) => B.has(x)).length;
    return both / Math.max(1, A.size + B.size - both);
}

/** Scene A: New Clip drums, bass, chords, lead, the seed's way. */
export const sceneA = (G, seed) => buildPath(G, seed, [0, 1, 2, 3]).set;

/** Copies every track's clip at `from` into each of `slots`, but track `skip`'s. */
function spread(set, from, slots, skip = -1) {
    for (const t of set.tracks) {
        const c = clipAt(set, t.index, from);
        if (c && t.index !== skip) for (const s of slots) put(set.tracks, t.index, s, { ...c, slot: s, notes: c.notes.map((n) => ({ ...n })) });
    }
}

/** One request on track `i` into slot `to`; the user keeps option `k`, in
 *  turn over the options (piece.mjs's rotation). */
function request(G, set, i, to, len, input, bands, k) {
    const r = G.generateAll({ ...base(set, PARTS[i].drum), target: { track: i, slot: to }, len, ...input }, 6);
    const pick = r.picks.length ? r.picks[k % r.picks.length] : null;
    const test = judge(bands, ROLE[i], (ns) => sceneAt(set, to, scaleOf(set), { track: i, clip: clip(i, to, len, ns) }));
    const exp = experience(G, r, pick, test);
    if (pick) put(set.tracks, i, to, clip(i, to, len, pick.notes));
    return { pick, exp };
}

const vary = (G, set, i, from, to, bands, k) => request(G, set, i, to, clipAt(set, i, from).len,
    { task: 'variation', source: { track: i, slot: from } }, bands, k);

/** Scene B from A by Variation in `order` (track indices). */
export function sceneB(G, A, seed, order, bands) {
    const set = copySet(A), scale = scaleOf(set);
    const steps = [], exps = [], picks = {}, kept = {};
    for (const i of order) {
        const { pick, exp } = vary(G, set, i, 0, 1, bands, seed + i);
        picks[ROLE[i]] = pick?.preset.id ?? 'NONE';
        exps.push({ task: 'B', role: ROLE[i], at: steps.length, ...exp });
        if (pick) kept[ROLE[i]] = { notes: 1 - G.difference(pick.notes, clipAt(set, i, 0).notes), rhythm: rhythmLike(pick.notes, clipAt(set, i, 0).notes), preset: pick.preset.id };
        steps.push(relations(sceneAt(set, 1, scale)));
    }
    return { seed, order: order.map((i) => ROLE[i]), picks, scene: sceneAt(set, 1, scale), steps, exps, kept, set };
}

/** Track `i` varied `D` times in a row, the others as in A. */
export function depthChain(G, A, seed, i, bands, D = 5) {
    const set = copySet(A), scale = scaleOf(set);
    spread(set, 0, Array.from({ length: D }, (_, d) => d + 1), i);
    const a0 = clipAt(set, i, 0).notes;
    const rows = [{ depth: 0, m: relations(sceneAt(set, 0, scale)), identity: 1, rhythm: rhythmOf(a0) }];
    for (let d = 0; d < D; d++) {
        const prev = clipAt(set, i, d).notes;
        const { pick, exp } = vary(G, set, i, d, d + 1, bands, seed + i + d);
        if (!pick) break;
        rows.push({ depth: d + 1, m: relations(sceneAt(set, d + 1, scale)), exp, preset: pick.preset.id,
            identity: 1 - G.difference(pick.notes, a0), rhythmId: rhythmLike(pick.notes, a0), step: G.difference(pick.notes, prev), rhythm: rhythmOf(pick.notes) });
    }
    return { seed, role: ROLE[i], rows };
}

/** Every track of A Smart Doubled into slot 2, track by track. */
export function doubled(G, A, seed, bands) {
    const set = copySet(A), scale = scaleOf(set);
    spread(set, 0, [2]);
    const exps = [], steps = [];
    for (const i of [0, 1, 2, 3]) {
        const c = clipAt(set, i, 2);
        if (!c || c.len * 2 > 256) continue;
        const { exp } = request(G, set, i, 2, c.len * 2, { task: 'double', source: null }, bands, seed + i + 1);
        exps.push({ task: 'double', role: ROLE[i], at: steps.length, ...exp });
        steps.push(relations(sceneAt(set, 2, scale)));
    }
    return { seed, exps, steps, m: steps[steps.length - 1], set };
}

/** Track `i` of A played loosely into slot 3 and Smart Quantized; option 1 is
 *  the tightest by design, the one a user tries first. */
export function quantized(G, A, seed, i, bands) {
    const set = copySet(A), scale = scaleOf(set);
    spread(set, 0, [3]);
    const clean = clipAt(set, i, 0);
    const loose = messy(clean.notes);
    put(set.tracks, i, 3, { ...clean, slot: 3, notes: loose });
    const { pick, exp } = request(G, set, i, 3, clean.len, { task: 'quantize', source: null }, bands, 0);
    return { seed, role: ROLE[i], exp, m: relations(sceneAt(set, 3, scale)),
        loose: 1 - G.difference(loose, clean.notes), back: pick ? 1 - G.difference(pick.notes, clean.notes) : null };
}
