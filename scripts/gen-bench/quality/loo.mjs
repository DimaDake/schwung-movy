/* Leave one out (plans/2026-11-07-generation-paths-bench.md): a real scene
 * (refs.json: the user's scene rows and public windows) with one part taken
 * away, and New Clip asked for it there. The generators then work over music
 * they did not write, the common case (a user plays a part, generates the
 * rest), and each option is judged beside the real part in the same place. */
import { base, clip, KIT } from './piece.mjs';
import { experience, judge, judgeRole, SLACK } from './keep.mjs';
import { ROLE_PRESETS } from './paths.mjs';
import { relations } from './relations.mjs';
import { copySet, ROLE, sceneAt, scaleOf, SHARPS } from './scene.mjs';

const toNotes = (ns) => ns.map((n) => ({ tick: Math.round(n[0] * 96), gate: Math.max(6, Math.round(n[1] * 96)), pitch: n[2], vel: n[3] }));

/** A real scene as a Set: tracks 0-3 in slot 0, its key found from its notes. */
export function refSet(G, ref) {
    const steps = Math.round(ref.len * 4);
    if (steps % 16 || steps > 256) return null;
    const parts = [[...ref.kick, ...ref.snare, ...ref.hats, ...ref.perc], ref.bass, ref.chords.flat(), ref.lead];
    const w = Array(12).fill(0);
    for (const n of parts.slice(1).flat()) w[n[2] % 12] += n[1];
    const k = G.findKey(w);
    const set = { root: SHARPS[k.tonic], mode: k.minor ? 'minor' : 'major', bpm: 120,
        tracks: parts.map((ns, i) => ({ index: i, name: ROLE[i], module: i ? 'obxd' : 'drumrack', drum: i === 0, padNames: null,
            clips: ns.length ? [clip(i, 0, steps, toNotes(ns.filter((n) => n[0] * 4 < steps)))] : [] })) };
    return { set, steps, kit: [...new Set(parts[0].map((n) => n[2]))] };
}

/** Each part of `ref` taken away and New Clip asked for it. */
export function leaveOneOut(G, ref, bands) {
    const rs = refSet(G, ref);
    if (!rs) return [];
    const { set, steps, kit } = rs;
    const scene = (s, swap) => ({ ...sceneAt(s, 0, scaleOf(s), swap), kind: ref.kind });
    const real = relations(scene(set));
    const out = [];
    for (const i of [0, 1, 2, 3]) {
        if (!set.tracks[i].clips.length) continue;
        const without = copySet(set);
        without.tracks[i].clips = [];
        G.forgetOptions();
        const drum = i === 0;
        const r = G.generateAll({ ...base(without, drum), kit: drum ? (kit.length ? kit : KIT) : [], task: 'create', target: { track: i, slot: 0 },
            source: null, len: steps, nonce: G.hash(ref.src + ref.len + i) });
        const ids = ROLE_PRESETS[ROLE[i]];
        const options = ids ? r.picks.filter((p) => ids.includes(p.preset.id)) : r.picks;
        /* As good as the real part: only what the real scene passes counts
         * (a public window's merged comping already breaks some of the
         * bands drawn from the user's scenes). */
        const realJ = judgeRole(real, bands, ROLE[i]);
        const abs = judge(bands, ROLE[i], (ns) => scene(without, { track: i, clip: clip(i, 0, steps, ns) }));
        const test = (ns) => { const j = abs(ns); const bad = j.bad.filter((b) => !realJ.bad.includes(b)); return { ...j, ok: bad.length <= SLACK, bad, abs: j.ok }; };
        out.push({ src: ref.src, kind: ref.kind, role: ROLE[i], real: realJ,
            options: options.map((p) => ({ preset: p.preset.id, ...test(p.notes) })), exp: { task: 'loo', role: ROLE[i], ...experience(G, r, options[0], test, options) } });
    }
    return out;
}
