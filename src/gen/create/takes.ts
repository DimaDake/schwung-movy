/* New Clip's takes (plans/2026-10-28-new-clip-design.md): each one's knobs
 * rolled from the run's seed, rolled again until the part is a meaningful
 * one (checks.ts), so a default is always its knobs — a turn back gives it
 * back. Then one option per generator, in the catalogue's order: its best
 * take that is like neither another option nor one offered lately. */

import type { GenCtx } from '../analysis/context.js';
import { generateOption } from '../generate.js';
import type { Preset } from '../preset.js';
import { hash, mix, rng } from '../rng.js';
import { type Candidate, difference, MIN_PAIR, scoreCandidate } from '../select.js';
import { unmeaning } from './checks.js';

export const TAKES = 4;
const ROLLS = 8;

export function rolled(p: Preset, ctx: GenCtx, which: number, roll: number): number[] {
    const r = rng(mix(ctx.seed, hash(p.id), which + 1, roll));
    return p.knobs.map((k) => {
        const n = k.steps(ctx);
        return Math.max(0, Math.min(n - 1, k.roll ? k.roll(ctx, r) : k.def(ctx)));
    });
}

/** One take of a preset, or null when no roll made a meaningful part. */
export function createTake(p: Preset, ctx: GenCtx, which: number): Candidate | null {
    for (let roll = 0; roll < ROLLS; roll++) {
        const knobs = rolled(p, ctx, which, roll);
        const g = generateOption(ctx, p, knobs);
        if (g.notes && g.retry === 0 && !unmeaning(ctx, p, g.notes)) return { preset: p, knobs, notes: g.notes, ...scoreCandidate(ctx, p, g.notes) };
    }
    return null;
}

export function selectCreate(cands: Candidate[], recent: Candidate['notes'][]): Candidate[] {
    const chosen: Candidate[] = [];
    const presets = [...new Set(cands.map((c) => c.preset))];
    for (const p of presets) {
        const mine = cands.filter((c) => c.preset === p).sort((a, b) => b.score - a.score);
        const apart = (c: Candidate) => chosen.every((x) => difference(x.notes, c.notes) >= MIN_PAIR);
        const fresh = (c: Candidate) => recent.every((x) => difference(x, c.notes) >= MIN_PAIR);
        const c = mine.find((x) => apart(x) && fresh(x)) ?? mine.find(fresh) ?? mine.find(apart) ?? mine[0];
        if (c) chosen.push(c);
    }
    return chosen;
}
