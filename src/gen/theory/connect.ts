/* How well one chord leads into another: root motion by fifth or step is
 * strong, by third smooth, by tritone weak; shared tones help. Scenes loop and
 * are played in any order, so a B section is judged on its way in AND out. */

import type { Chord } from '../types.js';
import { pc } from './pc.js';

const MOTION = [0.6, 0.6, 0.85, 0.75, 0.75, 1, 0.25, 1, 0.75, 0.75, 0.85, 0.6];

export function connection(a: Chord | null, b: Chord | null): number {
    if (!a || !b) return 1;
    const common = a.pcs.filter((x) => b.pcs.includes(x)).length;
    return Math.min(1, MOTION[pc(b.root - a.root)] + 0.1 * Math.min(3, common));
}

export const DROP_BELOW = 0.4;

/** In and out of a progression from the source's, the weaker of the two. */
export function sectionConnection(src: (Chord | null)[], tgt: (Chord | null)[]): number {
    const firstOf = (a: (Chord | null)[]) => a.find((c) => c) ?? null;
    const lastOf = (a: (Chord | null)[]) => [...a].reverse().find((c) => c) ?? null;
    return Math.min(connection(lastOf(src), firstOf(tgt)), connection(lastOf(tgt), firstOf(src)));
}
