/* One option: a preset run at a knob state, through the guard. A guard
 * failure rolls the preset's own randomness on (up to eight times) before the
 * option is given up, so a same-loop hit is a new roll, not a dead knob. */

import type { GenCtx } from './analysis/context.js';
import { guard } from './guard.js';
import { defaultHarmony } from './plan.js';
import { knobIndex, type Preset } from './preset.js';
import { runPlan } from './create/common.js';
import { clearRubs } from './shape/band-pitch.js';
import { hash, mix } from './rng.js';
import type { Note } from './types.js';

export const RETRIES = 8;

export interface Generated { notes: Note[] | null; why: string; retry: number }

/* A new note never rubs against the band (shape/band-pitch.ts), heard on
 * its take's HARMONY or the request's plan. A Smart Quantize fixes the
 * player's own notes and a Smart Double keeps what it doubles, so only the
 * notes a double adds are moved; a generator whose knobs place its notes on
 * purpose (CADENCE's LAND, TURNAROUND's CHROMATIC) keeps them. */
function offBand(ctx: GenCtx, p: Preset, v: number[], raw: Note[]): Note[] {
    if (ctx.drum || ctx.task === 'quantize' || p.ownPitches) return raw;
    const k = knobIndex(p, 'HARMONY');
    const h = k >= 0 ? v[k] : ctx.task === 'create' ? runPlan(ctx) : defaultHarmony(ctx);
    if (ctx.task !== 'double') return clearRubs(ctx, raw, h);
    const kept = new Set(ctx.src.map((n) => `${n.tick}.${n.pitch}`));
    const keep = raw.filter((n) => kept.has(`${n.tick}.${n.pitch}`));
    return [...keep, ...clearRubs(ctx, raw.filter((n) => !kept.has(`${n.tick}.${n.pitch}`)), h)];
}

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
        const g = guard(ctx, offBand(ctx, p, v, raw));
        if (g.ok) return { notes: g.notes, why: '', retry };
        why = g.why;
    }
    return { notes: null, why, retry: RETRIES };
}
