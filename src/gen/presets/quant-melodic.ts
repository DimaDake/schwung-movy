/* Smart Quantize for melodic parts: the clip on the scene's groove and
 * harmony, then — as the level rises — shaped and developed a little
 * ("it is not only boring quantize but can actually update your clip"). */

import type { GenCtx } from '../analysis/context.js';
import { fromEvents, toEvents } from '../analysis/events.js';
import { GRIDS } from '../analysis/groove.js';
import { count, custom, K, type KnobDef } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { realiseChords } from '../realise/chords.js';
import { dynamics } from '../shape/dynamics.js';
import { velocity } from '../shape/velocity.js';
import { clean } from '../shape/drums.js';
import { embellish, fixChords, fixWorst, ORNAMENTS } from '../shape/pitch.js';
import { FEELS, feelLand, lengthStage, timing } from '../shape/time.js';
import { rhythmStage } from '../shape/rhythm.js';
import { densityStage } from '../shape/density.js';
import { stepScale } from '../theory/pc.js';
import type { Note } from '../types.js';

/* FEEL opens on the scene's own pocket when it has one, else straight. */
export const FEEL = { ...custom('FEEL', FEELS.map((f) => f[0])), def: (c: GenCtx) => (c.groove.land.some((x) => x !== 0) ? 1 : 0) };
const grid = (ctx: GenCtx) => ctx.groove.grid;
/* Straight: the set's swing swings the clip at playback (no SWING knob). */
const tight = (ctx: GenCtx, notes: Note[], amount = 1) => timing(ctx, notes, amount, grid(ctx), 0);
const len = (ctx: GenCtx, notes: Note[], v: number) => fromEvents(lengthStage(toEvents(notes), v, ctx.end), ctx.end);
const chords = fixChords;
/* VELOCITY (5 = as played): left evens the velocities, right accents the beat. */
export const VELOCITY: KnobDef = { name: 'VELOCITY', steps: () => 11, def: () => 5,
    label: (v) => (v === 5 ? 'AS PLAYED' : v < 5 ? 'EVEN ' + (5 - v) : 'ACCENT ' + (v - 5)) };
/* DENSITY (5 = as played) after the timing, so an added note lands on the grid. */
const dense = (ctx: GenCtx, notes: Note[], v: number, seed: number) =>
    (v === 5 ? notes : fromEvents(densityStage(ctx, toEvents(notes), v, rng(seed), chords(ctx)), ctx.end));

/* TIGHT is TIDY and GROOVE too (§2.7): CLEAN, LENGTH, VELOCITY and FEEL at
 * their defaults are the old TIGHT, which already sat in the scene's pocket.
 * No SWING: the set's swing swings the clip at playback. */
export const TIGHT: Preset = {
    id: 'q-tight', name: 'TIGHT', task: 'quantize', drum: false, cls: 'close', fit: () => 0.9,
    knobs: [K.timing(10), K.density(5), K.pitchFix(4), K.grid(), K.length(5), VELOCITY, K.clean(0), { ...FEEL, def: () => 1 }],
    generate: (ctx, v, seed) => len(ctx, velocity(dense(ctx, fixWorst(ctx,
        timing(ctx, clean(ctx.src, v[6]), v[0] / 10, GRIDS[v[3]], 0, 1, feelLand(ctx, v[7])), v[2], chords(ctx)), v[1], seed), v[5]), v[4]),
};

/** Chords filled out and voice-led; a line's stray octave leaps folded back. */
export const SHAPED: Preset = {
    id: 'q-shaped', name: 'SHAPED', task: 'quantize', drum: false, cls: 'rhythm', fit: () => 0.55,
    knobs: [K.timing(10), K.pitchFix(6), count('VOICING', 10, 6), K.length(6)],
    generate: (ctx, v) => {
        let notes = fixWorst(ctx, tight(ctx, ctx.src, v[0] / 10), v[1], chords(ctx));
        const kind = ctx.role?.kind;
        if (kind === 'pad' || kind === 'stabs') {
            const evs = realiseChords(ctx, toEvents(notes), { plan: ctx.plans[0], tension: v[2] / 12, range: 1 });
            notes = fromEvents(evs, ctx.end);
        } else {
            const sorted = [...notes].sort((a, b) => a.tick - b.tick);
            const maxLeap = 12 - v[2];
            for (let i = 1; i < sorted.length; i++) {
                const d = sorted[i].pitch - sorted[i - 1].pitch;
                if (Math.abs(d) > maxLeap) sorted[i] = { ...sorted[i], pitch: sorted[i].pitch - Math.sign(d) * 12 };
            }
            notes = sorted;
        }
        return len(ctx, notes, v[3]);
    },
};

export const EMBELLISH: Preset = {
    id: 'q-embellish', name: 'DECORATE', task: 'quantize', drum: false, cls: 'exp', fit: () => 0.5,
    knobs: [K.timing(10), count('AMOUNT', 16, 3), custom('KIND', ['GRACE', 'PASSING', 'NEIGHBOUR'], 1), K.pitchFix(4)],
    generate: (ctx, v, seed) => {
        const base = fixWorst(ctx, tight(ctx, ctx.src, v[0] / 10), v[3], chords(ctx));
        return embellish(ctx, base, v[1], ORNAMENTS[v[2]], rng(seed), chords(ctx));
    },
};

const STEPS = [-2, -1, 1, 2];

/** The second half answers the first: its pitches moved by scale steps, then
 *  fitted to the harmony there. */
export const ANSWER_Q: Preset = {
    id: 'q-answer', name: 'ANSWER', task: 'quantize', drum: false, cls: 'exp', fit: () => 0.45, roles: ['lead', 'arpeggio', 'bass'],
    knobs: [K.timing(10), custom('SPLIT', ['1/4', '1/2', '3/4'], 1), custom('STEP', STEPS.map((s) => (s > 0 ? '+' : '') + s), 2), K.pitchFix(5),
        K.rhythm(0), K.length(5), K.density(5), K.dynamics(0)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const split = (ctx.end * (v[1] + 1)) / 4;
        const moved = tight(ctx, ctx.src, v[0] / 10).map((n) => (n.tick >= split ? { ...n, pitch: stepScale(n.pitch, STEPS[v[2]], ctx.key) } : n));
        /* RHYTHM reshapes the answer; the first half stays as played. */
        const head = moved.filter((n) => n.tick < split);
        const tail = toEvents(moved.filter((n) => n.tick >= split));
        const tail2 = v[4] ? rhythmStage(ctx, tail, v[4], r).filter((e) => e.tick >= split) : tail;
        const evs = densityStage(ctx, toEvents([...head, ...fromEvents(tail2, ctx.end)]), v[6], r, chords(ctx));
        return dynamics(fixWorst(ctx, len(ctx, fromEvents(evs, ctx.end), v[5]), v[3], chords(ctx)), v[7]);
    },
};
