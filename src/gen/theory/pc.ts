/* Pitch-class arithmetic and the key's scales. */

import type { Chord, Key, Quality } from '../types.js';

export const pc = (p: number): number => ((p % 12) + 12) % 12;
/** Upward interval from a to b, 0..11. */
export const up = (a: number, b: number): number => pc(b - a);
/** Smallest signed move from pitch class a to b, -6..5. */
export const near = (a: number, b: number): number => { const d = pc(b - a); return d > 6 ? d - 12 : d; };

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];

export function scaleOf(k: Key): number[] { return (k.minor ? MINOR : MAJOR).map((i) => pc(k.tonic + i)); }

export function inKey(p: number, k: Key): boolean { return scaleOf(k).includes(pc(p)); }

/** A pitch moved by scale steps in the key (a diatonic sequence); a pitch
 *  outside the key moves from its nearest scale tone below. */
export function stepScale(p: number, steps: number, k: Key): number {
    const sc = (k.minor ? MINOR : MAJOR);
    const rel = pc(p - k.tonic);
    let i = sc.length - 1;
    while (i > 0 && sc[i] > rel) i--;
    const chrom = rel - sc[i];
    const oct = Math.floor((p - k.tonic) / 12);
    const j = i + steps;
    const o = oct + Math.floor(j / 7);
    return k.tonic + o * 12 + sc[((j % 7) + 7) % 7] + chrom;
}

/** A pitch's place on the key's scale, in scale steps from the tonic's
 *  octave 0 (a chromatic note counts as the degree below it). */
export function degreeIndex(p: number, k: Key): number {
    const sc = (k.minor ? MINOR : MAJOR);
    const rel = pc(p - k.tonic);
    let i = sc.length - 1;
    while (i > 0 && sc[i] > rel) i--;
    return Math.floor((p - k.tonic) / 12) * 7 + i;
}

/** Euclidean rhythm: `pulses` onsets spread over `steps`, rotated. */
export function euclid(pulses: number, steps: number, rotate = 0): boolean[] {
    const out = Array.from({ length: steps }, (_, i) => Math.floor((i * pulses) / steps) !== Math.floor(((i - 1) * pulses) / steps));
    if (pulses <= 0) return out.map(() => false);
    return out.map((_, i) => out[(((i - rotate) % steps) + steps) % steps]);
}

export const TEMPLATES: Record<Quality, number[]> = {
    maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], 5: [0, 7],
    maj7: [0, 4, 7, 11], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10],
};

export function chordOf(root: number, quality: Quality, bass = root): Chord {
    return { root: pc(root), quality, pcs: TEMPLATES[quality].map((i) => pc(root + i)), bass: pc(bass) };
}

export const isMinorQ = (q: Quality): boolean => q === 'min' || q === 'm7' || q === 'dim' || q === 'm7b5';

export function sameChord(a: Chord | null, b: Chord | null): boolean {
    if (!a || !b) return a === b;
    return a.root === b.root && a.quality === b.quality;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SUFFIX: Record<Quality, string> = { maj: '', min: 'M', dim: 'DIM', aug: '+', sus2: 'S2', sus4: 'S4', 5: '5',
    maj7: 'MA7', 7: '7', m7: 'M7', m7b5: 'M7B5' };

/** Short upper-case chord name for the screen ("AM", "F", "G7"). */
export function chordName(c: Chord | null): string { return c ? NAMES[c.root] + SUFFIX[c.quality] : '-'; }

/** Nearest pitch to `target` whose class is in `pcs`, inside [lo, hi] when
 *  one exists there. Ties go down (a lower note is the safer default). */
export function nearestPitch(target: number, pcs: readonly number[], lo = 0, hi = 127): number {
    let best = -1;
    let bestD = 1e9;
    const t = Math.round(target);
    for (let d = 0; d <= 24; d++) {
        for (const cand of [t - d, t + d]) {
            if (cand < 0 || cand > 127 || !pcs.includes(pc(cand))) continue;
            const pen = cand < lo || cand > hi ? 100 : 0;
            if (d + pen < bestD) { best = cand; bestD = d + pen; }
        }
        if (bestD <= d) break;
    }
    return best < 0 ? Math.max(0, Math.min(127, t)) : best;
}
