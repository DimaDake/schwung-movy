/* A phrase's rhythm inside its span (plans/2026-10-29-phrase-space-design.md
 * §2b): drawn from a few shapes real phrases take, as curated phrase
 * libraries do (Scaler's phrases, Logic's players), not from per-step dice
 * spread over the bar. The shape says where the notes gather; DENSITY says
 * how many there are; the span's landing (create/land.ts) closes it. */

import { strength } from '../analysis/events.js';
import type { Rng } from '../rng.js';
import { TPS } from '../types.js';

type Shape = (x: number, step: number, n: number) => number;

export const SHAPES: [string, Shape][] = [
    /* Two short ideas, then the long one: notes early, room before the landing. */
    ['SHORT-SHORT-LONG', (x) => (x < 0.6 ? 1 : 0.1)],
    /* The sentence, 1 + 1 + 2: an idea, its repeat, a longer continuation. */
    ['SENTENCE', (x) => (x < 0.2 || (x >= 0.25 && x < 0.45) ? 1 : x >= 0.5 ? 0.8 : 0.05)],
    /* Gathering into the landing: the line runs at its goal. */
    ['PICKUP', (x) => 0.2 + x],
    /* The Charleston: the one and the "and" of two carry it. */
    ['CHARLESTON', (_x, s) => (s % 16 === 0 || s % 16 === 6 ? 2 : 0.4)],
    /* A late entry: the first beat left to the band. */
    ['LATE', (_x, s, n) => (s < Math.min(4, n / 3) ? 0 : 1)],
];

/** The onsets of a span `n` steps long (from `at`, the span's first step),
 *  in steps from its start, at DENSITY `density` (0..10). */
export function phraseOnsets(n: number, at: number, density: number, shape: Shape, r: Rng): number[] {
    if (n <= 0) return [];
    const count = Math.max(1, Math.min(n, Math.round(n * (0.1 + density * 0.045))));
    const w = Array.from({ length: n }, (_, k) => ({ k, w: shape(k / n, at + k, n) * (0.3 + strength((at + k) * TPS)) + r() * 0.12 }));
    /* A phrase starts on its downbeat unless its shape enters late. */
    if (shape(0, at, n) > 0) w[0].w += 10;
    return w.filter((x) => x.w > 0.05).sort((a, b) => b.w - a.w).slice(0, count).map((x) => x.k).sort((a, b) => a - b);
}
