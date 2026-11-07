/* One option: a preset run at a knob state, through the guard. A guard
 * failure rolls the preset's own randomness on (up to eight times) before the
 * option is given up, so a same-loop hit is a new roll, not a dead knob. */

import type { GenCtx } from './analysis/context.js';
import { guard } from './guard.js';
import { defaultHarmony } from './plan.js';
import { knobIndex, type Preset } from './preset.js';
import { runPlan } from './create/common.js';
import { clearLines, clearMud, clearRubs } from './shape/band-pitch.js';
import { hash, mix } from './rng.js';
import type { Note } from './types.js';

export const RETRIES = 8;

export interface Generated { notes: Note[] | null; why: string; retry: number }

/* A new note never rubs against the band (shape/band-pitch.ts), heard on
 * its take's HARMONY or the request's plan. A Smart Quantize fixes the
 * player's own notes and a Smart Double keeps what it doubles, so only the
 * notes a double adds are moved; a generator whose knobs place its notes on
 * purpose (CADENCE's LAND, TURNAROUND's CHROMATIC) keeps them. */
/* A second line sits a third from its melody on purpose (shape/band-pitch.ts clearLines). */
const SECOND_LINES = new Set(['n-harmonize', 'n-follow', 'v-harmonize', 'v-follow']);

function offBand(ctx: GenCtx, p: Preset, v: number[], raw0: Note[]): Note[] {
    const own = typeof p.ownPitches === 'function' ? p.ownPitches(v, ctx) : p.ownPitches;
    if (ctx.drum || ctx.task === 'quantize' || own) return raw0;
    const raw = ctx.task === 'double' || SECOND_LINES.has(p.id) ? raw0 : clearLines(ctx, raw0);
    const k = knobIndex(p, 'HARMONY');
    const h = k >= 0 ? v[k] : ctx.task === 'create' ? runPlan(ctx) : defaultHarmony(ctx);
    if (ctx.task !== 'double') return clearRubs(ctx, clearMud(ctx, raw), h);
    const kept = new Set(ctx.src.map((n) => `${n.tick}.${n.pitch}`));
    const keep = raw.filter((n) => kept.has(`${n.tick}.${n.pitch}`));
    return [...keep, ...clearRubs(ctx, raw.filter((n) => !kept.has(`${n.tick}.${n.pitch}`)), h)];
}

/** One roll of a take's dice: the notes when the guard passes them; `why`
 *  otherwise, and `end` when no later roll can help (the preset threw).
 *  `tried` carries the rolls seen across a take's calls. */
export type Roll = { notes: Note[] } | { notes: null; why?: string; end?: boolean };

export function rollOption(ctx: GenCtx, p: Preset, v: number[], retry: number, tried: Set<string>): Roll {
    const id = p.seedAs?.(v, ctx) ?? p.id;
    let raw: Note[];
    try {
        raw = p.generate(ctx, v, mix(ctx.seed, hash(id), retry));
    } catch (e) {
        return { notes: null, why: 'threw ' + String((e as Error)?.message ?? e), end: true };
    }
    /* A roll that repeats an earlier one is refused again: shaping and
     * the guard are skipped for it (a chord part whose role a preset
     * breaks rolled all eight times; device: 0.2 s a take, 2026-11-07). */
    const sig = raw.map((n) => `${n.tick}.${n.pitch}.${n.gate}.${n.vel}`).join();
    if (tried.has(sig)) return { notes: null };
    tried.add(sig);
    const g = guard(ctx, offBand(ctx, p, v, raw));
    return g.ok ? { notes: g.notes } : { notes: null, why: g.why };
}

export function generateOption(ctx: GenCtx, p: Preset, v: number[]): Generated {
    let why = 'no output';
    const tried = new Set<string>();
    for (let retry = 0; retry < RETRIES; retry++) {
        const r = rollOption(ctx, p, v, retry, tried);
        if (r.notes) return { notes: r.notes, why: '', retry };
        if (r.why) why = r.why;
        if (r.end) return { notes: null, why, retry };
    }
    return { notes: null, why, retry: RETRIES };
}
