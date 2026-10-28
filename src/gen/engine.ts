/* One request, in slices the UI tick can afford (design §7): build the
 * context, then one preset per step, then the selection. `generateAll` runs
 * the same slices in one go, for tests and the bench. */

import { buildCtx, type GenCtx } from './analysis/context.js';
import { generateOption } from './generate.js';
import { buildPlans } from './plan.js';
import { defaults, type Preset, serves } from './preset.js';
import { PRESETS } from './presets/catalog.js';
import { type Candidate, scoreCandidate, selectOptions } from './select.js';
import type { GenInput, Note } from './types.js';
import { variantKnobs } from './variant.js';
import { hash } from './rng.js';

export interface Pick { preset: Preset; knobs: number[]; notes: Note[] }

/* One take per slice: a preset's default (`which` -1) or one of its two
 * variants (variant.ts) — one generation per UI tick, however many takes. */
export interface Take { preset: Preset; which: number }
export interface Request { ctx: GenCtx; todo: Take[]; done: Candidate[]; dropped: string[] }

export function prepare(input: GenInput): GenCtx {
    const ctx = buildCtx(input);
    ctx.plans = buildPlans(ctx);
    return ctx;
}

export function startRequest(input: GenInput): Request {
    const ctx = prepare(input);
    return { ctx, todo: PRESETS.filter((p) => serves(p, ctx)).flatMap((preset) => [-1, 0, 1].map((which) => ({ preset, which }))),
        done: [], dropped: [] };
}

/** Runs one take; true when none is left. */
export function stepRequest(req: Request): boolean {
    const t = req.todo.shift();
    if (!t) return true;
    const p = t.preset;
    const base = defaults(p, req.ctx);
    const knobs = t.which < 0 ? base : variantKnobs(p, req.ctx, base, hash(p.id) ^ req.ctx.seed, t.which);
    if (knobs) {
        const g = generateOption(req.ctx, p, knobs);
        if (g.notes) req.done.push({ preset: p, knobs, notes: g.notes, ...scoreCandidate(req.ctx, p, g.notes) });
        else if (t.which < 0) req.dropped.push(`${p.id}:${g.why}`);
    }
    return req.todo.length === 0;
}

export const optionCountFor = (task: GenInput['task']): number => (task === 'quantize' ? 3 : 6);

export function finishRequest(req: Request, count = optionCountFor(req.ctx.task)): Pick[] {
    return selectOptions(req.done, req.ctx.task, count, req.ctx.input.level)
        .map((c) => ({ preset: c.preset, knobs: c.knobs, notes: c.notes }));
}

export function generateAll(input: GenInput, count?: number): { picks: Pick[]; ctx: GenCtx; dropped: string[] } {
    const req = startRequest(input);
    while (!stepRequest(req));
    return { picks: finishRequest(req, count), ctx: req.ctx, dropped: req.dropped };
}

/** A knob turn: the option again at the new positions, or null when the
 *  guard refuses every roll (the caller keeps what is showing). */
export function regenerate(ctx: GenCtx, p: Preset, knobs: number[]): Note[] | null {
    return generateOption(ctx, p, knobs).notes;
}
