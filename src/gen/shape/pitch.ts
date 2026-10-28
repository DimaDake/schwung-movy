/* Pitch stages for Smart Quantize: pitchFix moves every note whose fit
 * (category × position, theory/category.ts) is below a bar — 0 fixes
 * nothing, 10 leaves only chord tones; the PITCH FIX knob fixes the worst N
 * (fixWorst); EMBELLISH adds grace, passing and neighbour notes the way a
 * player would. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { isStrong } from '../analysis/events.js';
import type { Rng } from '../rng.js';
import type { Chord, Note } from '../types.js';
import { TPS } from '../types.js';
import { colourPcs, noteFit } from '../theory/category.js';
import { nearestPitch, pc } from '../theory/pc.js';

export function pitchFix(ctx: GenCtx, notes: Note[], v: number, chords: (Chord | null)[]): Note[] {
    if (v <= 0) return notes;
    const bar = (v / 10) * 0.95;
    return notes.map((n) => {
        const c = chordAt(chords, n.tick, ctx.k);
        const strong = isStrong(n.tick);
        if (!c || noteFit(n.pitch, c, ctx.key, strong) >= bar) return n;
        const ok = [...c.pcs, ...colourPcs(c, ctx.key)].filter((p) => noteFit(p, c, ctx.key, strong) >= bar);
        return { ...n, pitch: nearestPitch(n.pitch, ok.length ? ok : c.pcs) };
    });
}

/** Smart Quantize's harmony: the scene's chords the part is fixed to. */
export const fixChords = (ctx: GenCtx): (Chord | null)[] => ctx.plans[0]?.chords ?? ctx.fixedChords;

const FIXED = 0.95;     // a colour tone on a weak beat (0.9) is still a candidate; a chord tone is not

function fits(ctx: GenCtx, notes: Note[], chords: (Chord | null)[]): { i: number; f: number }[] {
    return notes.map((n, i) => {
        const c = chordAt(chords, n.tick, ctx.k);
        return { i, f: c ? noteFit(n.pitch, c, ctx.key, isStrong(n.tick)) : 1 };
    }).filter((x) => x.f < FIXED).sort((a, b) => a.f - b.f || notes[a.i].tick - notes[b.i].tick);
}

/** How many notes of the part PITCH FIX can move (its knob's last position,
 *  ALL, moves every one; the knob has no more positions than that, at most 10). */
export const fixable = (ctx: GenCtx): number => Math.min(10, fits(ctx, onGrid(ctx), fixChords(ctx)).length);

/** Where PITCH FIX opens: the notes the old bar `v` (0..10) would have fixed. */
export const fixDefault = (ctx: GenCtx, v: number): number =>
    Math.min(fixable(ctx), fits(ctx, onGrid(ctx), fixChords(ctx)).filter((x) => x.f < (v / 10) * 0.95).length);

/* Counted where the notes will land: a note played just before the beat is
 * judged on the beat, as the quantized take it is fixed in will have it. */
const onGrid = (ctx: GenCtx): Note[] => ctx.src.map((n) => ({ ...n, tick: Math.round(n.tick / TPS) * TPS }));

/** PITCH FIX as a count (bench 2026-10-29: as a bar, 84% of its clicks
 *  changed nothing — a take holds a few wrong notes, and the bar only moved
 *  past them on one click in several): the `n` worst notes onto the nearest
 *  chord tone, or all of them from the last position on, which leaves only
 *  chord tones as the bar's top did. Each click fixes one note more. */
export function fixWorst(ctx: GenCtx, notes: Note[], n: number, chords: (Chord | null)[]): Note[] {
    if (n <= 0) return notes;
    const all = fits(ctx, notes, chords);
    const pick = new Set((n >= fixable(ctx) ? all : all.slice(0, n)).map((x) => x.i));
    return notes.map((x, i) => {
        if (!pick.has(i)) return x;
        const c = chordAt(chords, x.tick, ctx.k)!;
        return { ...x, pitch: nearestPitch(x.pitch, c.pcs) };
    });
}

export type Ornament = 'grace' | 'passing' | 'neighbour';
export const ORNAMENTS: Ornament[] = ['grace', 'passing', 'neighbour'];

/** Up to `count` ornaments of a kind, on the strongest places for one. */
export function embellish(ctx: GenCtx, notes: Note[], count: number, kind: Ornament, r: Rng, chords: (Chord | null)[]): Note[] {
    if (count <= 0 || !notes.length) return notes;
    const sorted = [...notes].sort((a, b) => a.tick - b.tick);
    const taken = new Set(sorted.map((n) => Math.round(n.tick / (TPS / 2))));
    const cands: Note[] = [];
    sorted.forEach((n, i) => {
        const next = sorted.slice(i + 1).find((x) => x.tick > n.tick);
        const c = chordAt(chords, n.tick, ctx.k);
        const tones = c ? [...c.pcs, ...colourPcs(c, ctx.key)] : [pc(n.pitch)];
        if (kind === 'grace' && n.tick >= TPS / 2 && isStrong(n.tick)) {
            const t = n.tick - TPS / 2;
            if (!taken.has(Math.round(t / (TPS / 2)))) cands.push({ tick: t, gate: TPS / 2, pitch: n.pitch + (r() < 0.5 ? -1 : 2), vel: Math.round(n.vel * 0.7) });
        } else if (kind === 'passing' && next && next.tick - n.tick >= TPS * 2 && Math.abs(next.pitch - n.pitch) >= 3) {
            const t = n.tick + Math.round((next.tick - n.tick) / 2 / TPS) * TPS;
            const want = Math.round((n.pitch + next.pitch) / 2);
            if (!taken.has(Math.round(t / (TPS / 2)))) cands.push({ tick: t, gate: TPS, pitch: nearestPitch(want, tones), vel: Math.round(n.vel * 0.8) });
        } else if (kind === 'neighbour' && n.gate >= TPS * 3) {
            const t = n.tick + TPS;
            const up = nearestPitch(n.pitch + 2, tones, n.pitch + 1, n.pitch + 3);
            if (!taken.has(Math.round(t / (TPS / 2)))) cands.push({ tick: t, gate: TPS, pitch: up, vel: Math.round(n.vel * 0.75) });
        }
    });
    const chosen = cands.map((c) => ({ c, w: r() })).sort((a, b) => a.w - b.w).slice(0, count).map((x) => x.c);
    /* The note an ornament now interrupts is shortened to make room. */
    const out = notes.map((n) => {
        const cut = chosen.find((c) => c.tick > n.tick && c.tick < n.tick + n.gate && c.pitch !== n.pitch);
        return cut && kind !== 'neighbour' ? { ...n, gate: Math.max(TPS / 2, cut.tick - n.tick) } : n;
    });
    return [...out, ...chosen.filter((c) => c.tick >= 0 && c.tick < ctx.end)].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}
