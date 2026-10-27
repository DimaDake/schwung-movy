/* Smart Quantize for drums: the same pads on the scene's groove, cleaned,
 * and — further up the ladder — ghost notes, accents and a small fill. */

import type { GenCtx } from '../analysis/context.js';
import { GRIDS } from '../analysis/groove.js';
import { padFor } from '../analysis/kit.js';
import { count, custom, K, type KnobDef, swingOfKnob } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { dynamics, even } from '../shape/dynamics.js';
import { clean, fill, ghosts } from '../shape/drums.js';
import { feelLand, timing } from '../shape/time.js';
import { FEEL } from './quant-melodic.js';
import type { Note } from '../types.js';

const tight = (ctx: GenCtx, notes: Note[], amount = 1) => timing(ctx, notes, amount, ctx.groove.grid, ctx.groove.swing);
const EVEN = custom('EVEN', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 4);

/* A ghost-note count that is felt on this pattern: about a third of its hits. */
const GHOST_COUNT: KnobDef = { ...count('COUNT', 16, 4), def: (c) => Math.max(2, Math.min(16, Math.round(c.src.length * 0.35))) };

export const TIGHT_D: Preset = {
    id: 'qd-tight', name: 'TIGHT', task: 'quantize', drum: true, cls: 'close', fit: () => 0.9,
    knobs: [K.timing(10), K.swing(), K.grid(), K.clean(3)],
    generate: (ctx, v) => timing(ctx, clean(ctx.src, v[3]), v[0] / 10, GRIDS[v[2]], swingOfKnob(v[1])),
};

export const TIDY_D: Preset = {
    id: 'qd-tidy', name: 'TIDY', task: 'quantize', drum: true, cls: 'rhythm', fit: () => 0.6,
    knobs: [K.timing(10), K.clean(8), EVEN, K.grid()],
    generate: (ctx, v) => even(timing(ctx, clean(ctx.src, v[1]), v[0] / 10, GRIDS[v[3]], ctx.groove.swing), v[2]),
};

export const GROOVE_D: Preset = {
    id: 'qd-groove', name: 'GROOVE', task: 'quantize', drum: true, cls: 'rhythm', fit: () => 0.65,
    knobs: [K.timing(9), K.swing(), K.dynamics(6), FEEL],
    generate: (ctx, v) => dynamics(timing(ctx, clean(ctx.src, 3), v[0] / 10, ctx.groove.grid, swingOfKnob(v[1]), 1, feelLand(ctx, v[3])), v[2]),
};

export const GHOSTS_D: Preset = {
    id: 'qd-ghosts', name: 'GHOSTS', task: 'quantize', drum: true, cls: 'exp',
    knobs: [K.timing(10), GHOST_COUNT, custom('LEVEL', ['20', '30', '40', '50'], 1), K.seed()],
    fit: (c) => (c.kit && (padFor(c.kit, 'snare', c.src) !== null || padFor(c.kit, 'hat', c.src) !== null) ? 0.6 : 0.2),
    generate: (ctx, v, seed) => ghosts(ctx, ctx.kit!, tight(ctx, clean(ctx.src, 3), v[0] / 10), v[1], 'snare', 20 + v[2] * 10, rng(seed + v[3] * 7919)),
};

export const FILL_D: Preset = {
    id: 'qd-fill', name: 'FILL', task: 'quantize', drum: true, cls: 'exp', fit: () => 0.55,
    knobs: [K.timing(10), custom('SIZE', ['1/2 BEAT', '1 BEAT', '2 BEATS', '1 BAR'], 2), K.density(6), K.seed()],
    generate: (ctx, v, seed) => fill(ctx, ctx.kit!, tight(ctx, clean(ctx.src, 3), v[0] / 10), [2, 4, 8, 16][v[1]], v[2] / 10, rng(seed + v[3] * 7919)),
};

export const FULL_D: Preset = {
    id: 'qd-full', name: 'FULL', task: 'quantize', drum: true, cls: 'exp', fit: () => 0.5,
    knobs: [K.timing(10), K.swing(), K.grid(), K.clean(4), { ...GHOST_COUNT, name: 'GHOSTS', def: (c) => Math.max(2, Math.round(c.src.length * 0.15)) },
        K.dynamics(4), custom('FILL', ['NONE', '1/2 BEAT', '1 BEAT', '2 BEATS'], 2), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[7] * 7919);
        let notes = timing(ctx, clean(ctx.src, v[3]), v[0] / 10, GRIDS[v[2]], swingOfKnob(v[1]));
        notes = ghosts(ctx, ctx.kit!, notes, v[4], 'hat', 35, r);
        notes = fill(ctx, ctx.kit!, notes, [0, 2, 4, 8][v[6]], 0.6, r);
        return dynamics(notes, v[5]);
    },
};
