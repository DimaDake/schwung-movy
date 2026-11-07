/* Layered scenes for the layers bench (layers.mjs): scene A (New Clip's four
 * parts) with a fifth part New Clip adds on track 4 (melodic) or 5 (drums),
 * and real scenes with one of two chord parts or lines taken away and New
 * Clip asked for it there (as good as the real one?). */
import { base, clip, KIT, put } from './piece.mjs';
import { sceneA } from './chains.mjs';
import { copySet, SHARPS } from './scene.mjs';

const TPS = 24;
const beats = (ns) => ns.map((n) => [n.tick / 96, n.gate / 96, n.pitch, n.vel]);
const toNotes = (ns) => ns.map((n) => ({ tick: Math.round(n[0] * 96), gate: Math.max(6, Math.round(n[1] * 96)), pitch: n[2], vel: n[3] }));
export const CHORD_IDS = ['n-chords', 'n-pad', 'n-stabs'];
export const LINE_IDS = ['n-melody', 'n-riff', 'n-counter', 'n-harmonize', 'n-follow', 'n-arp', 'n-hold', 'n-looper'];

function looped(c, steps) {
    if (!c) return [];
    const out = [];
    for (let off = 0; off < steps * TPS; off += c.len * TPS) for (const n of c.notes) if (n.tick < c.len * TPS && n.tick + off < steps * TPS) out.push({ ...n, tick: n.tick + off });
    return out;
}

/** A Set's slot as a layered scene; `as` says what each track is. */
export function layerAt(set, slot, as) {
    const clips = set.tracks.map((t) => t.clips.find((c) => c.slot === slot && c.notes.length));
    const steps = Math.max(16, ...clips.filter(Boolean).map((c) => c.len));
    const part = (i) => beats(looped(clips[i], steps));
    const of = (k) => set.tracks.map((t, i) => i).filter((i) => clips[i] && as[i] === k);
    return { len: steps / 4, drums: of('drums').map(part), bass: of('bass').flatMap(part), chords: of('chords').map(part), lines: of('line').map(part),
        loops: { bass: of('bass').map((i) => clips[i].len / 4)[0] ?? 0, chords: of('chords').map((i) => clips[i].len / 4), lines: of('line').map((i) => clips[i].len / 4) } };
}

/** Scene A plus track 4 (melodic) and 5 (drums), empty. */
export function sixTracks(G, seed) {
    const set = copySet(sceneA(G, seed));
    set.tracks.push({ index: 4, name: 'Extra', module: 'obxd', drum: false, padNames: null, clips: [] },
        { index: 5, name: 'Perc', module: 'drumrack', drum: true, padNames: null, clips: [] });
    return set;
}

export const AS = ['drums', 'bass', 'chords', 'line'];

/** New Clip on track `i` of `set` (slot 0), keeping preset `id`'s option, `len` steps. */
export function addPart(G, set, i, id, len, nonce) {
    G.forgetOptions();
    const drum = set.tracks[i].drum;
    const r = G.generateAll({ ...base(set, drum), task: 'create', target: { track: i, slot: 0 }, source: null, len, nonce });
    const pick = r.picks.find((p) => p.preset.id === id);
    if (pick) put(set.tracks, i, 0, clip(i, 0, len, pick.notes));
    return pick;
}

/** A real scene as a Set of one track per part, its key from its notes. */
export function realSet(G, ref) {
    const steps = Math.round(ref.len * 4);
    if (steps % 16 || steps > 256) return null;
    const parts = [...(ref.drumParts ?? []).map((ns) => ['drums', ns]), ['bass', ref.bass], ...ref.chords.map((ns) => ['chords', ns]), ...(ref.lines ?? []).map((ns) => ['line', ns])]
        .filter(([, ns]) => ns.length >= 3);
    const w = Array(12).fill(0);
    for (const [k, ns] of parts) if (k !== 'drums') for (const n of ns) w[n[2] % 12] += n[1];
    const key = G.findKey(w);
    return { steps, as: parts.map(([k]) => k), set: { root: SHARPS[key.tonic], mode: key.minor ? 'minor' : 'major', bpm: 120,
        tracks: parts.map(([k, ns], i) => ({ index: i, name: k, module: k === 'drums' ? 'drumrack' : 'obxd', drum: k === 'drums', padNames: null,
            clips: [clip(i, 0, steps, toNotes(ns.filter((n) => n[0] * 4 < steps)))] })) } };
}

/** Track `i` of a real Set taken away and New Clip asked for it: each option of `ids` there. */
export function regenerate(G, real, i, ids, nonce) {
    const without = copySet(real.set);
    without.tracks[i].clips = [];
    G.forgetOptions();
    const drum = without.tracks[i].drum;
    const r = G.generateAll({ ...base(without, drum), kit: drum ? KIT : [], task: 'create', target: { track: i, slot: 0 }, source: null, len: real.steps, nonce });
    return r.picks.filter((p) => ids.includes(p.preset.id)).map((p) => {
        const s = copySet(without);
        put(s.tracks, i, 0, clip(i, 0, real.steps, p.notes));
        return { id: p.preset.id, scene: layerAt(s, 0, real.as) };
    });
}
