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

interface Cells { n: number; keys: Set<number>; steps: number[]; pitches: number[]; byPitch: (number[] | undefined)[]; hist: Int32Array; used: number[] }

/* The guard compares every take (and every knob probe's take) with the same
 * source and loops: on a dense 4-bar chord part their cells were rebuilt
 * thousands of times per Variation (device lag, 2026-11-07). */
const memo = new WeakMap<AiNote[], Map<number, Cells>>();

function cells(notes: AiNote[], len: number): Cells {
    const m = memo.get(notes) ?? new Map<number, Cells>();
    const hit = m.get(len);
    if (hit) return hit;
    const keys = new Set<number>();
    const steps: number[] = [], pitches: number[] = [];
    const byPitch: (number[] | undefined)[] = new Array(128);
    const hist = new Int32Array(128);
    for (const n of notes) {
        const s = Math.round(n.tick / TICKS_PER_STEP) % len;
        const k = s * 128 + n.pitch;
        if (keys.has(k)) continue;
        keys.add(k); steps.push(s); pitches.push(n.pitch); (byPitch[n.pitch] ??= []).push(s); hist[n.pitch]++;
    }
    const c = { n: steps.length, keys, steps, pitches, byPitch, hist, used: [...new Set(pitches)] };
    m.set(len, c);
    memo.set(notes, m);
    return c;
}

let votes = new Int32Array(0);

/** Best share of notes two parts have in common under one time shift (mod
 *  the clip, in steps) and one transposition; 1 = the same loop. With a
 *  `floor`, a share below it may come back as any value below it: the guard
 *  only asks whether the floor is reached, and most transpositions provably
 *  cannot reach it, so they are never voted on. */
export function loopMatch(a: AiNote[], b: AiNote[], lenSteps: number, mode: LoopMode, floor = 0): number {
    const len = Math.max(1, lenSteps);
    const A = cells(a, len);
    const B = cells(b, len);
    if (!A.n || !B.n) return 0;
    const den = Math.max(A.n, B.n);
    const still = mode === 'still' || A.n * B.n > MAX_PAIRS || den < MIN_CELLS;
    if (still && mode === 'rotation') return 0;
    if (still) {
        let both = 0;
        for (const k of A.keys) if (B.keys.has(k)) both++;
        return both / den;
    }
    /* Every match pairs one note of each: no shift reaches more than the smaller part. */
    if (Math.min(A.n, B.n) / den < floor) return Math.min(A.n, B.n) / den;
    if (votes.length < len) votes = new Int32Array(len);
    let best = 0;
    const dps = new Set<number>();
    if (mode === 'rotation') dps.add(0);
    else for (const pa of A.used) for (const pb of B.used) dps.add(pb - pa);
    for (const dp of dps) {
        /* Under one transposition at most min(count) of each pitch can match. */
        let bound = 0;
        for (const p of A.used) if (p + dp >= 0 && p + dp < 128) bound += Math.min(A.hist[p], B.hist[p + dp]);
        if (bound <= best || bound < floor * den) continue;
        votes.fill(0, 0, len);
        for (let i = 0; i < A.n; i++) {
            const pb = A.pitches[i] + dp;
            if (pb < 0 || pb > 127) continue;
            const sa = A.steps[i];
            for (const sb of B.byPitch[pb] ?? []) {
                const ds = (sb - sa + len) % len;
                if (mode === 'rotation' && ds === 0) continue;
                if (++votes[ds] > best) best = votes[ds];
            }
        }
    }
    return best / den;
}

/** Whether an option is one of the track's clips again. */
export function isSameLoop(opt: AiNote[], loops: AiNote[][], lenSteps: number, drum: boolean): boolean {
    return loops.some((l) => {
        if (!drum) return loopMatch(opt, l, lenSteps, 'loop', SAME_LOOP) >= SAME_LOOP;
        /* A pattern that repeats every bar matches its own rotation as well
         * as itself: only a rotation that explains it better counts. */
        const rot = loopMatch(opt, l, lenSteps, 'rotation', SAME_LOOP);
        return rot >= SAME_LOOP && rot > loopMatch(opt, l, lenSteps, 'still');
    });
}
