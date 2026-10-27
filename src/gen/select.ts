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
import { BEAT, type Note, type PresetClass, TPS } from './types.js';

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
const SLOTS: Record<'variation' | 'quantize', Record<number, Record<GenLevel, C[]>>> = {
    variation: {
        6: { SAFE: ['close', 'close', 'close', 'close', 'rhythm', 'rhythm'], BALANCED: ['close', 'close', 'close', 'rhythm', 'rhythm', 'exp'],
            WILD: ['close', 'close', 'rhythm', 'rhythm', 'exp', 'exp'] },
    },
    quantize: {
        3: { SAFE: ['close', 'rhythm', 'rhythm'], BALANCED: ['close', 'rhythm', 'exp'], WILD: ['rhythm', 'exp', 'exp'] },
    },
};

export function slotsFor(task: 'variation' | 'quantize', count: number, level: GenLevel): C[] {
    const t = SLOTS[task][count]?.[level];
    if (t) return t;
    /* Any other count is the full ladder thinned evenly, so three options
     * are three of the six, in the same proportions. */
    const base = SLOTS[task][task === 'variation' ? 6 : 3][level];
    return Array.from({ length: count }, (_, i) => base[Math.min(base.length - 1, Math.floor((i * base.length) / count))]);
}

export function selectOptions(cands: Candidate[], task: 'variation' | 'quantize', count: number, level: GenLevel): Candidate[] {
    const pool = cands.filter((c) => c.score >= 0).sort((a, b) => b.score - a.score);
    const chosen: Candidate[] = [];
    const farEnough = (c: Candidate) => chosen.every((x) => difference(x.notes, c.notes) >= MIN_PAIR);
    const take = (ok: (c: Candidate) => boolean) => {
        const c = pool.find((x) => !chosen.includes(x) && ok(x));
        if (c) chosen.push(c);
        return !!c;
    };
    for (const cls of slotsFor(task, count, level)) {
        if (chosen.length >= count) break;
        take((c) => c.preset.cls === cls && farEnough(c)) || take(farEnough);
    }
    /* Too few that differ enough: the best of the rest still beats nothing. */
    while (chosen.length < Math.min(count, pool.length) && take(() => true));
    return chosen.sort((a, b) => a.dist - b.dist);
}
