/* A Set's scene as the paths bench measures it (plans/2026-11-07-generation-paths-bench.md):
 * tracks 0-3 are drums, bass, chords and lead; each clip in a slot looped to
 * the longest there, in beats, as relations.mjs reads a scene. */
import { drumRoles } from './relations.mjs';

export const ROLE = ['drums', 'bass', 'chords', 'lead'];
export const PC = { C: 0, 'C#': 1, D: 2, Eb: 3, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, 'G#': 8, A: 9, Bb: 10, 'A#': 10, B: 11 };
/** Key names as the Set's key setting spells them (theory/key.ts keyHint). */
export const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10, 11] };

const TPS = 24;
const beats = (ns) => ns.map((n) => [n.tick / 96, n.gate / 96, n.pitch, n.vel]);

function looped(c, steps) {
    if (!c) return [];
    const span = c.len * TPS, out = [];
    for (let off = 0; off < steps * TPS; off += span) {
        for (const n of c.notes) if (n.tick < span && n.tick + off < steps * TPS) out.push({ ...n, tick: n.tick + off });
    }
    return out;
}

/** The scene `slot` sounds, `swap` ({ track, clip }) standing in for one track's clip. */
export function sceneAt(set, slot, scale, swap) {
    const clips = set.tracks.map((t) => (swap && t.index === swap.track ? swap.clip : t.clips.find((c) => c.slot === slot && c.notes.length)));
    const steps = Math.max(16, ...clips.filter(Boolean).map((c) => c.len));
    const ns = clips.map((c) => beats(looped(c, steps)));
    return { len: steps / 4, scale, lens: clips.map((c) => c?.len ?? 0), bass: ns[1], chords: [ns[2]], lead: ns[3], ...drumRoles(ns[0]) };
}

/** The Set's scale in pitch classes (minor with its raised 7th). */
export const scaleOf = (set) => SCALE[set.mode].map((x) => (x + PC[set.root]) % 12);

export const copySet = (set) => ({ ...set, tracks: set.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, notes: c.notes.map((n) => ({ ...n })) })) })) });
