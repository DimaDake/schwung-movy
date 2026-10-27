/* Key finding: a duration-weighted pitch-class profile correlated with the
 * Krumhansl–Kessler probe-tone profiles, all 24 keys (the method music21 and
 * the Yale corpus study use). */

import type { Key } from '../types.js';
import { pc } from './pc.js';

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(x: number[], y: number[]): number {
    const mx = x.reduce((a, b) => a + b, 0) / 12;
    const my = y.reduce((a, b) => a + b, 0) / 12;
    let n = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) {
        n += (x[i] - mx) * (y[i] - my);
        dx += (x[i] - mx) ** 2;
        dy += (y[i] - my) ** 2;
    }
    return dx && dy ? n / Math.sqrt(dx * dy) : 0;
}

/** Every key, best first. A flat profile (nothing sounded) ranks C major
 *  first with score 0, so callers always get a key. */
export function rankKeys(w: number[], hint?: { tonic: number; minor: boolean }): Key[] {
    const out: Key[] = [];
    for (let t = 0; t < 12; t++) {
        for (const minor of [false, true]) {
            const prof = minor ? KK_MINOR : KK_MAJOR;
            const rot = Array.from({ length: 12 }, (_, i) => prof[pc(i - t)]);
            /* The Set's own key setting breaks near-ties: a profile that cannot
             * tell C major from A minor should take what the user chose. */
            const bonus = hint && hint.tonic === t && hint.minor === minor ? 0.03 : 0;
            out.push({ tonic: t, minor, score: corr(w, rot) + bonus });
        }
    }
    return out.sort((a, b) => b.score - a.score);
}

export function findKey(w: number[], hint?: { tonic: number; minor: boolean }): Key {
    return rankKeys(w, hint)[0];
}

/** The Set header's key ("A", "minor") as a hint, when it names one. */
export function keyHint(root: string | undefined, mode: string | undefined): { tonic: number; minor: boolean } | undefined {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const t = names.indexOf((root ?? '').toUpperCase());
    if (t < 0) return undefined;
    return { tonic: t, minor: /minor|aeolian|dorian|phrygian/i.test(mode ?? '') };
}
