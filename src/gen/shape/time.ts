/* Time stages: TIMING (feel → grid, swing and the scene's pocket included),
 * LENGTH (staccato ← as is → legato), and rhythmic displacement. */

import type { GenCtx } from '../analysis/context.js';
import { spanTo } from '../analysis/events.js';
import { type GridId, gridTarget } from '../analysis/groove.js';
import { BAR, type Ev, type Note, TPS } from '../types.js';

/** Where a note belongs: the grid point (with swing), then the landing
 *  offset for that 16th — the scene's pocket, or a FEEL template. */
export function target(ctx: GenCtx, tick: number, grid: GridId, swing: number, pocket: number, land = ctx.groove.land): number {
    const t = gridTarget(tick, grid, swing);
    const s = Math.round((t % BAR) / TPS) % 16;
    return Math.round(t + (t % TPS === 0 ? land[s] * pocket : 0));
}

/* Groove templates, ticks per 16th of the bar (24 to a 16th): where a
 * drummer or a sampler's groove puts each one. SCENE is the other tracks'. */
const g = (f: (s: number) => number) => Array.from({ length: 16 }, (_, s) => f(s));
export const FEELS: [string, number[] | null][] = [
    ['STRAIGHT', g(() => 0)], ['SCENE', null],
    ['LAID BACK', g((s) => (s % 8 === 4 ? 5 : s % 2 === 0 ? 2 : 4))],
    ['PUSHED', g((s) => (s % 8 === 4 ? -3 : s % 4 === 2 ? -4 : 0))],
    ['SHUFFLE', g((s) => (s % 4 === 2 ? 8 : s % 2 === 1 ? 4 : 0))],
    ['DRUNK 16THS', g((s) => (s % 2 === 1 ? 7 : s % 8 === 4 ? -2 : s % 4 === 2 ? 3 : 0))],
];

export const feelLand = (ctx: GenCtx, i: number): number[] => FEELS[i]?.[1] ?? ctx.groove.land;

/** TIMING 0..1: 0 leaves the feel, 1 lands every onset on its target. Notes
 *  struck together (within a 64th) share one target, so a chord played a few
 *  ticks apart lands as one chord. */
export function timing(ctx: GenCtx, notes: Note[], amount: number, grid: GridId, swing: number, pocket = 1, land = ctx.groove.land): Note[] {
    if (amount <= 0) return notes.map((n) => ({ ...n }));
    const sorted = [...notes].sort((a, b) => a.tick - b.tick);
    const goal = new Map<Note, number>();
    let i = 0;
    while (i < sorted.length) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1].tick - sorted[i].tick <= TPS / 4) j++;
        const group = sorted.slice(i, j + 1);
        const mid = group[Math.floor(group.length / 2)].tick;
        const t = target(ctx, mid, grid, swing, pocket, land);
        for (const n of group) goal.set(n, t);
        i = j + 1;
    }
    return notes.map((n) => {
        const t = Math.max(0, Math.min(ctx.end - 1, Math.round(n.tick + ((goal.get(n) ?? n.tick) - n.tick) * amount)));
        return { ...n, tick: t, gate: Math.max(1, Math.min(n.gate, ctx.end - t)) };
    });
}

/** LENGTH 0..10, 5 = as is: below shortens to a third, above stretches each
 *  note toward the next onset (legato, a hair before it). */
export function lengthStage(evs: Ev[], v: number, end: number): Ev[] {
    if (v === 5) return evs;
    return evs.map((e, i) => {
        const span = spanTo(evs, i, end);
        return { tick: e.tick, voices: e.voices.map((x) => {
            const g = v < 5 ? x.gate * (0.33 + (0.67 * v) / 5)
                : x.gate + (Math.max(x.gate, span - 2) - x.gate) * ((v - 5) / 5);
            return { ...x, gate: Math.max(3, Math.round(g)) };
        }) };
    });
}

/** Moves the chosen events by `steps` 16ths (wrapping inside the clip). */
export function displace(evs: Ev[], which: (i: number) => boolean, steps: number, end: number): Ev[] {
    return evs.map((e, i) => (which(i) ? { tick: ((e.tick + steps * TPS) % end + end) % end, voices: e.voices } : e))
        .sort((a, b) => a.tick - b.tick);
}

/** Notes back on a grid, every note its own onset (the drum path). */
export function snapNotes(notes: Note[], step: number, end: number): Note[] {
    return notes.map((n) => {
        const t = Math.min(end - step, Math.max(0, Math.round(n.tick / step) * step));
        return { ...n, tick: t };
    });
}
