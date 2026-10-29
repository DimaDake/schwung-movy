/* What every New Clip generator shares (plans/2026-10-28-new-clip-design.md):
 * the run's harmony, the scene's swing, the band's accents, registers, and
 * knobs whose takes are rolled from a musical subset. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { ACCENT } from '../analysis/band.js';
import { strength } from '../analysis/events.js';
import { custom, type KnobDef } from '../knobs.js';
import { planAt } from '../plan.js';
import { uniqueChords } from './plans.js';
import { pick, type Rng } from '../rng.js';
import { diatonic } from '../theory/roman.js';
import { type Chord, TPS } from '../types.js';

/** A choice knob whose take is drawn from `pool` (positions), or from all of it. */
export function choice(name: string, labels: readonly string[], pool?: number[]): KnobDef {
    const k = custom(name, labels, pool?.[0] ?? 0);
    return { ...k, roll: (_c, r) => pick(r, pool ?? labels.map((_, i) => i)) };
}

/** A 0..max knob whose take is drawn between lo and hi. */
export function amount(name: string, max: number, lo: number, hi: number): KnobDef {
    return { name, steps: () => max + 1, def: () => lo, label: (v) => String(v),
        roll: (_c, r) => lo + Math.floor(r() * (hi - lo + 1)) };
}

export const SEED: KnobDef = { name: 'SEED', steps: () => 100, def: () => 0, label: (v) => '#' + (v + 1),
    roll: (_c, r) => Math.floor(r() * 100) };

/** The run's progression: every option of one run shares it (a free scene),
 *  so the eight parts go together; HARMONY moves one option to another. A
 *  clip with room for more than four chords opens on one that uses it. */
export const runPlan = (ctx: GenCtx): number => {
    const n = ctx.plans.length;
    if (n <= 1) return 0;
    const ok = ctx.plans.map((p, i) => i).filter((i) => !ctx.plans[i].label.startsWith('TONIC') && !ctx.plans[i].ext);
    const rich = ok.filter((i) => uniqueChords(ctx.plans[i]) > 4);
    const pool = rich.length ? rich : ok;
    return pool[ctx.seed % pool.length];
};

export const HARMONY: KnobDef = { name: 'HARMONY', steps: (c) => Math.max(1, c.plans.length), def: runPlan,
    label: (v, c) => planAt(c, v).label };

/* Where a part sits. A chord part moves its centre about a minor third a
 * click, so each click is a new inversion; a line moves by octaves, since
 * between them it would only fold some notes and not others. LOW, MID and
 * HIGH are where the takes are drawn (the measured ranges); the ends past
 * them are there to turn to, for a darker or brighter colour (user,
 * 2026-10-29: "extended ranges add more experimental flavor"). */
export const CHORD_REGISTER = { labels: ['DEEP', 'LOW-', 'LOW', 'LOW+', 'MID', 'MID+', 'HIGH', 'HIGH+', 'TOP'],
    centres: [48, 51, 55, 58, 62, 65, 69, 72, 76], LOW: 2, MID: 4, HIGH: 6 } as const;
export const LINE_REGISTER = { labels: ['BASS', 'LOW', 'MID', 'HIGH', 'TOP'], LOW: 1, MID: 2, HIGH: 3 } as const;
export const register = (pool: number[], labels: readonly string[] = CHORD_REGISTER.labels): KnobDef => choice('REGISTER', labels, pool);

/** The chord under a clip tick; the tonic when nothing is planned. */
export function chordUnder(ctx: GenCtx, h: number, tick: number): Chord {
    return chordAt(planAt(ctx, h).chords, tick, ctx.k) ?? diatonic(ctx.key, 0);
}

/** A grid step's tick. Generators write on the grid; SWING is laid over
 *  every part after (feel.ts). */
export function place(_ctx: GenCtx, step: number): number {
    return step * TPS;
}

/** The band's accented steps within a bar (0..15), strongest first. */
export function bandSteps(ctx: GenCtx): number[] {
    const w = new Map<number, number>();
    for (const h of ctx.band) {
        if (h.w < ACCENT) continue;
        const s = Math.round(h.tick / TPS) % 16;
        w.set(s, (w.get(s) ?? 0) + h.w);
    }
    return [...w].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([s]) => s);
}

/** A figure in steps, or the band's own accents when it has enough of them. */
export function withBand(ctx: GenCtx, n: number, fallback: number[]): number[] {
    const s = bandSteps(ctx).slice(0, n).sort((a, b) => a - b);
    return s.length >= 2 ? s : fallback;
}

/** Played velocity: the beat a little louder, a little human. */
export function velAt(tick: number, base: number, r: Rng): number {
    return Math.max(1, Math.min(127, Math.round(base * (0.82 + 0.18 * strength(tick)) + (r() - 0.5) * 6)));
}

/** Steps of the clip, every bar: `steps` per 16 repeated to the end. */
export function everyBar(ctx: GenCtx, steps: number[], f: (step: number, bar: number) => void): void {
    for (let bar = 0; bar * 16 < ctx.len; bar++) {
        for (const s of steps) if (bar * 16 + s < ctx.len) f(bar * 16 + s, bar);
    }
}
