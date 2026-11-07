/* The scene's chords as they are heard, a 16th at a time
 * (plans/2026-11-06-bass-over-chords-evaluation.md). The half-bar reading
 * (context.ts) smears a comp that pushes its chords an eighth early, so a
 * part reading it changed half a bar late or early; context.ts hangs this
 * reading on the scene's progression (`Prog.fine`) and chordAt reads it, for
 * every task. A chord's bass here is its root: the parts read are the ones
 * that strike chords, and a keyboard's lowest voice is its inversion, not a
 * bass note (the user's sets and the public parts put a bass on it 0-4% of
 * the time). A lead's passing notes over a held pad are not harmony. */

import { roleOf } from '../../ai/role.js';
import { detectChord } from '../theory/chords.js';
import { sameChord } from '../theory/pc.js';
import { type Chord, type GenInput, type Key, TPS } from '../types.js';
import type { Prog } from './context.js';
import { heardPcs, type Segment, sceneTicks, soundingSegments } from './sounding.js';

const CHORDAL = new Set(['pad', 'stabs', 'drone']);

/** Per 16th of master time in scene `slot` (the target's by default),
 *  looping; null when no other part plays chords there. */
export function heardOf(input: GenInput, key: Key, slot = input.target.slot): Prog | null {
    const clips = input.tracks.filter((t) => !t.drum && t.index !== input.target.track)
        .flatMap((t) => t.clips.filter((c) => c.slot === slot && c.notes.length > 0))
        .filter((c) => CHORDAL.has(roleOf(c.notes, c.len, false)?.kind ?? ''));
    if (!clips.length) return null;
    const segs = soundingSegments(clips, sceneTicks(clips), TPS);
    /* A held chord is the same notes 16th after 16th: read each set once. */
    const seen = new Map<string, Chord | null>();
    const raw = segs.map((s) => {
        const id = s.w.map((w) => (w > 0 ? 1 : 0)).join('') + s.bass;
        if (!seen.has(id)) {
            const c = detectChord(s, key);
            seen.set(id, c && { ...c, bass: c.root });
        }
        return seen.get(id)!;
    });
    /* A rest keeps the chord before it ringing in the ear; the loop's head
     * takes the chord its tail ends on. */
    let last: Chord | null = [...raw].reverse().find((c) => c) ?? null;
    const held = raw.map((c) => (last = c ?? last));
    /* A single 16th between two of the same chord is a strum or a slip. */
    const fine = held.map((c, i) => (i > 0 && i + 1 < held.length && sameChord(held[i - 1], held[i + 1]) && !sameChord(c, held[i - 1]) ? held[i - 1] : c));
    return fine.some((c) => c) ? Object.assign(fine, { unit: TPS }) : null;
}

/** The source scene's chords as a part that strikes chords plays them: a
 *  half-bar where its own notes are the last one's keeps the last chord.
 *  Read with the bass, a walk under a held Fm (F-Eb-D) made the bar's second
 *  half Dm7b5, and every HARMONY plan built from that changed chord each
 *  half-bar (chains bench, scene B: 1.25-2 changes a bar over a source's 1). */
export function heldByPart(prog: Prog, own: Segment[]): Prog {
    const pcs = own.map((s) => heardPcs(s).join());
    const out: Prog = [];
    prog.forEach((c, i) => out.push(i > 0 && pcs[i] && pcs[i] === pcs[i - 1] ? out[i - 1] : c));
    return out;
}
