/* What most melodic generators do around their own idea: read the part as
 * events, realise it over the HARMONY plan at a TENSION and RANGE, then shape
 * DENSITY and LENGTH and write notes. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { fromEvents, toEvents } from '../analysis/events.js';
import { planAt } from '../plan.js';
import { rangeOfKnob, tensionOfKnob } from '../knobs.js';
import { realise } from '../realise/index.js';
import type { Rng } from '../rng.js';
import { densityStage } from '../shape/density.js';
import { lengthStage } from '../shape/time.js';
import type { Chord, Ev, HarmonyPlan, Note } from '../types.js';

export const evsOf = (ctx: GenCtx): Ev[] => toEvents(ctx.src);

export interface Look { h?: number; tension?: number; range?: number; pull?: number }

export function plan(ctx: GenCtx, h = 0): HarmonyPlan { return planAt(ctx, h); }

/** The part over the target harmony. Knob positions, not fractions. */
export function over(ctx: GenCtx, evs: Ev[], l: Look): Ev[] {
    return realise(ctx, evs, { plan: planAt(ctx, l.h ?? 0), tension: tensionOfKnob(l.tension ?? 5),
        range: rangeOfKnob(l.range ?? 5), pull: l.pull });
}

export interface Finish { density?: number; length?: number; h?: number }

export function finish(ctx: GenCtx, evs: Ev[], f: Finish, r: Rng): Note[] {
    let e = evs;
    if (f.density !== undefined) e = densityStage(ctx, e, f.density, r, planAt(ctx, f.h ?? 0).chords);
    if (f.length !== undefined) e = lengthStage(e, f.length, ctx.end);
    return fromEvents(e, ctx.end);
}

/** The target chord under a tick at a HARMONY position. */
export const targetAt = (ctx: GenCtx, h: number, tick: number): Chord | null =>
    chordAt(planAt(ctx, h).chords, tick, ctx.k) ?? chordAt(ctx.srcChords, tick, ctx.k);

/** Bars of the target clip, at least one. */
export const bars = (ctx: GenCtx): number => Math.max(1, Math.round(ctx.len / 16));

/** The events whose index `r` picks at a share 0..1 (AMOUNT / 10). */
export function someOf(n: number, share: number, r: Rng): Set<number> {
    const k = Math.round(n * share);
    const idx = Array.from({ length: n }, (_, i) => ({ i, w: r() })).sort((a, b) => a.w - b.w).slice(0, k).map((x) => x.i);
    return new Set(idx);
}

/** The part as events (already at the target length: context.ts loops it). */
export const partEvs = (ctx: GenCtx): Ev[] => evsOf(ctx);
