/* The harmonic moves a free scene may make from the source's progression
 * (design §2.1), ordered close to far. Each maps a progression (a chord per
 * half-bar) in a key to a new one; a move that would change nothing, or
 * connects badly in or out of the source, is not offered. */

import type { Chord, Key } from '../types.js';
import { sectionConnection, DROP_BELOW } from './connect.js';
import { chordOf, isMinorQ, pc, sameChord } from './pc.js';
import { degreeOf, diatonic, shiftDegrees } from './roman.js';

export interface MoveResult { name: string; dist: number; chords: (Chord | null)[]; pedal: number | null }

type Prog = (Chord | null)[];
const each = (p: Prog, f: (c: Chord) => Chord): Prog => p.map((c) => (c ? f(c) : null));

const SUB_MAJOR = [5, 3, 0, 1, 6, 3, 4];
const SUB_MINOR = [2, 3, 0, 5, 6, 3, 4];

function substitute(c: Chord, k: Key): Chord {
    const d = degreeOf(c, k);
    if (d < 0) return c;
    const seventh = c.pcs.length > 3;
    return diatonic(k, (k.minor ? SUB_MINOR : SUB_MAJOR)[d], seventh);
}

function borrow(c: Chord, k: Key): Chord {
    const d = degreeOf(c, k);
    if (!k.minor) {
        if (d === 3) return chordOf(c.root, 'min');               // iv
        if (d === 5) return chordOf(k.tonic + 8, 'maj');           // bVI
        if (d === 4) return chordOf(k.tonic + 10, 'maj');          // bVII
        if (d === 0) return chordOf(k.tonic, 'min');               // i
        return c;
    }
    if (d === 3) return chordOf(c.root, 'maj');                    // IV (dorian)
    if (d === 4) return chordOf(c.root, c.pcs.length > 3 ? '7' : 'maj');  // V (harmonic)
    if (d === 6) return chordOf(k.tonic + 7, 'maj');               // VII → V
    return c;
}

function parallel(c: Chord, k: Key): Chord {
    const d = degreeOf(c, k);
    if (d < 0) return c;
    return diatonic({ tonic: k.tonic, minor: !k.minor, score: 0 }, d, c.pcs.length > 3);
}

/* Neo-Riemannian transforms (the Tonnetz): each keeps two notes of a triad
 * and moves the third by a step or two — P C↔Cm, L C↔Em, R C↔Am. Only major
 * and minor chords (and their sevenths, as triads) have them. */
const TRIADIC = new Set(['maj', 'min', 'maj7', '7', 'm7']);
export function riemann(c: Chord, t: 'P' | 'L' | 'R'): Chord {
    if (!TRIADIC.has(c.quality)) return c;
    const minor = isMinorQ(c.quality);
    if (t === 'P') return chordOf(c.root, minor ? 'maj' : 'min');
    if (t === 'L') return minor ? chordOf(c.root + 8, 'maj') : chordOf(c.root + 4, 'min');
    return minor ? chordOf(c.root + 3, 'maj') : chordOf(c.root + 9, 'min');
}

/** A TURN: the second half of every held chord takes the transform (C C →
 *  C Am), so a slow progression moves with two notes kept. */
const turn = (p: Prog, t: 'P' | 'L' | 'R'): Prog =>
    p.map((c, i) => (c && i % 2 === 1 && sameChord(c, p[i - 1]) ? riemann(c, t) : c));

interface Def { name: string; dist: number; map: (p: Prog, k: Key) => Prog; pedal?: boolean; wild?: boolean }

const DEFS: Def[] = [
    { name: 'SAME', dist: 0, map: (p) => p },
    { name: 'IV SEQ', dist: 0.3, map: (p, k) => each(p, (c) => shiftDegrees(c, k, 3)) },
    { name: 'VI SEQ', dist: 0.35, map: (p, k) => each(p, (c) => shiftDegrees(c, k, 5)) },
    { name: 'R TURN', dist: 0.37, map: (p) => turn(p, 'R') },
    { name: 'L TURN', dist: 0.42, map: (p) => turn(p, 'L') },
    { name: 'V SEQ', dist: 0.4, map: (p, k) => each(p, (c) => shiftDegrees(c, k, 4)) },
    { name: 'II SEQ', dist: 0.45, map: (p, k) => each(p, (c) => shiftDegrees(c, k, 1)) },
    { name: 'SUBST', dist: 0.5, map: (p, k) => each(p, (c) => substitute(c, k)) },
    { name: 'BORROW', dist: 0.55, map: (p, k) => each(p, (c) => borrow(c, k)) },
    { name: 'PEDAL', dist: 0.6, map: (p, k) => each(p, (c) => shiftDegrees(c, k, 3)), pedal: true },
    { name: 'P TURN', dist: 0.65, map: (p) => turn(p, 'P') },
    { name: 'PARALLEL', dist: 0.75, map: (p, k) => each(p, (c) => parallel(c, k)) },
    { name: 'MEDIANT', dist: 0.9, map: (p) => each(p, (c) => chordOf(c.root + 8, c.quality)), wild: true },
];

const key = (p: Prog) => p.map((c) => (c ? c.root + c.quality : '-')).join(' ');

/** The moves for a progression, SAME first; never two that sound alike. */
export function harmonicMoves(src: Prog, k: Key, wild: boolean): MoveResult[] {
    const out: MoveResult[] = [];
    const seen = new Set<string>();
    for (const d of DEFS) {
        if (d.wild && !wild) continue;
        const chords = d.map(src, k);
        const pedal = d.pedal ? k.tonic : null;
        const id = key(chords) + (pedal ?? '');
        if (seen.has(id)) continue;
        if (d.name !== 'SAME' && !wild && sectionConnection(src, chords) < DROP_BELOW) continue;
        if (d.name !== 'SAME' && chords.every((c, i) => sameChord(c, src[i])) && pedal === null) continue;
        seen.add(id);
        out.push({ name: d.name, dist: d.dist, chords, pedal });
    }
    return out;
}

/** Whether a chord tolerates pitch classes another track pins (a drone, a
 *  lone bass): each must be a chord tone or a colour tone of it. */
export function tolerates(c: Chord, pinned: number[], colours: (c: Chord) => number[]): boolean {
    const ok = [...c.pcs, ...colours(c)];
    return pinned.every((p) => ok.includes(pc(p)));
}
