/* What a note is against the chord under it, after Impro-Visor: a chord
 * tone, a colour tone (consonant, not in the chord), an approach tone (a
 * semitone or tone from one of those, leading somewhere), or other. These are
 * the rules the generators follow instead of a scale. */

import type { Chord, Key } from '../types.js';
import { isMinorQ, pc, scaleOf } from './pc.js';

export type Cat = 'chord' | 'colour' | 'approach' | 'other';

/** Colour tones: 9th and 13th everywhere, the 11th over minor and sus chords,
 *  the major 7th over a major triad, the minor 7th over a minor triad — each
 *  only where the key has it, and never a semitone above a chord tone (the
 *  classic avoid note: the 11th over a major chord, the b9). */
export function colourPcs(c: Chord, k: Key | null): number[] {
    const iv = [2, 9];
    if (isMinorQ(c.quality) || c.quality === 'sus2' || c.quality === 'sus4' || c.quality === '5') iv.push(5);
    if (c.quality === 'maj') iv.push(11);
    if (c.quality === 'min') iv.push(10);
    const sc = k ? scaleOf(k) : null;
    return iv.map((i) => pc(c.root + i)).filter((p) => !c.pcs.includes(p)
        && (!sc || sc.includes(p))
        && !c.pcs.some((t) => pc(p - t) === 1));
}

export function categoryOf(p: number, c: Chord | null, k: Key | null): Cat {
    if (!c) return 'chord';
    const x = pc(p);
    if (c.pcs.includes(x)) return 'chord';
    const col = colourPcs(c, k);
    if (col.includes(x)) return 'colour';
    if ([...c.pcs, ...col].some((t) => Math.abs(((x - t + 18) % 12) - 6) <= 2)) return 'approach';
    return 'other';
}

/** A strong-beat clash: a semitone or tritone against a chord tone. */
export function clashes(p: number, c: Chord | null): boolean {
    if (!c) return false;
    const x = pc(p);
    if (c.pcs.includes(x)) return false;
    return c.pcs.some((t) => { const d = pc(x - t); return d === 1 || d === 11 || d === 6; });
}

/** How well a note sits, 0..1, given how strong its position is: what the
 *  selector and PITCH FIX both judge with. */
export function noteFit(p: number, c: Chord | null, k: Key | null, strong: boolean): number {
    const cat = categoryOf(p, c, k);
    if (cat === 'chord') return 1;
    if (cat === 'colour') return strong ? 0.75 : 0.9;
    if (cat === 'approach') return strong ? (clashes(p, c) ? 0.1 : 0.4) : 0.7;
    return strong ? 0 : 0.35;
}

/** Pitch classes a voice may land on at a given tension (0..1) and position. */
export function allowedPcs(c: Chord, k: Key | null, tension: number, strong: boolean): number[] {
    const tones = [...c.pcs];
    if (tension < 0.35) return tones;
    const col = colourPcs(c, k);
    if (strong && tension < 0.7) return tones;
    if (tension < 0.85) return [...tones, ...col];
    const sc = k ? scaleOf(k) : [];
    return [...new Set([...tones, ...col, ...(strong ? [] : sc)])];
}
