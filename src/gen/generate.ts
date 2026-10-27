/* One option: a preset run at a knob state, through the guard. A guard
 * failure rolls the preset's own randomness on (up to eight times) before the
 * option is given up, so a same-loop hit is a new roll, not a dead knob. */

import type { GenCtx } from './analysis/context.js';
import { guard } from './guard.js';
import type { Preset } from './preset.js';
import { hash, mix } from './rng.js';
import type { Note } from './types.js';

export const RETRIES = 8;

export interface Generated { notes: Note[] | null; why: string; retry: number }

export function generateOption(ctx: GenCtx, p: Preset, v: number[]): Generated {
    let why = 'no output';
    for (let retry = 0; retry < RETRIES; retry++) {
        const seed = mix(ctx.seed, hash(p.id), retry);
        let raw: Note[];
        try {
            raw = p.generate(ctx, v, seed);
        } catch (e) {
            return { notes: null, why: 'threw ' + String((e as Error)?.message ?? e), retry };
        }
        const g = guard(ctx, raw);
        if (g.ok) return { notes: g.notes, why: '', retry };
        why = g.why;
    }
    return { notes: null, why, retry: RETRIES };
}
