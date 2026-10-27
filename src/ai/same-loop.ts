/* The rule against the same loop (plans/2026-10-27-variation-eight-options.md).
 * A Variation that is a clip of the track moved in time (bars swapped or
 * rotated) or transposed as a whole is that clip again: on the device a bass
 * B was its A with the two bars swapped, which in a 4-bar scene is the A loop
 * started one bar late. Compared on the 16th grid by (step, pitch). */

import { type AiNote, TICKS_PER_STEP } from './clip-dump.js';

/** Share of notes in common at or above which two parts are one loop. */
export const SAME_LOOP = 0.85;
/** Share above which two options are one option. */
export const NEAR_DUP = 0.95;

/* 'loop': any time shift and transposition (melodic); 'rotation': a time
 * shift without transposition, never the unmoved part (drums: a B close to
 * its A is legitimate there); 'still': neither (a near-duplicate). */
export type LoopMode = 'loop' | 'rotation' | 'still';

/* Past this many note pairs only the unmoved comparison runs: the vote is
 * O(n*m), and a part this dense is no loop anyone rotates by hand. */
const MAX_PAIRS = 40_000;
/* Under any shift and transposition one note always matches another: below
 * this many distinct notes only the unmoved comparison means anything (a
 * drone held on a new pitch is a new drone). */
const MIN_CELLS = 4;

function cells(notes: AiNote[], len: number): [number, number][] {
    const seen = new Set<number>();
    const out: [number, number][] = [];
    for (const n of notes) {
        const s = Math.round(n.tick / TICKS_PER_STEP) % len;
        const k = s * 128 + n.pitch;
        if (!seen.has(k)) { seen.add(k); out.push([s, n.pitch]); }
    }
    return out;
}

/** Best share of notes two parts have in common under one time shift (mod
 *  the clip, in steps) and one transposition; 1 = the same loop. */
export function loopMatch(a: AiNote[], b: AiNote[], lenSteps: number, mode: LoopMode): number {
    const len = Math.max(1, lenSteps);
    const A = cells(a, len);
    const B = cells(b, len);
    if (!A.length || !B.length) return 0;
    const still = mode === 'still' || A.length * B.length > MAX_PAIRS || Math.max(A.length, B.length) < MIN_CELLS;
    if (still && mode === 'rotation') return 0;
    const votes = new Map<number, number>();
    let best = 0;
    for (const [sa, pa] of A) {
        for (const [sb, pb] of B) {
            const ds = (sb - sa + len) % len;
            const dp = pb - pa;
            if (still ? ds !== 0 || dp !== 0 : mode === 'rotation' && (dp !== 0 || ds === 0)) continue;
            const k = ds * 256 + dp + 128;
            const v = (votes.get(k) ?? 0) + 1;
            votes.set(k, v);
            if (v > best) best = v;
        }
    }
    return best / Math.max(A.length, B.length);
}

/** Whether an option is one of the track's clips again. */
export function isSameLoop(opt: AiNote[], loops: AiNote[][], lenSteps: number, drum: boolean): boolean {
    return loops.some((l) => {
        if (!drum) return loopMatch(opt, l, lenSteps, 'loop') >= SAME_LOOP;
        /* A pattern that repeats every bar matches its own rotation as well
         * as itself: only a rotation that explains it better counts. */
        const rot = loopMatch(opt, l, lenSteps, 'rotation');
        return rot >= SAME_LOOP && rot > loopMatch(opt, l, lenSteps, 'still');
    });
}
