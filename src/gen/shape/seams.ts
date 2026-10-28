/* Smart Double (plans/2026-10-28-smart-double-design.md): the clip played
 * twice, and only its seams rewritten — the ENDING before the loop comes
 * round and, with SEAMS on BOTH, a shorter one where the first half hands
 * over to the second. Everything else is the clip as played, so the first
 * part stays the user's. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { toEvents } from '../analysis/events.js';
import { custom, type KnobDef } from '../knobs.js';
import type { Chord, Ev, Note } from '../types.js';
import { TPS } from '../types.js';

export const ENDING_STEPS = [2, 4, 8, 16, 32];
const ENDING_NAMES = ['1/2 BEAT', '1 BEAT', '2 BEATS', '1 BAR', '2 BARS'];

/** The clip before doubling, in ticks. */
export const halfOf = (ctx: GenCtx): number => ctx.end / 2;

/* An ending never takes more than half of the clip it ends. */
const endings = (ctx: GenCtx) => Math.max(1, ENDING_STEPS.filter((s) => 2 * s * TPS <= halfOf(ctx)).length);

/** ENDING opens at about a quarter of the clip, at least a beat. */
export const ENDING: KnobDef = { ...custom('ENDING', ENDING_NAMES), steps: endings,
    def: (c) => Math.min(endings(c) - 1, Math.max(0, ENDING_STEPS.filter((s) => s * TPS <= Math.max(4 * TPS, halfOf(c) / 4)).length - 1)) };

export const SEAMS: KnobDef = custom('SEAMS', ['END', 'BOTH']);

export interface Seam { from: number; to: number; main: boolean }

/** The windows a generator rewrites: the clip's last ENDING, and with BOTH
 *  half of it again before the second half starts. */
export function seams(ctx: GenCtx, ending: number, both = 0): Seam[] {
    const len = ENDING_STEPS[Math.min(ending, ENDING_STEPS.length - 1)] * TPS;
    const h = halfOf(ctx);
    const out: Seam[] = [{ from: ctx.end - len, to: ctx.end, main: true }];
    if (both) out.unshift({ from: h - Math.max(TPS * 2, len / 2), to: h, main: false });
    return out;
}

const inside = (s: Seam, t: number) => t >= s.from && t < s.to;

/** The source's notes that start in a seam. */
export const notesIn = (ctx: GenCtx, s: Seam): Note[] => ctx.src.filter((n) => inside(s, n.tick));

/** The doubled clip with each seam's notes replaced by `make`'s; a kept note
 *  still sounding when a new one starts stops there, so a line stays one line;
 *  with `stop`, at the seam itself (the ending is a silence). */
export function rewrite(ctx: GenCtx, ss: Seam[], make: (s: Seam, was: Note[]) => Note[], stop = false): Note[] {
    const add = ss.flatMap((s) => make(s, notesIn(ctx, s)).filter((n) => inside(s, n.tick)));
    const cuts = [...add.map((a) => a.tick), ...(stop ? ss.map((s) => s.from) : [])];
    const keep = ctx.src.filter((n) => !ss.some((s) => inside(s, n.tick))).map((n) => {
        const at = cuts.filter((t) => t > n.tick && t < n.tick + n.gate);
        return at.length ? { ...n, gate: Math.min(...at) - n.tick } : n;
    });
    return [...keep, ...add];
}

/** What every seam leads into: the clip's first onset (both halves open on it). */
export const nextEv = (ctx: GenCtx): Ev | null => toEvents(ctx.src)[0] ?? null;

/** The scene's chord under a tick. */
export const chordUnder = (ctx: GenCtx, tick: number): Chord | null =>
    chordAt(ctx.plans[0]?.chords ?? [], tick, ctx.k) ?? chordAt(ctx.srcChords, tick, ctx.k);

/** The line's note of an onset: a bass's lowest, any other part's highest. */
export const lineOf = (ctx: GenCtx, e: Ev): number =>
    (ctx.role?.kind === 'bass' ? e.voices[0] : e.voices[e.voices.length - 1]).pitch;

export const chordPart = (ctx: GenCtx): boolean => ctx.role?.kind === 'pad' || ctx.role?.kind === 'stabs';

/** How hard the part plays: the median velocity of what it replaces, else of the clip. */
export function velOf(ctx: GenCtx, was: Note[]): number {
    const v = (was.length ? was : ctx.src).map((n) => n.vel).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : 100;
}

/** Onsets on a grid of `every` ticks filling the last `n` of a seam. */
export function gridIn(s: Seam, every: number, n = Infinity): number[] {
    const out: number[] = [];
    for (let t = s.to - every; t >= s.from && out.length < n; t -= every) out.unshift(t);
    return out;
}
