/* Smart Quantize that mutates (plans/2026-10-29-quantize-mutations.md; user,
 * 2026-10-29: "more options to mutate current clip … they should originate
 * from the current clip, not from scratch"). Each takes the clip as played,
 * on the grid by TIMING, and changes one thing about it: some pitches, the
 * mode, the contour, the octaves, repeats, its place in the bar, or its
 * feel. The rhythm and the notes that are left are the player's. */

import type { GenCtx } from '../analysis/context.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { mix, rng } from '../rng.js';
import { clearRubs } from '../shape/band-pitch.js';
import { dynamics } from '../shape/dynamics.js';
import { fixChords, fixDefault, fixWorst } from '../shape/pitch.js';
import { humanize, invert, MODES, mutatePitches, octaves, ratchet, rotate, toMode } from '../shape/mutate.js';
import { timing } from '../shape/time.js';
import { BAR, type Note, TPS } from '../types.js';

/* Smart Quantize skips the band check (it fixes the player's own notes); a
 * mutation that moves pitches puts it back for the notes it moved. */
function offRubs(ctx: GenCtx, notes: Note[], from: Note[]): Note[] {
    const kept = new Set(from.map((n) => `${n.tick}.${n.pitch}`));
    const same = notes.filter((n) => kept.has(`${n.tick}.${n.pitch}`));
    return [...same, ...clearRubs(ctx, notes.filter((n) => !kept.has(`${n.tick}.${n.pitch}`)), 0)];
}

/** The clip on the grid by TIMING with TIGHT's default pitch fix (the slips
 *  off the harmony put right): what every mutation starts from. */
export function tightSrc(ctx: GenCtx, v: number): Note[] {
    const t = timing(ctx, ctx.src, v / 10, ctx.groove.grid, ctx.groove.swing);
    return ctx.drum ? t : fixWorst(ctx, t, fixDefault(ctx, 4), fixChords(ctx));
}

/* Where a change lands: the whole clip, its second half, every other bar,
 * or the last bar only (an answer at the end of the loop). */
const WHERE = ['ALL', '2ND HALF', 'ODD BARS', 'LAST BAR'] as const;
export function whereOf(ctx: GenCtx, w: number): (n: Note) => boolean {
    const bars = Math.max(1, Math.round(ctx.end / BAR));
    const bar = (n: Note) => Math.floor(n.tick / BAR);
    if (w === 1) return (n) => n.tick >= ctx.end / 2;
    if (w === 2) return (n) => bar(n) % 2 === 1 || bars === 1;
    if (w === 3) return (n) => bar(n) === bars - 1;
    return () => true;
}
const where = (def: number) => custom('WHERE', WHERE, def);

/* Ratchet rates, fastest first: 1/32, 1/16 triplet, 1/16. */
export const RATES: [string, number][] = [['1/32', TPS / 2], ['1/16T', Math.round((TPS * 2) / 3)], ['1/16', TPS]];

const LINES = ['lead', 'arpeggio', 'bass'] as const;

export const MUTATE: Preset = {
    id: 'q-mutate', name: 'MUTATE', task: 'quantize', drum: false, cls: 'exp', fit: () => 0.5,
    knobs: [K.timing(10), count('AMOUNT', 10, 3), custom('STEPS', ['1', '2', '3', '4'], 1), K.seed()],
    generate: (ctx, v) => {
        const src = tightSrc(ctx, v[0]);
        return offRubs(ctx, mutatePitches(ctx, src, v[1], v[2] + 1, fixChords(ctx), rng(mix(ctx.seed, v[3], 0x6d75))), src);
    },
};

/* A mode is the clip's whole colour: against other tracks still in the old
 * one every third clashes, so MODE is offered on a clip that plays alone. */
export const MODE: Preset = {
    id: 'q-mode', name: 'MODE', task: 'quantize', drum: false, cls: 'exp', fit: () => 0.45, accepts: (ctx) => ctx.alone,
    knobs: [K.timing(10), custom('MODE', MODES.map((m) => m[0]), 0), where(0), K.dynamics(0)],
    generate: (ctx, v) => dynamics(toMode(ctx, tightSrc(ctx, v[0]), v[1], whereOf(ctx, v[2])), v[3]),
};

const PIVOTS = ['FIRST', 'LOW', 'MID', 'HIGH'] as const;

export const INVERT: Preset = {
    id: 'q-invert', name: 'INVERT', task: 'quantize', drum: false, cls: 'exp', fit: () => 0.45, roles: [...LINES],
    knobs: [K.timing(10), where(1), custom('PIVOT', PIVOTS, 2), K.pitchFix(3)],
    generate: (ctx, v) => {
        const src = tightSrc(ctx, v[0]);
        if (!src.length) return [];
        const ps = src.map((n) => n.pitch).sort((a, b) => a - b);
        const first = [...src].sort((a, b) => a.tick - b.tick)[0].pitch;
        const pivot = [first, ps[0], ps[Math.floor(ps.length / 2)], ps[ps.length - 1]][v[2]];
        return offRubs(ctx, fixWorst(ctx, invert(ctx, src, pivot, whereOf(ctx, v[1])), v[3], fixChords(ctx)), src);
    },
};

export const OCTAVES: Preset = {
    id: 'q-octaves', name: 'OCTAVES', task: 'quantize', drum: false, cls: 'rhythm', fit: () => 0.5, roles: [...LINES],
    knobs: [K.timing(10), count('AMOUNT', 10, 4), custom('DIRECTION', ['UP', 'DOWN', 'BOTH'], 2), K.seed()],
    generate: (ctx, v) => {
        const src = tightSrc(ctx, v[0]);
        return offRubs(ctx, octaves(src, v[1], [1, -1, 0][v[2]], rng(mix(ctx.seed, v[3], 0x6f63))), src);
    },
};

export const RATCHET: Preset = {
    id: 'q-ratchet', name: 'RATCHET', task: 'quantize', drum: false, cls: 'rhythm', fit: () => 0.5,
    knobs: [K.timing(10), count('AMOUNT', 10, 3), custom('RATE', RATES.map((x) => x[0]), 0), count('DECAY', 10, 3)],
    generate: (ctx, v) => ratchet(tightSrc(ctx, v[0]), v[1], RATES[v[2]][1], v[3], rng(mix(ctx.seed, 0x7261)), ctx.end),
};

/* SHIFT: the clip moved in the bar, -4 to +4 sixteenths (0 in the middle). */
const SHIFTS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

export const SHIFT: Preset = {
    id: 'q-shift', name: 'SHIFT', task: 'quantize', drum: false, cls: 'rhythm', fit: () => 0.45,
    knobs: [K.timing(10), custom('STEPS', SHIFTS.map((s) => (s > 0 ? '+' : '') + s + '/16'), 6),
        custom('KEEP', ['NONE', 'DOWNBEATS'], 1), K.length(5)],
    generate: (ctx, v) => {
        const keep = v[2] === 1 ? (n: Note) => n.tick % BAR < TPS / 2 : () => false;
        const out = rotate(tightSrc(ctx, v[0]), SHIFTS[v[1]], ctx.end, keep);
        return v[3] === 5 ? out : out.map((n) => ({ ...n, gate: Math.max(1, Math.round(n.gate * (0.5 + v[3] * 0.1))) }));
    },
};

export const HUMANIZE: Preset = {
    id: 'q-humanize', name: 'HUMANIZE', task: 'quantize', drum: false, cls: 'close', fit: () => 0.55,
    knobs: [count('LOOSE', 10, 3), count('VELOCITY', 10, 4), count('LENGTH', 10, 3), K.seed()],
    generate: (ctx, v) => humanize(tightSrc(ctx, 10), v[0], v[1], v[2], rng(mix(ctx.seed, v[3], 0x6875)), ctx.end),
};
