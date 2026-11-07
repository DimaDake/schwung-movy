/* One request, in slices the UI tick can afford (design §7): build the
 * context, then one preset per step, then the selection. `generateAll` runs
 * the same slices in one go, for tests and the bench. */

import { buildCtx, type GenCtx } from './analysis/context.js';
import { generateOption } from './generate.js';
import { buildPlans, planSteps } from './plan.js';
import { defaults, type Preset, serves } from './preset.js';
import { PRESETS } from './presets/catalog.js';
import { type Candidate, scoreCandidate, selectOptions } from './select.js';
import type { GenInput, Note, PresetClass } from './types.js';
import { variantKnobs } from './variant.js';
import { hash } from './rng.js';
import { createTake, selectCreate, TAKES } from './create/takes.js';
import { recentOptions, rememberOptions } from './create/history.js';
import { keepsRole } from './guard.js';

/** An option; `ctx` when it was made in another context than the request's (Step 14's New Clip ones). */
export interface Pick { preset: Preset; knobs: number[]; notes: Note[]; ctx?: GenCtx }

/* One take per slice: a preset's default (`which` -1) or one of its two
 * variants (variant.ts) — one generation per UI tick, however many takes. */
export interface Take { preset: Preset; which: number }
export interface Request { ctx: GenCtx; todo: Take[]; done: Candidate[]; dropped: string[];
    /** The harmony still being built, a stage a tick, before the first take. */
    plans?: Generator<void, GenCtx['plans'], void>;
    /** Step 14 on a clip: the track's New Clip parts, made after Variation's. */
    sub?: Request;
    /** Variation picks a New Clip option replaced: they lead the rest. */
    displaced?: Pick[];
    /** Step 14's own New Clip run: no "offered lately" (create/history.ts), so a Variation stays a function of the Set. */
    inner?: boolean }

/* Step 14's New Clip options (plans/2026-11-01-generator-ux-design.md §2.3):
 * the part the track plays, and a neighbouring one. */
const STEP14: Record<string, [string, string]> = {
    /* WALK, not RIFF: RIFF sits a lead's register (bench method 6 had it at E4 on a bass track). */
    bass: ['n-bass', 'n-walk'], pad: ['n-pad', 'n-stabs'], stabs: ['n-stabs', 'n-chords'], lead: ['n-melody', 'n-counter'],
    arpeggio: ['n-arp', 'n-riff'], drone: ['n-hold', 'n-pad'], drums: ['n-drum-map', 'n-broken'],
};

function step14(input: GenInput, ctx: GenCtx): Request | undefined {
    const ids = STEP14[ctx.drum ? 'drums' : ctx.role?.kind ?? ''];
    if (input.task !== 'variation' || !ids) return undefined;
    const sub = startRequest({ ...input, task: 'create', source: null, nonce: ctx.seed });
    sub.todo = sub.todo.filter((t) => ids.includes(t.preset.id));
    sub.inner = true;
    return sub;
}

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
    const sub = step14(input, ctx);
    return { ctx, todo: PRESETS.filter((p) => serves(p, ctx)).flatMap((preset) => takes.map((which) => ({ preset, which }))),
        done: [], dropped: [], ...(staged ? { plans: planSteps(ctx) } : {}), ...(sub ? { sub } : {}) };
}

/** Runs one stage of the harmony, or one take; true when none is left. */
export function stepRequest(req: Request): boolean {
    if (!req.todo.length && !req.plans && req.sub) return stepRequest(req.sub);
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
        return req.todo.length === 0 && !req.sub;
    }
    const base = defaults(p, req.ctx);
    const knobs = t.which < 0 ? base : variantKnobs(p, req.ctx, base, hash(p.id) ^ req.ctx.seed, t.which);
    if (knobs) {
        const g = generateOption(req.ctx, p, knobs);
        if (g.notes) req.done.push({ preset: p, knobs, notes: g.notes, ...scoreCandidate(req.ctx, p, g.notes, knobs) });
        else if (t.which < 0) req.dropped.push(`${p.id}:${g.why}`);
    }
    return req.todo.length === 0 && !req.sub;
}

export const optionCountFor = (_task: GenInput['task']): number => 6;

export function finishRequest(req: Request, count = optionCountFor(req.ctx.task)): Pick[] {
    if (req.ctx.task === 'create') {
        const picks = selectCreate(req.done, req.inner ? [] : recentOptions(req.ctx.drum));
        if (!req.inner) rememberOptions(req.ctx.drum, picks.map((c) => c.notes));
        return picks.map((c) => ({ preset: c.preset, knobs: c.knobs, notes: c.notes }));
    }
    const picks: Pick[] = selectOptions(req.done, req.ctx.task, count).map((c) => ({ preset: c.preset, knobs: c.knobs, notes: c.notes }));
    /* NUDGE, the small step a Set evolves by, is always option 1 when it
     * made one (presets/var-nudge.ts); the close option it displaces stays
     * past the picks. */
    const nudge = req.ctx.task === 'variation' && !picks.some((p) => p.preset.id === 'v-nudge')
        ? req.done.filter((c) => c.preset.id === 'v-nudge' && c.score >= 0).sort((a, b) => b.score - a.score)[0] : undefined;
    if (nudge && picks.length) {
        const out = picks.map((p) => p.preset.cls).lastIndexOf('close');
        picks.splice(out >= 0 ? out : picks.length - 1, 1);
        picks.unshift({ preset: nudge.preset, knobs: nudge.knobs, notes: nudge.notes });
    }
    if (!req.sub) return picks;
    /* Step 14: the track's own part as the 3rd option, the neighbour last.
     * Made as New Clip, they have no source to keep the role of, so a take
     * that breaks the track's role (a WALK in a lead's register) gives way to
     * one of the preset's others, as a Variation's own options must
     * (guard.ts; the piece bench's role breaks were all these). */
    req.sub.done = req.sub.done.filter((c) => keepsRole(req.ctx, c.notes));
    const made = finishRequest(req.sub).map((p) => ({ ...p, ctx: req.sub!.ctx }));
    const ids = STEP14[req.ctx.drum ? 'drums' : req.ctx.role?.kind ?? ''] ?? [];
    req.displaced = [];
    ids.forEach((id, k) => {
        const m = made.find((p) => p.preset.id === id);
        const at = k === 0 ? Math.min(2, picks.length) : picks.length - 1;
        if (!m || at < 0) return;
        if (at < picks.length) req.displaced!.push(picks[at]);
        picks[at] = m;
    });
    return picks;
}

/** Options a preview can hold: ORIG and these fill the engine's stash
 *  (AI_STASH_SLOTS in engine/crates/seq-core/src/engine/ai_clip.rs). */
export const PREVIEW_MAX = 47;

const FAMILY: PresetClass[] = ['close', 'rhythm', 'exp'];

/** Past the picks (plans/2026-11-01-generator-ux-design.md §2.2): the best
 *  take of every other generator that served this clip, already made and
 *  passed by the guard, in a stable order (family, then name) so one found
 *  once is in the same place next time. New Clip shows all as its picks. */
export function finishExtras(req: Request, picks: Pick[]): Pick[] {
    if (req.ctx.task === 'create') return [];
    const lead = (req.displaced ?? []).filter((d) => !picks.some((p) => p.preset === d.preset));
    const best = new Map<Preset, Candidate>();
    for (const c of req.done) {
        if (c.score < 0 || picks.some((p) => p.preset === c.preset) || lead.some((d) => d.preset === c.preset)) continue;
        const b = best.get(c.preset);
        if (!b || c.score > b.score) best.set(c.preset, c);
    }
    const rest = [...best.values()]
        .sort((a, b) => FAMILY.indexOf(a.preset.cls) - FAMILY.indexOf(b.preset.cls) || a.preset.name.localeCompare(b.preset.name) || a.preset.id.localeCompare(b.preset.id))
        .map((c) => ({ preset: c.preset, knobs: c.knobs, notes: c.notes }));
    return [...lead, ...rest].slice(0, Math.max(0, PREVIEW_MAX - picks.length));
}

export function generateAll(input: GenInput, count?: number): { picks: Pick[]; extras: Pick[]; ctx: GenCtx; dropped: string[] } {
    const req = startRequest(input);
    while (!stepRequest(req));
    const picks = finishRequest(req, count);
    return { picks, extras: finishExtras(req, picks), ctx: req.ctx, dropped: req.dropped };
}

/** A knob turn: the option again at the new positions, or null when the
 *  guard refuses every roll (the caller keeps what is showing). */
export function regenerate(ctx: GenCtx, p: Preset, knobs: number[]): Note[] | null {
    return generateOption(ctx, p, knobs).notes;
}
