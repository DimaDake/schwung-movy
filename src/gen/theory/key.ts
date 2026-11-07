/* Key finding: a duration-weighted pitch-class profile correlated with the
 * Krumhansl–Kessler probe-tone profiles, all 24 keys (the method music21 and
 * the Yale corpus study use). */

import type { Key } from '../types.js';
import { DORIAN, LYDIAN, MAJOR, MINOR, MIXOLYDIAN, pc, PHRYGIAN } from './pc.js';

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

/* Each of the Set's scales (seq/scales.ts, lower-cased) as a key: major or
 * minor, and the mode when it is a 7-note one the chords can be built in.
 * Locrian (a diminished home chord), the harmonic and melodic minors (an
 * augmented III) and the 5- and 6-note scales take their parent key. */
const SET_SCALES: Record<string, [boolean, number[]?]> = {
    major: [false], minor: [true], dorian: [true, DORIAN], phrygian: [true, PHRYGIAN], lydian: [false, LYDIAN],
    mixolydian: [false, MIXOLYDIAN], locrian: [true], 'harm min': [true], 'mel min': [true],
    'maj penta': [false], 'min penta': [true], blues: [true],
};

export interface KeyHint { tonic: number; minor: boolean; mode?: number[] }

/** The Set header's key ("A", "dorian") as a hint, when it names one. */
export function keyHint(root: string | undefined, mode: string | undefined): KeyHint | undefined {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const t = names.indexOf((root ?? '').toUpperCase());
    if (t < 0) return undefined;
    const [minor, steps] = SET_SCALES[(mode ?? '').toLowerCase()] ?? [false];
    return { tonic: t, minor, ...(steps ? { mode: steps } : {}) };
}

/* The share of the sounding duration that must sit in the Set's scale for
 * the Set's key signature to hold. A bass of five or six notes correlates
 * better with a key a fifth away (D minor's riff read as G major) though
 * every note is in D minor. Keys a fifth apart differ by ONE note, so a
 * tenth of the time on it (F# in a C major Set) already says G: 0.95 lets a
 * passing note through and nothing more. */
const HOLDS = 0.95;
const collection = (tonic: number, minor: boolean) => (minor ? MINOR : MAJOR).map((s) => pc(tonic + s)).sort((a, b) => a - b).join();

/** Whether what sounds stays inside the Set's scale (a minor key's raised
 *  7th, the leading tone of V, included). */
function holds(w: number[], hint: KeyHint): boolean {
    const total = w.reduce((a, x) => a + Math.max(0, x), 0);
    if (!total) return false;
    const steps = hint.minor ? [...MINOR, 11] : MAJOR;
    return steps.reduce((a, s) => a + Math.max(0, w[pc(hint.tonic + s)]), 0) / total >= HOLDS;
}

/** The key the notes say, in the Set's mode when it is on the same tonic and
 *  third and nothing heard leaves the mode (a silent scene says nothing).
 *  While the notes stay in the Set's scale, only its key signature can win:
 *  the notes still choose the tonic (an A minor riff in a C major Set is in
 *  A minor), never a key with other sharps or flats. */
export function keyFor(w: number[], hint: KeyHint | undefined): Key {
    let k = findKey(w, hint);
    if (hint && holds(w, hint) && collection(k.tonic, k.minor) !== collection(hint.tonic, hint.minor)) {
        const sig = collection(hint.tonic, hint.minor);
        k = rankKeys(w, hint).find((x) => collection(x.tonic, x.minor) === sig) ?? k;
    }
    const m = hint?.mode;
    if (!m || k.tonic !== hint.tonic || k.minor !== hint.minor) return k;
    return w.every((x, p) => x <= 0 || m.includes(pc(p - k.tonic))) ? { ...k, mode: m } : k;
}
