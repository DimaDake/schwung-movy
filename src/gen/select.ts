/* Choosing the options (design §4): every preset that serves the part runs at
 * its default knobs; each result is scored on how it sits in the scene; the
 * level's slots are filled per class with the best that are also different
 * enough from each other; the options are shown closest first. */

import type { GenCtx } from './analysis/context.js';
import { chordAt } from './analysis/context.js';
import { isStrong } from './analysis/events.js';
import type { GenLevel } from './types.js';
import type { Preset } from './preset.js';
import { noteFit } from './theory/category.js';
import { BEAT, type Note, type PresetClass, type Task, TPS } from './types.js';

export interface Candidate { preset: Preset; knobs: number[]; notes: Note[]; score: number; dist: number }

/** The bench's gate: two options closer than this are one option. */
export const MIN_PAIR = 0.2;

const cells = (a: Note[]) => new Set(a.map((n) => `${Math.round(n.tick / TPS)}:${n.pitch}`));

/** 0 = the same (step, pitch) set, 1 = nothing in common. */
export function difference(a: Note[], b: Note[]): number {
    const A = cells(a), B = cells(b);
    if (!A.size && !B.size) return 0;
    let both = 0;
    for (const x of A) if (B.has(x)) both++;
    return 1 - both / (A.size + B.size - both);
}

function harmFit(ctx: GenCtx, notes: Note[]): number {
    if (ctx.drum) return 1;
    const chords = ctx.plans[0]?.chords ?? [];
    let s = 0, w = 0;
    for (const n of notes) {
        const c = chordAt(chords, n.tick, ctx.k) ?? chordAt(ctx.srcChords, n.tick, ctx.k);
        const wt = Math.min(n.gate, BEAT);
        s += noteFit(n.pitch, c, ctx.key, isStrong(n.tick)) * wt;
        w += wt;
    }
    return w ? s / w : 1;
}

function grooveFit(notes: Note[]): number {
    if (!notes.length) return 0;
    return notes.filter((n) => Math.abs(n.tick - Math.round(n.tick / (TPS / 2)) * (TPS / 2)) <= 3).length / notes.length;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

function shapeSim(ctx: GenCtx, notes: Note[]): number {
    if (!ctx.src.length || !notes.length) return 0;
    const dens = Math.min(notes.length, ctx.src.length) / Math.max(notes.length, ctx.src.length);
    /* Within a fifth is the same register; beyond it the part has moved. */
    const reg = ctx.drum ? 1 : Math.max(0, 1 - Math.max(0, Math.abs(median(notes.map((n) => n.pitch)) - ctx.mid) - 7) / 7);
    return (dens + reg) / 2;
}

export function scoreCandidate(ctx: GenCtx, p: Preset, notes: Note[]): { score: number; dist: number } {
    const fit = p.fit ? p.fit(ctx) : 0.5;
    /* Every candidate already fits the harmony and the grid fairly well, so
     * what the preset is FOR on this part (its fit) decides most. */
    const score = 0.3 * harmFit(ctx, notes) + 0.1 * grooveFit(notes) + 0.2 * shapeSim(ctx, notes) + 0.4 * fit;
    return { score: fit <= 0 ? -1 : score, dist: difference(notes, ctx.src) };
}

type C = PresetClass;
const SLOTS: Record<Exclude<Task, 'create'>, Record<number, Record<GenLevel, C[]>>> = {
    variation: {
        6: { SAFE: ['close', 'close', 'close', 'close', 'rhythm', 'rhythm'], BALANCED: ['close', 'close', 'rhythm', 'rhythm', 'exp', 'exp'],
            WILD: ['close', 'rhythm', 'rhythm', 'exp', 'exp', 'exp'] },
    },
    double: {
        6: { SAFE: ['close', 'close', 'close', 'rhythm', 'rhythm', 'rhythm'], BALANCED: ['close', 'close', 'rhythm', 'rhythm', 'exp', 'exp'],
            WILD: ['close', 'rhythm', 'rhythm', 'exp', 'exp', 'exp'] },
    },
    quantize: {
        3: { SAFE: ['close', 'rhythm', 'rhythm'], BALANCED: ['close', 'rhythm', 'exp'], WILD: ['rhythm', 'exp', 'exp'] },
    },
};

export function slotsFor(task: Exclude<Task, 'create'>, count: number, level: GenLevel): C[] {
    const t = SLOTS[task][count]?.[level];
    if (t) return t;
    /* Any other count is the full ladder thinned evenly, so three options
     * are three of the six, in the same proportions. */
    const base = SLOTS[task][task === 'quantize' ? 3 : 6][level];
    return Array.from({ length: count }, (_, i) => base[Math.min(base.length - 1, Math.floor((i * base.length) / count))]);
}

const jd = (A: Set<number>, B: Set<number>) => { const u = new Set([...A, ...B]); if (!u.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return 1 - i / u.size; };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** How different two options feel, 0..1, on everything a listener hears:
 *  rhythm, notes, density, register, note lengths and loudness. */
export function spread(a: Note[], b: Note[]): number {
    const steps = (x: Note[]) => new Set(x.map((n) => Math.round(n.tick / TPS)));
    const parts = [
        jd(steps(a), steps(b)),
        difference(a, b),
        Math.abs(a.length - b.length) / Math.max(1, a.length, b.length),
        Math.min(1, Math.abs(median(a.map((n) => n.pitch)) - median(b.map((n) => n.pitch))) / 12),
        Math.min(1, Math.abs(median(a.map((n) => n.gate)) - median(b.map((n) => n.gate))) / (4 * TPS)),
        Math.min(1, Math.abs(avg(a.map((n) => n.vel)) - avg(b.map((n) => n.vel))) / 40),
    ];
    return avg(parts);
}

export function selectOptions(cands: Candidate[], task: Task, count: number, level: GenLevel): Candidate[] {
    const pool = cands.filter((c) => c.score >= 0).sort((a, b) => b.score - a.score);
    const chosen: Candidate[] = [];
    const farEnough = (c: Candidate) => chosen.every((x) => x.preset !== c.preset && difference(x.notes, c.notes) >= MIN_PAIR);
    /* The first option is the best fit; every next one is the best fit that
     * also adds the most that is new — the user wants options that differ in
     * rhythm, notes and feel, not three takes of one idea. */
    const value = (c: Candidate) => (chosen.length ? 0.45 * c.score + 0.55 * Math.min(...chosen.map((x) => spread(x.notes, c.notes))) : c.score);
    const take = (ok: (c: Candidate) => boolean) => {
        let best: Candidate | null = null;
        for (const x of pool) if (!chosen.includes(x) && ok(x) && (!best || value(x) > value(best))) best = x;
        if (best) chosen.push(best);
        return !!best;
    };
    for (const cls of slotsFor(task === 'create' ? 'variation' : task, count, level)) {
        if (chosen.length >= count) break;
        take((c) => c.preset.cls === cls && farEnough(c)) || take(farEnough);
    }
    /* Too few that differ enough: the best of the rest still beats nothing. */
    while (chosen.length < Math.min(count, pool.length) && take((c) => !chosen.some((x) => x.preset === c.preset)));
    while (chosen.length < Math.min(count, pool.length) && take(() => true));
    /* Shown closest first; Smart Quantize's option 1 is always its tightest
     * (the first pick, from the close class), the rest after it. */
    if (task === 'quantize' && chosen.length) return [chosen[0], ...chosen.slice(1).sort((a, b) => a.dist - b.dist)];
    return chosen.sort((a, b) => a.dist - b.dist);
}
