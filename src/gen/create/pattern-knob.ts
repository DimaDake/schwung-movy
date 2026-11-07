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

export interface PatternSpec { figs: number[][]; lo: number; hi: number; band: number;
    /** Named figures with the same onsets stay apart (rhythm-map.ts). */
    own?: boolean;
    /** The band figure, when not the band's strongest `band` accents (a bass locks to the kick). */
    lock?: (ctx: GenCtx) => number[] }

/** The map's band figure: the spec's lock, or the band's accents. */
const bandFigure = (ctx: GenCtx, s: PatternSpec): number[] => (s.lock ? s.lock(ctx) : withBand(ctx, s.band, []));

const cache = new WeakMap<GenCtx, Map<PatternSpec, RhythmMap>>();

export function patternMap(ctx: GenCtx, s: PatternSpec): RhythmMap {
    const hit = cache.get(ctx)?.get(s);
    if (hit) return hit;
    /* The band's accents (or nothing) are one more named figure, as WITH
     * BAND was; with no band they are not on the map. */
    const band = bandFigure(ctx, s);
    const named = band.length ? [...s.figs, band] : s.figs;
    const m = rhythmMap([...named, ...EUCLIDS], named.length, s.lo, s.hi, 128, s.own);
    if (!cache.has(ctx)) cache.set(ctx, new Map());
    cache.get(ctx)!.set(s, m);
    return m;
}

/** New Clip with nothing else in the scene: the part alone sets the pulse.
 *  An offbeat figure only syncopates against a beat someone plays; alone it
 *  is heard as on the beat, displaced (bench: paths, bass and chords made
 *  first took offbeat figures, LHL 6-7.5 against real 0-5). A take alone
 *  strikes beat 1, and beat 3 too where the part has such figures, so the
 *  half-bar pulse is stated. */
export const unpulsed = (ctx: GenCtx): boolean => ctx.task === 'create' && ctx.band.length === 0;

/** The PATTERN knob; a take is drawn from the named figures in `pool`
 *  (indexes into `figs`, `figs.length` for the band's), repeats weighting
 *  the draw as `choice` pools do. A figure the band's accents duplicate, or
 *  the band's figure with no band, falls to the map's other figures. */
export function patternKnob(s: PatternSpec, pool: number[]): KnobDef {
    const positions = (c: GenCtx): number[] => {
        const m = patternMap(c, s);
        const id = (f: number[]) => [...new Set(f)].sort((a, b) => a - b).join();
        const ps = pool.map((i) => id(i < s.figs.length ? s.figs[i] : bandFigure(c, s)))
            .map((w) => m.takes.find((t) => m.steps[t].join() === w)).filter((t): t is number => t !== undefined);
        const all = ps.length ? ps : m.takes.length ? m.takes : [0];
        if (!unpulsed(c)) return all;
        const on = (beats: number[]) => all.filter((t) => beats.every((b) => m.steps[t].includes(b)));
        return [on([0, 8]), on([0]), all].find((x) => x.length)!;
    };
    return {
        name: 'PATTERN',
        steps: (c) => patternMap(c, s).steps.length,
        def: (c) => positions(c)[0],
        label: (v) => String(v + 1),
        roll: (c, r) => pick(r, positions(c)),
    };
}

/** Where a figure sits whole on the map (its first position if not). */
export function figurePosition(ctx: GenCtx, s: PatternSpec, fig: number[]): number {
    const m = patternMap(ctx, s);
    const id = [...new Set(fig)].sort((a, b) => a - b).join();
    return Math.max(0, m.steps.findIndex((x) => x.join() === id));
}

/** A position's onsets in one bar. */
export const patternAt = (ctx: GenCtx, s: PatternSpec, v: number): number[] => {
    const m = patternMap(ctx, s);
    return m.steps[Math.max(0, Math.min(m.steps.length - 1, v))];
};

/* DENSITY over PATTERN: the position's own flavour played to fewer or more
 * of its ranked steps, so the figure thins to its strongest hits or fills
 * from the metre, nested as the map is. Left is one onset a click (Grids);
 * right reaches about twelve, since a comp on every 16th is no comp. */
const DENSE_TOP = 12;
const PICKS = [5, 5, 5, 4, 6, 3];
export const DENSITY: KnobDef = { name: 'DENSITY', steps: () => 11, def: () => 5,
    label: (v) => (v === 5 ? 'AS IS' : (v > 5 ? '+' : '-') + Math.abs(v - 5)),
    roll: (_c, r) => pick(r, PICKS) };

/** A position's onsets in one bar at DENSITY `d` (5 = as the map has it). */
export function patternDense(ctx: GenCtx, s: PatternSpec, v: number, d = 5): number[] {
    const base = patternAt(ctx, s, v);
    if (d === 5) return base;
    const m = patternMap(ctx, s);
    const rank = m.ranks[m.flavour[Math.max(0, Math.min(m.steps.length - 1, v))]];
    const n = base.length;
    const k = d < 5 ? Math.max(1, n - (5 - d)) : Math.min(16, n + (d - 5) * Math.max(1, Math.round((DENSE_TOP - n) / 5)));
    return rank.slice(0, k).sort((a, b) => a - b);
}
