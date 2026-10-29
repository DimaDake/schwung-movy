/* One request, in slices the UI tick can afford (design §7): build the
 * context, then one preset per step, then the selection. `generateAll` runs
 * the same slices in one go, for tests and the bench. */

import { buildCtx, type GenCtx } from './analysis/context.js';
import { generateOption } from './generate.js';
import { buildPlans, planSteps } from './plan.js';
import { defaults, type Preset, serves } from './preset.js';
import { PRESETS } from './presets/catalog.js';
import { type Candidate, scoreCandidate, selectOptions } from './select.js';
import type { GenInput, Note } from './types.js';
import { variantKnobs } from './variant.js';
import { hash } from './rng.js';
import { createTake, selectCreate, TAKES } from './create/takes.js';
import { recentOptions, rememberOptions } from './create/history.js';

export interface Pick { preset: Preset; knobs: number[]; notes: Note[] }

/* One take per slice: a preset's default (`which` -1) or one of its two
 * variants (variant.ts) — one generation per UI tick, however many takes. */
export interface Take { preset: Preset; which: number }
export interface Request { ctx: GenCtx; todo: Take[]; done: Candidate[]; dropped: string[];
    /** The harmony still being built, a stage a tick, before the first take. */
    plans?: Generator<void, GenCtx['plans'], void> }

export function prepare(input: GenInput): GenCtx {
    const ctx = buildCtx(input);
    ctx.plans = buildPlans(ctx);
    return ctx;
}

export function startRequest(input: GenInput): Request {
    const ctx = buildCtx(input);
    /* Only New Clip's map is staged; a preset's `accepts` may read the others' plans. */
    const staged = ctx.task === 'create';
    if (!staged) ctx.plans = buildPlans(ctx);
    const takes = staged ? Array.from({ length: TAKES }, (_, i) => i) : [-1, 0, 1];
    return { ctx, todo: PRESETS.filter((p) => serves(p, ctx)).flatMap((preset) => takes.map((which) => ({ preset, which }))),
        done: [], dropped: [], ...(staged ? { plans: planSteps(ctx) } : {}) };
}

/** Runs one stage of the harmony, or one take; true when none is left. */
export function stepRequest(req: Request): boolean {
    if (req.plans) {
        const r = req.plans.next();
        if (r.done) { req.ctx.plans = r.value; req.plans = undefined; }
        return false;
    }
    const t = req.todo.shift();
    if (!t) return true;
    const p = t.preset;
    if (req.ctx.task === 'create') {
        const c = createTake(p, req.ctx, t.which);
        if (c) req.done.push(c);
        else if (t.which === 0) req.dropped.push(`${p.id}:unmeaning`);
        return req.todo.length === 0;
    }
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
    if (req.ctx.task === 'create') {
        const picks = selectCreate(req.done, recentOptions(req.ctx.drum));
        rememberOptions(req.ctx.drum, picks.map((c) => c.notes));
        return picks.map((c) => ({ preset: c.preset, knobs: c.knobs, notes: c.notes }));
    }
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
