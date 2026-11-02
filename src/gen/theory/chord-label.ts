/* HARMONY's value as the chords themselves (user, 2026-11-01: the audience
 * reads AM F C G, not ROAD or LAMENT). A loop of more than four, or one too
 * long for the top strip's value field, shows its first chords and '…'. */

import type { Chord } from '../types.js';
import { chordName, sameChord } from './pc.js';

/* Characters the top strip leaves a value beside HARMONY's name: at the
 * font's widest advance (4 px) 18 fit in the ~88 px the header gives it. */
export const HARMONY_LABEL_MAX = 18;

/** The loop's chords in order, a repeat of the one before shown once. */
export function chordsLabel(chords: readonly (Chord | null)[]): string {
    const names: string[] = [];
    chords.forEach((c, i) => { if (i === 0 || !sameChord(c, chords[i - 1])) names.push(chordName(c)); });
    let out = '';
    for (let i = 0; i < names.length && i < 4; i++) {
        const next = out ? out + ' ' + names[i] : names[i];
        if (next.length > HARMONY_LABEL_MAX - 2) return out + ' …';
        out = next;
    }
    return names.length > 4 ? out + ' …' : out;
}
