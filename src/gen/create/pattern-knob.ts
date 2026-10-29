/* PATTERN on New Clip's chord parts: the rhythm map (shape/rhythm-map.ts)
 * through the part's figures, the band's own accents and Euclidean figures
 * between them. A take lands on a whole figure; a turn walks the map. The
 * band's accents differ per scene, so the map is built per request, once. */

import type { GenCtx } from '../analysis/context.js';
import type { KnobDef } from '../knobs.js';
import { pick } from '../rng.js';
import { euclids, type RhythmMap, rhythmMap } from '../shape/rhythm-map.js';
import { withBand } from './common.js';

/* Euclidean flavours: (onsets, rotation). Each is a kind of comp the named
 * figures leave out: the even threes and fives and sevens, and their
 * rotations that start off the beat. */
const EUCLIDS = euclids([[3, 0], [3, 2], [5, 0], [5, 2], [7, 0], [7, 1], [9, 0], [5, 3]]);

export interface PatternSpec { figs: number[][]; lo: number; hi: number; band: number }

const cache = new WeakMap<GenCtx, Map<PatternSpec, RhythmMap>>();

export function patternMap(ctx: GenCtx, s: PatternSpec): RhythmMap {
    const hit = cache.get(ctx)?.get(s);
    if (hit) return hit;
    /* The band's accents (or nothing) are one more named figure, as WITH
     * BAND was; with no band they are not on the map. */
    const band = withBand(ctx, s.band, []);
    const named = band.length ? [...s.figs, band] : s.figs;
    const m = rhythmMap([...named, ...EUCLIDS], named.length, s.lo, s.hi);
    if (!cache.has(ctx)) cache.set(ctx, new Map());
    cache.get(ctx)!.set(s, m);
    return m;
}

/** The PATTERN knob; a take is drawn from the named figures in `pool`
 *  (indexes into `figs`, `figs.length` for the band's), repeats weighting
 *  the draw as `choice` pools do. A figure the band's accents duplicate, or
 *  the band's figure with no band, falls to the map's other figures. */
export function patternKnob(s: PatternSpec, pool: number[]): KnobDef {
    const positions = (c: GenCtx): number[] => {
        const m = patternMap(c, s);
        const id = (f: number[]) => [...new Set(f)].sort((a, b) => a - b).join();
        const ps = pool.map((i) => id(i < s.figs.length ? s.figs[i] : withBand(c, s.band, [])))
            .map((w) => m.takes.find((t) => m.steps[t].join() === w)).filter((t): t is number => t !== undefined);
        return ps.length ? ps : m.takes.length ? m.takes : [0];
    };
    return {
        name: 'PATTERN',
        steps: (c) => patternMap(c, s).steps.length,
        def: (c) => positions(c)[0],
        label: (v) => String(v + 1),
        roll: (c, r) => pick(r, positions(c)),
    };
}

/** A position's onsets in one bar. */
export const patternAt = (ctx: GenCtx, s: PatternSpec, v: number): number[] => {
    const m = patternMap(ctx, s);
    return m.steps[Math.max(0, Math.min(m.steps.length - 1, v))];
};
