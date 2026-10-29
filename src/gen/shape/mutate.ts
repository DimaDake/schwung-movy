/* Mutations of the player's own clip (plans/2026-10-29-quantize-mutations.md):
 * Smart Quantize's options that change the clip rather than only tighten
 * it. Every one works on the clip's notes as played (quantized first), so
 * the result is that clip mutated, never a part from scratch. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import type { Rng } from '../rng.js';
import { degreeIndex, nearestPitch, pc, stepScale } from '../theory/pc.js';
import { type Chord, type Note, TPS } from '../types.js';

const clampP = (p: number) => Math.max(24, Math.min(108, p));
const weak = (n: Note) => strength(n.tick) < 0.7;

/** The top note of each chord struck (all of a line): a chord part keeps
 *  its voicing and only its top moves. */
function tops(notes: Note[]): Set<Note> {
    const at = new Map<number, Note>();
    for (const n of notes) { const t = at.get(n.tick); if (!t || n.pitch > t.pitch) at.set(n.tick, n); }
    return new Set(at.values());
}

/** Some notes moved by up to `steps` scale steps; at AMOUNT past half the
 *  strong beats too, kept on a chord tone. Seeded, so a turn is repeatable. */
export function mutatePitches(ctx: GenCtx, notes: Note[], amount: number, steps: number, chords: (Chord | null)[], r: Rng): Note[] {
    const movable = tops(notes);
    return notes.map((n) => {
        const roll = r(), dir = r() < 0.5 ? -1 : 1, by = 1 + Math.floor(r() * steps);
        if (!movable.has(n) || roll >= amount / 10 || (!weak(n) && amount <= 5)) return { ...n };
        let p = stepScale(n.pitch, dir * by, ctx.key);
        const c = chordAt(chords, n.tick, ctx.k);
        if (!weak(n) && c) p = nearestPitch(p, c.pcs);
        return { ...n, pitch: clampP(p) };
    });
}

/* Modes over the clip's tonic, as semitones per scale degree. */
export const MODES: [string, number[]][] = [
    ['PARALLEL', []], ['DORIAN', [0, 2, 3, 5, 7, 9, 10]], ['PHRYGIAN', [0, 1, 3, 5, 7, 8, 10]], ['LYDIAN', [0, 2, 4, 6, 7, 9, 11]],
    ['MIXOLYDIAN', [0, 2, 4, 5, 7, 9, 10]], ['HARMONIC', [0, 2, 3, 5, 7, 8, 11]], ['MELODIC', [0, 2, 3, 5, 7, 9, 11]], ['LOCRIAN', [0, 1, 3, 5, 6, 8, 10]],
];
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];

/** Each note on the same degree of another mode of the clip's tonic (the
 *  parallel one: major↔minor); a chromatic note keeps its offset. */
export function toMode(ctx: GenCtx, notes: Note[], mode: number, where: (n: Note) => boolean): Note[] {
    const from = ctx.key.minor ? MIN : MAJ;
    const to = MODES[mode][1].length ? MODES[mode][1] : ctx.key.minor ? MAJ : MIN;
    return notes.map((n) => {
        const d = from.indexOf(pc(n.pitch - ctx.key.tonic));
        return d < 0 || !where(n) ? { ...n } : { ...n, pitch: n.pitch + to[d] - from[d] };
    });
}

/** The line mirrored in the key around `pivot`: a step up becomes a step down. */
export function invert(ctx: GenCtx, notes: Note[], pivot: number, where: (n: Note) => boolean): Note[] {
    const at = degreeIndex(pivot, ctx.key);
    return notes.map((n) => (where(n) ? { ...n, pitch: clampP(stepScale(pivot, at - degreeIndex(n.pitch, ctx.key), ctx.key)) } : { ...n }));
}

/** Off-beat notes thrown an octave up (dir 1), down (-1) or either (0). */
export function octaves(notes: Note[], amount: number, dir: number, r: Rng): Note[] {
    return notes.map((n) => {
        const roll = r(), d = dir || (r() < 0.5 ? -1 : 1);
        return weak(n) && roll < amount / 10 ? { ...n, pitch: clampP(n.pitch + 12 * d) } : { ...n };
    });
}

/* A ratchet is four strikes at most, on at most half the notes, so the clip
 * stays itself (bench: eight 1/32s a note made it three times as dense). */
const STRIKES = 4;

/** Some notes re-struck at `rate` ticks over their length (a drum's over
 *  the gap to the next hit, `maxSpan` at most), each repeat `decay` softer. */
export function ratchet(notes: Note[], amount: number, rate: number, decay: number, r: Rng, end: number,
    pick: (n: Note) => boolean = () => true, maxSpan = 4 * TPS): Note[] {
    const out: Note[] = [];
    const sorted = [...notes].sort((a, b) => a.tick - b.tick);
    sorted.forEach((n, i) => {
        const nextSame = sorted.slice(i + 1).find((x) => x.pitch === n.pitch)?.tick ?? end;
        const span = Math.min(Math.max(n.gate, 2 * TPS), nextSame - n.tick, maxSpan, STRIKES * rate);
        if (!pick(n) || r() >= amount / 20 || span < 2 * rate) { out.push({ ...n }); return; }
        for (let k = 0, t = n.tick; t < n.tick + span && t < end; k++, t += rate) {
            out.push({ ...n, tick: t, gate: Math.max(1, Math.min(rate - 1, n.gate)), vel: Math.max(1, Math.round(n.vel * Math.pow(1 - decay / 25, k))) });
        }
    });
    return out;
}

/** The clip rotated by `steps` sixteenths, wrapping; `keep` notes stay. */
export function rotate(notes: Note[], steps: number, end: number, keep: (n: Note) => boolean = () => false): Note[] {
    const by = steps * TPS;
    return notes.map((n) => (keep(n) ? { ...n } : { ...n, tick: (((n.tick + by) % end) + end) % end }));
}

/** Played again by a person: timing, velocity and length loosened. */
export function humanize(notes: Note[], loose: number, vel: number, len: number, r: Rng, end: number): Note[] {
    return notes.map((n) => {
        const dt = Math.round((r() * 2 - 1) * loose * TPS * 0.03);
        const dv = Math.round((r() * 2 - 1) * vel * 2.5);
        const g = n.gate * (1 + (r() * 2 - 1) * len * 0.04);
        return { ...n, tick: Math.max(0, Math.min(end - 1, n.tick + dt)), vel: Math.max(1, Math.min(127, n.vel + dv)), gate: Math.max(1, Math.round(g)) };
    });
}
