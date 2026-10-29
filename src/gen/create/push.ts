/* Comping that hears the harmony (plans/2026-10-29-generator-follow-ups.md
 * #5): a strike in the last eighth before a chord change, when the change
 * itself is not struck, plays the NEXT chord. That is the push of pop, funk
 * and house comping, and a bass's anticipation: the ear hears a syncopated
 * hit as the start of what comes after it, so the old chord there sounds
 * late. A change that falls between two strikes further apart simply rests. */

import type { GenCtx, Prog } from '../analysis/context.js';
import { planAt } from '../plan.js';
import { sameChord } from '../theory/pc.js';
import { type Chord, HALF, TPS } from '../types.js';
import { chordUnder } from './common.js';

/** How close before a change a strike is heard as its push. */
const PUSH = 2 * TPS;

/** The chord each strike plays; `ticks` in order, the clip looping. */
export function struck(ctx: GenCtx, h: number, ticks: number[]): Chord[] {
    const unit = ((planAt(ctx, h).chords as Prog).unit ?? HALF) / ctx.k;
    return ticks.map((t, i) => {
        const c = chordUnder(ctx, h, t);
        const change = (Math.floor(t / unit) + 1) * unit;
        const next = i + 1 < ticks.length ? ticks[i + 1] : ctx.end + ticks[0];
        if (change - t > PUSH || next <= change) return c;
        const n = chordUnder(ctx, h, change % ctx.end);
        return sameChord(n, c) ? c : n;
    });
}
