/* What every realiser shares: the options a generator passes, and how a
 * chord member of the source finds its counterpart in the target chord. */

import type { GenCtx } from '../analysis/context.js';
import type { Chord, HarmonyPlan, Key, Sit } from '../types.js';
import { pc, scaleOf, up } from '../theory/pc.js';

export interface RealiseOpts {
    plan: HarmonyPlan;
    tension: number;        // 0..1 — chord tones only … chromatic
    range: number;          // interval scale: 1 = as played, <1 narrower, >1 wider
    pull?: number;          // 0..1 how strongly a line is pulled back to the source register (default 0.3)
}

export const DEFAULT_TENSION = 0.5;

/** The seventh a chord would take in this key: its own if it has one, else
 *  the key's (a major 7th on I and IV, a minor 7th elsewhere). */
export function seventhOf(c: Chord, k: Key): number {
    if (c.pcs.length > 3) return c.pcs[3];
    const sc = scaleOf(k);
    const maj7 = pc(c.root + 11);
    return sc.includes(maj7) && c.quality === 'maj' ? maj7 : pc(c.root + 10);
}

export const ninthOf = (c: Chord): number => pc(c.root + 2);

/** Member index of a pitch class in a chord, or -1. */
export const memberOf = (p: number, c: Chord): number => c.pcs.indexOf(pc(p));

/** The target pitch class for source member m, with the plan's way of sitting. */
export function mapMember(m: number, t: Chord, sit: Sit, strong: boolean, k: Key): number {
    const n = t.pcs.length;
    const at = (i: number) => t.pcs[Math.min(i, n - 1)];
    if (sit === 'roots') return m === 2 ? at(2) : at(0);
    if (sit === 'inv') return at((m + 1) % Math.min(3, n));
    if (sit === '7th' && !strong && m === 0) return seventhOf(t, k);
    if (sit === '9th' && !strong && m === 0) return ninthOf(t);
    return at(m);
}

/** A colour tone keeps its interval above the root when the new chord takes it. */
export const mapColour = (p: number, s: Chord, t: Chord): number => pc(t.root + up(s.root, p));

export function bounds(ctx: GenCtx, range: number): [number, number] {
    const widen = range > 1 ? Math.round((range - 1) * 10) : 0;
    const narrow = range < 1 ? Math.round((1 - range) * 4) : 0;
    return [Math.max(0, ctx.lo - 3 - widen + narrow), Math.min(127, ctx.hi + 3 + widen - narrow)];
}
