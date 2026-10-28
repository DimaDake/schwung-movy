/* Progressions longer than their loop (user, 2026-10-28: on longer clips,
 * "make chord progressions more than 4 unique chords"): a phrase answered
 * by itself developed, each answer by another move (theory/moves.ts), the
 * way a song's verse goes somewhere new on its second and third time. */

import { sameChord } from './pc.js';
import { harmonicMoves } from './moves.js';
import type { Chord, Key } from '../types.js';

type Prog = (Chord | null)[];

/** The shortest period a progression repeats with (its length if none). */
export function periodOf(p: Prog): number {
    for (let q = 1; q < p.length; q++) {
        if (p.length % q === 0 && p.every((c, i) => sameChord(c, p[i % q]))) return q;
    }
    return p.length;
}

/** `blocks` phrases: the first `base` as is, each next one a different
 *  development of it, closest first (`from` moves along the list); `ok`
 *  says which developments the scene allows. Fewer moves than blocks:
 *  the list goes round. */
export function journey(base: Prog, blocks: number, k: Key, wild: boolean, from = 0, ok: (p: Prog) => boolean = () => true): Prog {
    const moves = harmonicMoves(base, k, wild).filter((m) => m.name !== 'SAME' && ok(m.chords));
    const out: Prog = [...base];
    for (let b = 1; b < blocks; b++) out.push(...(moves.length ? moves[(from + b - 1) % moves.length].chords : base));
    return out;
}
