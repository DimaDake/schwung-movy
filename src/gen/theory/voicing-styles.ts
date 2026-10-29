/* Voicings as a dictionary (plans/2026-10-29-chord-voicing-engine.md). A
 * chord's pitch classes say WHAT sounds; a voicing style says HOW it is
 * stacked, after the voicing dictionaries of tonal.js and Strudel and
 * Scaler's split of chord, voicing and performance: the shapes in chord-
 * member tokens, inversions, drop 2 and drop 3, rootless, quartal. */

import type { Chord, Key } from '../types.js';
import { scaleUnder } from './category.js';
import { pc } from './pc.js';

/** A stack, bottom up, in chord-member tokens: 1 3 5 7, and the colour
 *  tones 9, 6 (13 over a seventh) and 11, each where the key and the chord
 *  allow it (`tone`). */
type Tok = '1' | '3' | '5' | '7' | '9' | '6' | '11';

export interface Style {
    label: string;
    shapes: Tok[][];
    /** Every inversion of each shape (a rootless or root-bottom shape keeps its order). */
    rotate: boolean;
    /** Drop the n-th voice from the top an octave after stacking (drop 2, drop 3). */
    drop?: number;
    /** Stacked fourths from the key's scale instead of tokens. */
    quartal?: boolean;
}

/* Ordered thin to rich, so a turn of VOICING adds colour and spread. */
export const STYLES: Style[] = [
    { label: 'DUO', shapes: [['3', '5']], rotate: true },
    { label: 'TRIAD', shapes: [['1', '3', '5']], rotate: true },
    { label: 'OPEN', shapes: [['1', '3', '5']], rotate: true, drop: 2 },
    { label: 'SHELL', shapes: [['1', '3', '7'], ['1', '7', '3']], rotate: false },
    { label: 'ADD9', shapes: [['1', '3', '5', '9']], rotate: true },
    { label: 'SEVENTH', shapes: [['1', '3', '5', '7']], rotate: true },
    { label: 'DROP 2', shapes: [['1', '3', '5', '7']], rotate: true, drop: 2 },
    { label: 'DROP 3', shapes: [['1', '3', '5', '7']], rotate: true, drop: 3 },
    { label: 'SPREAD', shapes: [['1', '5', '3', '7']], rotate: false },
    { label: 'JAZZ', shapes: [['3', '5', '7', '9'], ['7', '9', '3', '5']], rotate: false },
    { label: 'QUARTAL', shapes: [], rotate: false, quartal: true },
    { label: 'NEO SOUL', shapes: [['1', '7', '3', '5', '9']], rotate: false },
];
export const STYLE_LABELS = STYLES.map((s) => s.label);

const has7 = (c: Chord) => c.pcs.length > 3;
const minorish = (c: Chord) => c.quality === 'min' || c.quality === 'm7' || c.quality === 'm7b5' || c.quality === 'dim';

/* A colour tone the chord can carry: in the scale under it (a borrowed chord
 * lends its own tones) and never a semitone above a chord tone (the b9 and
 * the major chord's 11th, the avoid notes). */
function colourOk(p: number, c: Chord, k: Key): boolean {
    return scaleUnder(k, c).includes(p) && !c.pcs.some((t) => pc(p - t) === 1);
}

/** A token's pitch class on a chord, or null when the chord has nothing for
 *  it (a power chord's third). A colour the chord cannot carry falls back
 *  to a plain tone; a chord whose seventh the style leaves out puts it in
 *  place of the fifth, so a II-V-I keeps its sevenths. */
export function tone(t: Tok, c: Chord, k: Key, styleHas7: boolean): number | null {
    const r = c.pcs[0];
    const fifth = c.quality === '5' ? c.pcs[1] : c.pcs[2];
    switch (t) {
        case '1': return r;
        case '3': return c.quality === '5' ? null : c.pcs[1];
        case '5': return has7(c) && !styleHas7 ? c.pcs[3] : fifth;
        case '7': {
            if (has7(c)) return c.pcs[3];
            const maj7 = pc(r + 11);
            return (c.quality === 'maj' || c.quality === 'aug') && scaleUnder(k, c).includes(maj7) ? maj7 : pc(r + 10);
        }
        case '9': { const n = pc(r + 2); return colourOk(n, c, k) ? n : r; }
        case '6': { const n = pc(r + 9); return colourOk(n, c, k) ? n : fifth; }
        case '11': { const n = pc(r + 5); return minorish(c) || c.quality === 'sus4' || c.quality === 'sus2' ? n : fifth; }
    }
}

/** `pcs` stacked upward from `bottom`: each the next pitch of its class above the last. */
function stackUp(pcs: number[], bottom: number): number[] {
    const out = [bottom];
    for (let i = 1; i < pcs.length; i++) {
        let p = out[i - 1] + 1;
        while (pc(p) !== pcs[i]) p++;
        out.push(p);
    }
    return out;
}

/* Fourths from the scale under the chord, a third where the fourth would
 * leave it (the tritone): the "So What" stack. Only a stack that holds the
 * chord's third and no avoid note (a semitone over a chord tone) still names
 * the chord: E A D G over C, A D G C over Am. */
function quartalShapes(c: Chord, k: Key): number[][] {
    const sc = scaleUnder(k, c);
    return c.pcs.slice(0, 3).map((s) => {
        const out = [s];
        while (out.length < 4) {
            const last = out[out.length - 1];
            out.push(sc.includes(pc(last + 5)) ? pc(last + 5) : pc(last + 4));
        }
        return out;
    }).filter((sh) => c.quality === '5' || sh.includes(c.pcs[1]))
        .filter((sh) => !sh.some((p) => c.pcs.some((t) => pc(p - t) === 1)));
}

/** The pitch-class stacks a style makes of a chord, bottom up. */
export function shapesOf(c: Chord, k: Key, s: Style): number[][] {
    if (s.quartal) return quartalShapes(c, k);
    const styleHas7 = s.shapes.some((sh) => sh.includes('7'));
    const out: number[][] = [];
    for (const sh of s.shapes) {
        const pcs = sh.map((t) => tone(t, c, k, styleHas7)).filter((x): x is number => x !== null);
        if (!pcs.length) continue;
        const rots = s.rotate ? pcs.length : 1;
        for (let r = 0; r < rots; r++) out.push([...pcs.slice(r), ...pcs.slice(0, r)]);
    }
    return out;
}

/* The lowest a pair of adjacent voices may sit at each interval before it
 * turns to mud (the arranger's low-interval limits, by the lower note). */
const LIL = [0, 52, 51, 48, 46, 45, 46, 34, 43, 41, 41, 41];

export function mud(v: number[]): number {
    let m = 0;
    for (let i = 1; i < v.length; i++) {
        const d = v[i] - v[i - 1];
        if (d < 12 && v[i - 1] < LIL[d]) m += 1 + (LIL[d] - v[i - 1]) * 0.15;
    }
    return m;
}

export interface Cand { notes: number[]; shape: number }

/** Every voicing of a chord in a style with all its notes in [lo, hi]. */
export function candidates(c: Chord, k: Key, s: Style, lo: number, hi: number): Cand[] {
    const out: Cand[] = [];
    shapesOf(c, k, s).forEach((pcs, shape) => {
        for (let b = lo - 24; b <= hi; b++) {
            if (pc(b) !== pcs[0]) continue;
            let v = stackUp(pcs, b);
            if (s.drop && v.length > s.drop) {
                v = [...v];
                v[v.length - s.drop] -= 12;
                v.sort((x, y) => x - y);
            }
            if (v[0] >= lo && v[v.length - 1] <= hi) out.push({ notes: v, shape });
        }
    });
    return out;
}

