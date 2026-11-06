/* HARMONY's 2- and 8-chord sections drawn from a part's own chords (user,
 * 2026-11-06: Variation and Double get New Clip's sections, "from the
 * source", so a variation stays the song it varies). 2: vamps on two of the
 * source's chords, or its first two turned by a move. 8: its chords with the
 * one that leads into each next between them, the same for each of its
 * developments, and (where the source is not already playing) the source
 * answered by a development. Shared with New Clip: approached, lay. */

import type { Chord, Key } from '../types.js';
import { approachTo } from './changes.js';
import { periodOf } from './develop.js';
import { harmonicMoves } from './moves.js';
import { sameChord } from './pc.js';

type Prog = (Chord | null)[];

export const progId = (cs: Prog): string => cs.map((c) => (c ? c.root + c.quality : '-')).join();

/** A slot list laid over the clip's half-bars, `per` a slot, going round when shorter. */
export function lay(slots: Prog, n: number, per: number): Prog {
    return Array.from({ length: n }, (_, h) => slots[Math.floor(h / per) % slots.length]);
}

/** A loop with the chord that leads into each next one between them; null
 *  when no chord of it has one (outside the key). */
export function approached(cs: Chord[], key: Key): Chord[] | null {
    const seventh = cs.some((c) => c.pcs.length > 3);
    let any = false;
    const out = cs.flatMap((c, i) => {
        const a = approachTo(cs[(i + 1) % cs.length], key, () => true, seventh);
        if (a) any = true;
        return [c, a ?? c];
    });
    return any ? out : null;
}

/** A progression's chord changes, once round its loop: C C F F G G C C → C F G. */
export function changesOf(p: Prog): Chord[] {
    const out: Chord[] = [];
    for (const c of p.slice(0, periodOf(p))) if (c && !(out.length && sameChord(c, out[out.length - 1]))) out.push(c);
    if (out.length > 1 && sameChord(out[0], out[out.length - 1])) out.pop();
    return out;
}

const fourOf = (cs: Chord[]): Chord[] => Array.from({ length: 4 }, (_, i) => cs[i % cs.length]);
const developments = (cs: Chord[], key: Key) =>
    harmonicMoves(cs, key).filter((m) => m.name !== 'SAME' && !m.ext).map((m) => m.chords as Chord[]);

/** The 2 section's loops: pairs of the source's chords, the first one's
 *  first, then its first two chords (one held, when it has one) developed. */
export function pairsFrom(src: Chord[], key: Key): Chord[][] {
    const out: Chord[][] = [];
    for (let i = 0; i < src.length; i++) for (let j = i + 1; j < src.length; j++) out.push([src[i], src[j]]);
    /* A held chord's moves are its turns (theory/moves.ts): C C → C Am. */
    return [...out, ...developments(src.length > 1 ? src.slice(0, 2) : [src[0], src[0]], key)];
}

/** The 8 section's loops, from the source's chords taken round to four.
 *  `answer`: the part already plays the source (Double's second half), so
 *  the source answered by a development would only repeat it first. */
export function eightsFrom(src: Chord[], key: Key, answer: boolean): Chord[][] {
    const base = fourOf(src);
    const devs = developments(base, key);
    const out = [base, ...devs].map((cs) => approached(cs, key)).filter((cs): cs is Chord[] => !!cs);
    return answer ? out : [...out, ...devs.map((d) => [...base, ...d])];
}

export interface Laid { count: 2 | 8; chords: Prog }

/** A part's 2 and 8 sections laid over its `n` half-bars at New Clip's rates:
 *  2 from two bars (a bar a chord there, two bars from four), 8 from four
 *  bars (a half-bar a chord). `seen` keeps out what HARMONY already holds;
 *  `ok`, what the others pin rules out. */
export function sectionsOver(p: Prog, key: Key, n: number, answer: boolean, ok: (cs: Prog) => boolean, seen: Set<string>): [Laid[], Laid[]] {
    const src = changesOf(p);
    if (!src.length) return [[], []];
    const make = (loops: Chord[][], count: 2 | 8, per: number): Laid[] => loops.flatMap((l) => {
        /* A move may land both chords of a pair on one: no longer a 2 loop. */
        if (new Set(progId(l).split(',')).size < 2) return [];
        const chords = lay(l, n, per);
        const id = progId(chords);
        if (seen.has(id) || !ok(chords)) return [];
        seen.add(id);
        return [{ count, chords }];
    });
    return [n >= 4 ? make(pairsFrom(src, key), 2, n >= 8 ? 4 : 2) : [], n >= 8 ? make(eightsFrom(src, key, answer), 8, 1) : []];
}
