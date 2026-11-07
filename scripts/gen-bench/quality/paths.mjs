/* Generation paths (plans/2026-11-07-generation-paths-bench.md): a scripted
 * user builds one scene with New Clip on drums, bass, chords and lead, in
 * every one of the 24 orders, so each generator meets each other part both
 * before and after it. Each step keeps the take the user would (piece.mjs's
 * per-role preset choice). The scene is then measured by relations.mjs. */
import { base, clip, KEYS, PARTS, put } from './piece.mjs';
import { drumRoles, relations } from './relations.mjs';

const ROLE = ['drums', 'bass', 'chords', 'lead'];
const PC = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10, 11] };
const LENS = [64, 128];

export function orders(xs = [0, 1, 2, 3]) {
    if (xs.length <= 1) return [xs];
    return xs.flatMap((x) => orders(xs.filter((y) => y !== x)).map((r) => [x, ...r]));
}

const beats = (ns) => ns.map((n) => [n.tick / 96, n.gate / 96, n.pitch, n.vel]);

/** One scene built in `order` (track indices). */
export function buildPath(G, seed, order) {
    const [root, mode] = KEYS[seed % KEYS.length];
    const len = LENS[seed % LENS.length];
    const set = { root, mode, bpm: 120 + (seed % 4) * 4,
        tracks: PARTS.map((p) => ({ index: p.index, name: p.name, module: p.drum ? 'drumrack' : 'obxd', drum: p.drum, padNames: null, clips: [] })) };
    const picks = {};
    const notes = (i) => set.tracks[i].clips.find((c) => c.slot === 0)?.notes ?? [];
    const scale = SCALE[mode].map((x) => (x + PC[root]) % 12);
    const sceneOf = () => ({ len: len / 4, scale, bass: beats(notes(1)), chords: [beats(notes(2))], lead: beats(notes(3)), ...drumRoles(beats(notes(0))) });
    /* What the user hears after each step, not only the finished scene. */
    const steps = [];
    for (const i of order) {
        const p = PARTS[i];
        G.forgetOptions();
        /* The nonce follows the seed and the track, not the order, so the
         * only thing that differs between two orders is what was already there. */
        const r = G.generateAll({ ...base(set, p.drum), task: 'create', target: { track: i, slot: 0 }, source: null, len, nonce: seed * 7 + i });
        const want = [...p.want.slice(seed % p.want.length), ...p.want];
        const pick = want.map((id) => r.picks.find((x) => x.preset.id === id)).find(Boolean) ?? r.picks[0];
        picks[ROLE[i]] = pick?.preset.id ?? 'NONE';
        if (pick) put(set.tracks, i, 0, clip(i, 0, len, pick.notes));
        if (steps.length < order.length - 1) steps.push(relations(sceneOf()));
    }
    const scene = sceneOf();
    return { seed, order: order.map((i) => ROLE[i]), picks, set, scene, steps, len, bpm: set.bpm, key: `${root} ${mode}` };
}

/** Every order at every seed. */
export function runPaths(G, seeds = 6) {
    const out = [];
    for (let s = 0; s < seeds; s++) for (const o of orders()) out.push(buildPath(G, s, o));
    return out;
}
