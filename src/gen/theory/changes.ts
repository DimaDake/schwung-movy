/* CHANGES: the harmonic rhythm of a planned progression (user, 2026-10-27:
 * "chords are always 2 chords if original was 2 chords"). A B section may
 * move its chords more often than its A: an approach chord before each change
 * (the next chord's dominant, or a neighbour that leads into it), then a
 * substitute inside a long chord. Written per beat, so the approach can be the
 * last beat before the change. */

import type { Prog } from '../analysis/context.js';
import type { Chord, Key } from '../types.js';
import { BEAT } from '../types.js';
import { connection } from './connect.js';
import { pc, sameChord } from './pc.js';
import { degreeOf, diatonic } from './roman.js';

export const CHANGES = ['AS PLAYED', 'APPROACH', 'APPROACH + BEAT', 'EVERY HALF BAR'] as const;

const SUB_MAJOR = [5, 3, 0, 1, 6, 3, 4];
const SUB_MINOR = [2, 3, 0, 5, 6, 3, 4];

/** The chord that leads best into `next`: its diatonic dominant (a fifth
 *  above), else the diatonic chord a step either side; never diminished, never
 *  the chord it leads to, never one that clashes with what is pinned. */
export function approachTo(next: Chord, key: Key, ok: (c: Chord) => boolean, seventh: boolean): Chord | null {
    const d = degreeOf(next, key);
    if (d < 0) return null;
    const cands = [d + 4, d + 1, d - 1, d + 3].map((x) => diatonic(key, ((x % 7) + 7) % 7, seventh))
        .filter((c) => c.quality !== 'dim' && c.quality !== 'm7b5' && !sameChord(c, next) && ok(c));
    if (!cands.length) return null;
    return cands.sort((a, b) => connection(b, next) - connection(a, next))[0];
}

function substitute(c: Chord, key: Key, seventh: boolean): Chord | null {
    const d = degreeOf(c, key);
    if (d < 0) return null;
    const s = diatonic(key, (key.minor ? SUB_MINOR : SUB_MAJOR)[d], seventh);
    return s.quality === 'dim' || s.quality === 'm7b5' || sameChord(s, c) ? null : s;
}

/** Half-bar chords → beat chords at a CHANGES level (0 = as played). `ok`
 *  says whether a chord may sound at a given beat (pinned notes). */
export function withChanges(halves: (Chord | null)[], level: number, key: Key, ok: (c: Chord, beat: number) => boolean): Prog {
    const beats: Prog = halves.flatMap((c) => [c, c]);
    beats.unit = BEAT;
    if (level <= 0 || !halves.some((c) => c)) return beats;
    const seventh = halves.some((c) => !!c && c.pcs.length > 3);
    const n = beats.length;
    /* Spans of one chord, in beats; the last one leads back to the first. */
    const spans: [number, number][] = [];
    for (let i = 0; i < n;) {
        let j = i;
        while (j + 1 < n && sameChord(beats[j + 1], beats[i])) j++;
        spans.push([i, j]);
        i = j + 1;
    }
    const out: Prog = [...beats];
    out.unit = BEAT;
    spans.forEach(([a, b], si) => {
        const cur = beats[a];
        const next = beats[spans[(si + 1) % spans.length][0]];
        if (!cur || !next || sameChord(cur, next) && spans.length > 1) return;
        const len = b - a + 1;
        /* APPROACH: the last half-bar of a chord of a bar or more. With +BEAT
         * a shorter chord gets its last beat too. */
        const from = len >= 4 ? b - 1 : level >= 2 && len >= 2 ? b : -1;
        if (from >= 0) {
            const ap = approachTo(next, key, (c) => ok(c, from) && ok(c, b), seventh);
            if (ap) for (let i = from; i <= b; i++) out[i] = ap;
        }
        /* EVERY HALF BAR: a long chord's second half-bar takes its substitute. */
        if (level >= 3 && len >= 6) {
            const s = substitute(cur, key, seventh);
            if (s && ok(s, a + 2) && ok(s, a + 3)) { out[a + 2] = s; out[a + 3] = s; }
        }
    });
    return out;
}

/** Whether a chord holds every pinned pitch class as a chord or colour tone. */
export const holds = (c: Chord, pins: number[], colours: (c: Chord) => number[]): boolean =>
    pins.every((p) => c.pcs.includes(pc(p)) || colours(c).includes(pc(p)));
