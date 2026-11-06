/* The scene's chords as they are heard, a 16th at a time, for a bass under
 * another track's chords (plans/2026-11-06-bass-over-chords-evaluation.md).
 * The half-bar reading (context.ts) smears a comp that pushes its chords an
 * eighth early, so a bass reading it changed half a bar late or early; and
 * its `bass` is the keyboard's lowest voice, which a bass line ignores (the
 * user's sets and the public parts put a bass on a voicing's inversion 0-4%
 * of the time). Only parts that strike chords count: a lead's passing notes
 * over a held pad are not harmony. */

import { roleOf } from '../../ai/role.js';
import { detectChord } from '../theory/chords.js';
import { sameChord } from '../theory/pc.js';
import { type AiClip, type Chord, TPS } from '../types.js';
import type { GenCtx, Prog } from './context.js';
import { sceneTicks, soundingSegments } from './sounding.js';

const CHORDAL = new Set(['pad', 'stabs', 'drone']);
const cache = new WeakMap<object, Prog | null>();

function chordal(ctx: GenCtx): AiClip[] {
    const { input } = ctx;
    return input.tracks.filter((t) => !t.drum && t.index !== input.target.track)
        .flatMap((t) => t.clips.filter((c) => c.slot === input.target.slot && c.notes.length > 0))
        .filter((c) => CHORDAL.has(roleOf(c.notes, c.len, false)?.kind ?? ''));
}

/** Per 16th of master time, looping; null when no other part plays chords. */
export function heardChords(ctx: GenCtx): Prog | null {
    if (ctx.freedom !== 'locked') return null;
    /* Keyed by the input: asSource and the feel copy the ctx, not the input. */
    if (cache.has(ctx.input)) return cache.get(ctx.input)!;
    const clips = chordal(ctx);
    let out: Prog | null = null;
    if (clips.length) {
        const segs = soundingSegments(clips, sceneTicks(clips), TPS);
        /* A held chord is the same notes 16th after 16th: read each set once. */
        const seen = new Map<string, Chord | null>();
        const raw = segs.map((s) => {
            const id = s.w.map((w) => (w > 0 ? 1 : 0)).join('') + s.bass;
            if (!seen.has(id)) seen.set(id, detectChord(s, ctx.key));
            return seen.get(id)!;
        });
        /* A rest keeps the chord before it ringing in the ear; the loop's
         * head takes the chord its tail ends on. */
        let last: Chord | null = [...raw].reverse().find((c) => c) ?? null;
        const held = raw.map((c) => (last = c ?? last));
        /* A single 16th between two of the same chord is a strum or a slip. */
        const fine = held.map((c, i) => (i > 0 && i + 1 < held.length && sameChord(held[i - 1], held[i + 1]) && !sameChord(c, held[i - 1]) ? held[i - 1] : c));
        if (fine.some((c) => c)) out = Object.assign(fine, { unit: TPS });
    }
    cache.set(ctx.input, out);
    return out;
}
