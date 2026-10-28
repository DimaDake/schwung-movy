/* Smart Quantize for melodic parts: the clip on the scene's groove and
 * harmony, then — as the level rises — shaped and developed a little
 * ("it is not only boring quantize but can actually update your clip"). */

import type { GenCtx } from '../analysis/context.js';
import { fromEvents, toEvents } from '../analysis/events.js';
import { GRIDS } from '../analysis/groove.js';
import { count, custom, K, swingOfKnob } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { realiseChords } from '../realise/chords.js';
import { even, dynamics } from '../shape/dynamics.js';
import { clean } from '../shape/drums.js';
import { embellish, ORNAMENTS, pitchFix } from '../shape/pitch.js';
import { FEELS, feelLand, lengthStage, timing } from '../shape/time.js';
import { rhythmStage } from '../shape/rhythm.js';
import { densityStage } from '../shape/density.js';
import { stepScale } from '../theory/pc.js';
import type { Note } from '../types.js';

/* FEEL opens on the scene's own pocket when it has one, else straight. */
export const FEEL = { ...custom('FEEL', FEELS.map((f) => f[0])), def: (c: GenCtx) => (c.groove.land.some((x) => x !== 0) ? 1 : 0) };
const grid = (ctx: GenCtx) => ctx.groove.grid;
const swing = (ctx: GenCtx) => ctx.groove.swing;
const tight = (ctx: GenCtx, notes: Note[], amount = 1) => timing(ctx, notes, amount, grid(ctx), swing(ctx));
const len = (ctx: GenCtx, notes: Note[], v: number) => fromEvents(lengthStage(toEvents(notes), v, ctx.end), ctx.end);
const chords = (ctx: GenCtx) => ctx.plans[0]?.chords ?? ctx.fixedChords;

export const TIGHT: Preset = {
    id: 'q-tight', name: 'TIGHT', task: 'quantize', drum: false, cls: 'close', fit: () => 0.9,
    knobs: [K.timing(10), K.swing(), K.grid(), K.pitchFix(4)],
    generate: (ctx, v) => pitchFix(ctx, timing(ctx, ctx.src, v[0] / 10, GRIDS[v[2]], swingOfKnob(v[1])), v[3], chords(ctx)),
};

export const TIDY: Preset = {
    id: 'q-tidy', name: 'TIDY', task: 'quantize', drum: false, cls: 'rhythm', fit: () => 0.6,
    knobs: [K.timing(10), K.clean(5), custom('EVEN', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 6), K.length(6)],
    generate: (ctx, v) => len(ctx, even(pitchFix(ctx, tight(ctx, clean(ctx.src, v[1]), v[0] / 10), 3, chords(ctx)), v[2]), v[3]),
};

export const GROOVE: Preset = {
    id: 'q-groove', name: 'GROOVE', task: 'quantize', drum: false, cls: 'rhythm', fit: () => 0.65,
    knobs: [K.timing(9), K.swing(), K.dynamics(6), FEEL],
    generate: (ctx, v) => dynamics(pitchFix(ctx, timing(ctx, ctx.src, v[0] / 10, grid(ctx), swingOfKnob(v[1]), 1, feelLand(ctx, v[3])), 3, chords(ctx)), v[2]),
};

/** Chords filled out and voice-led; a line's stray octave leaps folded back. */
export const SHAPED: Preset = {
    id: 'q-shaped', name: 'SHAPED', task: 'quantize', drum: false, cls: 'rhythm', fit: () => 0.55,
    knobs: [K.timing(10), K.pitchFix(6), count('VOICING', 10, 6), K.length(6)],
    generate: (ctx, v) => {
        let notes = pitchFix(ctx, tight(ctx, ctx.src, v[0] / 10), v[1], chords(ctx));
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
    id: 'q-embellish', name: 'EMBELLISH', task: 'quantize', drum: false, cls: 'exp', fit: () => 0.5,
    knobs: [K.timing(10), count('AMOUNT', 16, 3), custom('KIND', ['GRACE', 'PASSING', 'NEIGHBOUR'], 1), K.pitchFix(4)],
    generate: (ctx, v, seed) => {
        const base = pitchFix(ctx, tight(ctx, ctx.src, v[0] / 10), v[3], chords(ctx));
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
        return dynamics(pitchFix(ctx, len(ctx, fromEvents(evs, ctx.end), v[5]), v[3], chords(ctx)), v[7]);
    },
};

export const FULL: Preset = {
    id: 'q-full', name: 'FULL', task: 'quantize', drum: false, cls: 'exp', fit: () => 0.5,
    knobs: [K.timing(10), K.swing(), K.grid(), K.pitchFix(4), count('EMBELLISH', 16, 2), K.dynamics(3), K.length(5), K.rhythm(0)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        let notes = pitchFix(ctx, timing(ctx, ctx.src, v[0] / 10, GRIDS[v[2]], swingOfKnob(v[1])), v[3], chords(ctx));
        if (v[7]) notes = fromEvents(rhythmStage(ctx, toEvents(notes), v[7], r), ctx.end);
        notes = embellish(ctx, notes, v[4], ORNAMENTS[Math.floor(r() * 3)], r, chords(ctx));
        return len(ctx, dynamics(notes, v[5]), v[6]);
    },
};
