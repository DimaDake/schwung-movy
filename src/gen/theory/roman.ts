/* A chord's place in the key: scale degree, function (tonic, subdominant,
 * dominant) and the diatonic chord on any degree — what the harmonic moves
 * (moves.ts) are written in. */

import type { Chord, Key, Quality } from '../types.js';
import { chordOf, pc, scaleOf } from './pc.js';

export type Fn = 'T' | 'S' | 'D' | '?';

/** 0..6, or -1 for a root outside the key. */
export function degreeOf(c: Chord, k: Key): number { return scaleOf(k).indexOf(c.root); }

const FN_MAJOR: Fn[] = ['T', 'S', 'T', 'S', 'D', 'T', 'D'];
const FN_MINOR: Fn[] = ['T', 'S', 'T', 'S', 'D', 'S', 'D'];

export function functionOf(c: Chord, k: Key): Fn {
    const d = degreeOf(c, k);
    return d < 0 ? '?' : (k.minor ? FN_MINOR : FN_MAJOR)[d];
}

const has7 = (q: Quality) => q === 'maj7' || q === '7' || q === 'm7' || q === 'm7b5';

/** The chord the key builds on a degree, stacked in thirds; a seventh when asked. */
export function diatonic(k: Key, degree: number, seventh = false): Chord {
    const sc = scaleOf(k);
    const d = ((degree % 7) + 7) % 7;
    const r = sc[d];
    const third = pc(sc[(d + 2) % 7] - r);
    const fifth = pc(sc[(d + 4) % 7] - r);
    const sev = pc(sc[(d + 6) % 7] - r);
    let q: Quality = fifth === 6 ? 'dim' : fifth === 8 ? 'aug' : third === 3 ? 'min' : 'maj';
    if (seventh) {
        if (q === 'maj') q = sev === 11 ? 'maj7' : '7';
        else if (q === 'min') q = 'm7';
        else if (q === 'dim') q = 'm7b5';
    }
    return chordOf(r, q);
}

/** The same function a number of degrees away, keeping a seventh if it had
 *  one; a chord outside the key moves by the same number of semitones the
 *  key's tonic would. */
export function shiftDegrees(c: Chord, k: Key, by: number): Chord {
    const d = degreeOf(c, k);
    if (d < 0) {
        const sc = scaleOf(k);
        const semis = pc(sc[((by % 7) + 7) % 7] - sc[0]);
        return chordOf(c.root + semis, c.quality);
    }
    let out = diatonic(k, d + by, has7(c.quality));
    /* A sequence that lands on the diminished chord takes its functional
     * stand-in instead (vii° → V in major, ii° → iv in minor): a bare
     * diminished triad is no place for a B section to sit. */
    if ((out.quality === 'dim' || out.quality === 'm7b5') && c.quality !== 'dim' && c.quality !== 'm7b5') {
        out = diatonic(k, k.minor ? 3 : 4, has7(c.quality));
    }
    /* Sus and power chords keep their colour on the new root. */
    if (c.quality === 'sus2' || c.quality === 'sus4' || c.quality === '5') return chordOf(out.root, c.quality);
    return out;
}

/** Roman numeral for logs and labels ("VI", "iv", "V7"). */
export function roman(c: Chord, k: Key): string {
    const d = degreeOf(c, k);
    const R = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    if (d < 0) return '?';
    const minor = c.quality === 'min' || c.quality === 'm7' || c.quality === 'dim' || c.quality === 'm7b5';
    return (minor ? R[d].toLowerCase() : R[d]) + (has7(c.quality) ? '7' : '');
}
