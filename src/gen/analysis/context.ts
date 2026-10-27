/* Everything a generator knows about one request, read once from the Set:
 * the part it grows from, the key, the harmony the source sounded in, who owns
 * the target scene's harmony (design §2), the groove, the kit, and the clips
 * an option must not repeat. */

import { roleOf } from '../../ai/role.js';
import { hash } from '../rng.js';
import { type AiClip, type Chord, type Freedom, type GenInput, HALF, type HarmonyPlan, type Key, type Note,
    type Role, TPS } from '../types.js';
import { chordsOf } from '../theory/chords.js';
import { findKey, keyHint } from '../theory/key.js';
import { type Groove, grooveOf } from './groove.js';
import { type Kit, kitOf } from './kit.js';
import { heardPcs, profile, sceneTicks, soundingSegments } from './sounding.js';

export interface GenCtx {
    input: GenInput;
    task: GenInput['task'];
    drum: boolean;
    len: number;                    // target length, steps
    end: number;                    // target length, ticks
    k: number;                      // master ticks per clip tick
    src: Note[];
    role: Role | null;
    key: Key;
    srcChords: (Chord | null)[];    // per master half-bar of the source scene
    freedom: Freedom;
    pinned: number[][];             // per master half-bar: pitch classes others hold in the target scene
    pinnedBass: number[];           // per master half-bar: the lowest of them (-1: none)
    fixedChords: (Chord | null)[];  // the target scene's chords where others set them
    groove: Groove;
    kit: Kit | null;
    loops: Note[][];
    lo: number;
    hi: number;
    mid: number;
    seed: number;
    plans: HarmonyPlan[];           // filled by plan.ts
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 60; };

function clipsAt(input: GenInput, slot: number, keep: (track: number) => boolean): AiClip[] {
    return input.tracks.filter((t) => keep(t.index)).flatMap((t) => t.clips.filter((c) => c.slot === slot && c.notes.length > 0));
}

export function buildCtx(input: GenInput): GenCtx {
    const me = input.tracks.find((t) => t.index === input.target.track);
    const melodic = (i: number) => !(input.tracks.find((t) => t.index === i)?.drum ?? true);
    const srcSlot = input.task === 'variation' ? input.source?.slot ?? -1 : input.target.slot;
    const srcClip = me?.clips.find((c) => c.slot === srcSlot) ?? null;
    const end = input.len * TPS;
    /* The source as the target will hold it: a shorter clip looped, a longer
     * one cut, so every generator and the role check see one length. */
    const src = !srcClip ? [] : input.task === 'variation' ? looped(srcClip.notes, srcClip.len * TPS, end)
        : srcClip.notes.map((n) => ({ ...n }));
    const k = input.scale[1] / input.scale[0];

    /* The source scene sounds with this track in it; the target scene's
     * harmony is what the OTHER tracks already play there. */
    const srcScene = clipsAt(input, srcSlot, melodic);
    const others = clipsAt(input, input.target.slot, (i) => i !== input.target.track && melodic(i));
    const srcSegs = soundingSegments(srcScene);
    const otherSegs = others.length ? soundingSegments(others, sceneTicks(others)) : [];
    const w = profile([...srcSegs, ...otherSegs]);
    const key = findKey(w, keyHint(input.root, input.mode));

    const pinned = otherSegs.map((s) => heardPcs(s));
    const filled = pinned.filter((p) => p.length > 0);
    const chordful = filled.filter((p) => p.length >= 3).length;
    const freedom: Freedom = !filled.length ? 'free' : chordful * 2 >= filled.length ? 'locked' : 'partial';

    /* Smart Quantize fits the clip to its own scene: the others' chords when
     * they spell them, else everyone's, the clip included. */
    const quantChords = freedom === 'locked' ? chordsOf(otherSegs, key) : chordsOf(soundingSegments(srcScene), key);
    const pitches = src.map((n) => n.pitch);
    const allOthers = input.tracks.filter((t) => t.index !== input.target.track)
        .flatMap((t) => t.clips.filter((c) => c.slot === input.target.slot).flatMap((c) => c.notes));

    return {
        input, task: input.task, drum: input.drum, len: input.len, end, k, src,
        role: roleOf(src, input.len, input.drum),
        key,
        srcChords: input.task === 'quantize' ? quantChords : chordsOf(srcSegs, key),
        freedom: input.task === 'quantize' ? 'locked' : freedom,
        pinned,
        pinnedBass: otherSegs.map((s) => (s.bass >= 0 ? s.bass % 12 : -1)),
        fixedChords: input.task === 'quantize' ? quantChords : freedom === 'locked' ? chordsOf(otherSegs, key) : [],
        groove: grooveOf(src, allOthers.filter((n) => n.tick < end)),
        kit: input.drum ? kitOf(input.kit.length ? input.kit : [...new Set(src.map((n) => n.pitch))], me?.padNames ?? null,
            (me?.clips ?? []).flatMap((c) => c.notes)) : null,
        loops: input.task === 'variation'
            ? (me?.clips ?? []).filter((c) => c.slot !== input.target.slot && c.notes.length > 0).map((c) => c.notes) : [],
        lo: pitches.length ? Math.min(...pitches) : 48,
        hi: pitches.length ? Math.max(...pitches) : 72,
        mid: median(pitches),
        seed: hash(src.map((n) => `${n.tick}.${n.pitch}`).join(',') + '|' + input.target.slot + '|' + input.task),
        plans: [],
    };
}

export function looped(notes: Note[], span: number, end: number): Note[] {
    const out: Note[] = [];
    const step = Math.max(1, span);
    for (let off = 0; off < end; off += step) {
        for (const n of notes) {
            if (n.tick >= span) continue;
            const t = n.tick + off;
            if (t < end) out.push({ ...n, tick: t, gate: Math.min(n.gate, end - t) });
        }
    }
    return out;
}

/** The chord under a clip tick in a per-master-half-bar list (looping). */
export function chordAt(chords: (Chord | null)[], tick: number, k: number): Chord | null {
    if (!chords.length) return null;
    const i = Math.floor((tick * k) / HALF);
    return chords[((i % chords.length) + chords.length) % chords.length];
}

/** Half-bars of master time the target clip spans. */
export const targetHalves = (ctx: GenCtx): number => Math.max(1, Math.ceil((ctx.end * ctx.k) / HALF));
