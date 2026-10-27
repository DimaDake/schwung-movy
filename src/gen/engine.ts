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

export interface Pick { preset: Preset; knobs: number[]; notes: Note[] }

export interface Request { ctx: GenCtx; todo: Preset[]; done: Candidate[]; dropped: string[] }

export function prepare(input: GenInput): GenCtx {
    const ctx = buildCtx(input);
    ctx.plans = buildPlans(ctx);
    return ctx;
}

export function startRequest(input: GenInput): Request {
    const ctx = prepare(input);
    return { ctx, todo: PRESETS.filter((p) => serves(p, ctx)), done: [], dropped: [] };
}

/** Runs one preset; true when none is left. */
export function stepRequest(req: Request): boolean {
    const p = req.todo.shift();
    if (!p) return true;
    const knobs = defaults(p, req.ctx);
    const g = generateOption(req.ctx, p, knobs);
    if (g.notes) req.done.push({ preset: p, knobs, notes: g.notes, ...scoreCandidate(req.ctx, p, g.notes) });
    else req.dropped.push(`${p.id}:${g.why}`);
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
