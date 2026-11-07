/* Generation paths (plans/2026-11-07-generation-paths-bench.md): a scripted
 * user builds one scene with New Clip on drums, bass, chords and lead, in
 * every one of the 24 orders, so each generator meets each other part both
 * before and after it. Each step keeps the take the user would (piece.mjs's
 * per-role preset choice). The scene is then measured by relations.mjs; with
 * `bands`, each step's options are judged too (keep.mjs). */
import { base, clip, KEYS, PARTS, put } from './piece.mjs';
import { experience, judge } from './keep.mjs';
import { relations } from './relations.mjs';
import { ROLE, sceneAt, scaleOf } from './scene.mjs';

export const LENS = [64, 128];

/* The New Clip options a user would take for each part: a bass track is not
 * judged on the pad New Clip also offers it, nor a kit on one pad's part. */
export const ROLE_PRESETS = { drums: ['n-drum-map', 'n-euclid-kit', 'n-broken', 'n-groove'], bass: ['n-bass', 'n-walk', 'n-pulse'], chords: ['n-chords', 'n-pad', 'n-stabs'],
    lead: ['n-melody', 'n-riff', 'n-arp', 'n-counter', 'n-looper'] };

export function orders(xs = [0, 1, 2, 3]) {
    if (xs.length <= 1) return [xs];
    return xs.flatMap((x) => orders(xs.filter((y) => y !== x)).map((r) => [x, ...r]));
}

export const emptySet = (seed) => {
    const [root, mode] = KEYS[seed % KEYS.length];
    return { root, mode, bpm: 120 + (seed % 4) * 4,
        tracks: PARTS.map((p) => ({ index: p.index, name: p.name, module: p.drum ? 'drumrack' : 'obxd', drum: p.drum, padNames: null, clips: [] })) };
};

/** New Clip on track `i` at `slot`; the take the user keeps, its experience row with `bands`, and the request's result. */
export function newClip(G, set, i, slot, len, seed, bands) {
    const p = PARTS[i];
    G.forgetOptions();
    /* The nonce follows the seed and the track, not the order, so the only
     * thing that differs between two orders is what was already there. */
    const r = G.generateAll({ ...base(set, p.drum), task: 'create', target: { track: i, slot }, source: null, len, nonce: seed * 7 + i });
    const want = [...p.want.slice(seed % p.want.length), ...p.want];
    const pick = want.map((id) => r.picks.find((x) => x.preset.id === id)).find(Boolean) ?? r.picks[0];
    const ids = ROLE_PRESETS[ROLE[i]];
    const exp = bands ? experience(G, r, pick, judge(bands, ROLE[i], (ns) => sceneAt(set, slot, scaleOf(set), { track: i, clip: clip(i, slot, len, ns) })),
        ids ? r.picks.filter((x) => ids.includes(x.preset.id)) : r.picks) : null;
    return { pick, exp, r };
}

/** One scene built in `order` (track indices). */
export function buildPath(G, seed, order, bands) {
    const set = emptySet(seed);
    const len = LENS[seed % LENS.length];
    const picks = {}, steps = [], exps = [];
    for (const i of order) {
        const { pick, exp } = newClip(G, set, i, 0, len, seed, bands);
        picks[ROLE[i]] = pick?.preset.id ?? 'NONE';
        if (pick) put(set.tracks, i, 0, clip(i, 0, len, pick.notes));
        if (exp) exps.push({ role: ROLE[i], at: steps.length, ...exp });
        /* What the user hears after each step, not only the finished scene. */
        if (steps.length < order.length - 1) steps.push(relations(sceneAt(set, 0, scaleOf(set))));
    }
    return { seed, order: order.map((i) => ROLE[i]), picks, set, scene: sceneAt(set, 0, scaleOf(set)), steps, exps, len, bpm: set.bpm, key: `${set.root} ${set.mode}` };
}

/** Every order at every seed. */
export function runPaths(G, seeds = 6, bands) {
    const out = [];
    for (let s = 0; s < seeds; s++) for (const o of orders()) out.push(buildPath(G, s, o, bands));
    return out;
}
