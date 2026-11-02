/* Smart Quantize for drums: the same pads on the scene's groove, cleaned,
 * and — further up the ladder — ghost notes, accents and a small fill. */

import type { GenCtx } from '../analysis/context.js';
import { GRIDS } from '../analysis/groove.js';
import { padFor } from '../analysis/kit.js';
import { count, custom, K, type KnobDef } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { velocity } from '../shape/velocity.js';
import { clean, fill, ghosts } from '../shape/drums.js';
import { drumDensity } from '../shape/drum-density.js';
import { feelLand, timing } from '../shape/time.js';
import { FEEL, VELOCITY } from './quant-melodic.js';
import type { Note } from '../types.js';

const tight = (ctx: GenCtx, notes: Note[], amount = 1) => timing(ctx, notes, amount, ctx.groove.grid, ctx.groove.swing);
/* DENSITY (5 = as played) after the timing, so an added hit lands on the grid. */
const dense = (ctx: GenCtx, notes: Note[], v: number, seed: number) => drumDensity(notes, v, ctx.end, rng(seed));

/* A ghost-note count that is felt on this pattern: about a third of its hits. */
const GHOST_COUNT: KnobDef = { ...count('COUNT', 16, 4), def: (c) => Math.max(2, Math.min(16, Math.round(c.src.length * 0.35))) };

/* TIGHT is TIDY and GROOVE too (§2.7); no SWING (the set's swing applies at
 * playback). Its defaults are the old TIGHT's, in the scene's pocket. */
export const TIGHT_D: Preset = {
    id: 'qd-tight', name: 'TIGHT', task: 'quantize', drum: true, cls: 'close', fit: () => 0.9,
    knobs: [K.timing(10), K.density(5), K.clean(3), K.grid(), VELOCITY, { ...FEEL, def: () => 1 }],
    generate: (ctx, v, seed) => velocity(dense(ctx, timing(ctx, clean(ctx.src, v[2]), v[0] / 10, GRIDS[v[3]], 0, 1, feelLand(ctx, v[5])), v[1], seed), v[4]),
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
