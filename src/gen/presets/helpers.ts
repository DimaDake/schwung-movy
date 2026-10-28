/* What most melodic generators do around their own idea: read the part as
 * events, realise it over the HARMONY plan at a TENSION and RANGE, then shape
 * DENSITY and LENGTH and write notes. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { fromEvents, toEvents } from '../analysis/events.js';
import { planAt } from '../plan.js';
import { rangeOfKnob, tensionOfKnob } from '../knobs.js';
import { realise } from '../realise/index.js';
import { type Rng, rng } from '../rng.js';
import { rhythmStage } from '../shape/rhythm.js';
import { thicken } from '../shape/thicken.js';
import { densityStage } from '../shape/density.js';
import { lengthStage } from '../shape/time.js';
import type { Chord, Ev, HarmonyPlan, Note } from '../types.js';

export const evsOf = (ctx: GenCtx): Ev[] => toEvents(ctx.src);

/* Knob POSITIONS, not fractions; `voices` is the VOICES knob position (1 =
 * as is), `rhythm` the RHYTHM one (0 = keep). */
export interface Look { h?: number; changes?: number; tension?: number; range?: number; pull?: number; rhythm?: number; voices?: number; r?: Rng }

export function plan(ctx: GenCtx, h = 0, changes = 0): HarmonyPlan { return planAt(ctx, h, changes); }

/** The part over the target harmony: its rhythm reshaped first (RHYTHM), then
 *  realised, then thickened or thinned (VOICES). */
export function over(ctx: GenCtx, evs: Ev[], l: Look): Ev[] {
    const p = planAt(ctx, l.h ?? 0, l.changes ?? 0);
    const tension = tensionOfKnob(l.tension ?? 5);
    const shaped = l.rhythm ? rhythmStage(ctx, evs, l.rhythm, l.r ?? rng(ctx.seed)) : evs;
    const out = realise(ctx, shaped, { plan: p, tension, range: rangeOfKnob(l.range ?? 5), pull: l.pull });
    return l.voices !== undefined && l.voices !== 1 ? thicken(ctx, out, l.voices - 1, p.chords, tension) : out;
}

export interface Finish { density?: number; length?: number; h?: number; changes?: number }

export function finish(ctx: GenCtx, evs: Ev[], f: Finish, r: Rng): Note[] {
    let e = evs;
    if (f.density !== undefined) e = densityStage(ctx, e, f.density, r, planAt(ctx, f.h ?? 0, f.changes ?? 0).chords);
    if (f.length !== undefined) e = lengthStage(e, f.length, ctx.end);
    return fromEvents(e, ctx.end);
}

/** The target chord under a tick at a HARMONY position. */
export const targetAt = (ctx: GenCtx, h: number, tick: number, changes = 0): Chord | null =>
    chordAt(planAt(ctx, h, changes).chords, tick, ctx.k) ?? chordAt(ctx.srcChords, tick, ctx.k);

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
