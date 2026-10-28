/* STYLE: a new part in the source's own language (design 2026-10-28 §1). A
 * Markov walk learned from the part and its track's other clips writes a
 * phrase of new rhythm and contour; a melodic one is realised over the plan,
 * so harmony stays the scene's. */

import { K, PHRASES } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { drumWalk } from '../style/drums.js';
import { walk } from '../style/melodic.js';
import { BAR } from '../types.js';
import { finish, over, partEvs } from './helpers.js';

export const STYLE: Preset = {
    id: 'v-style', name: 'STYLE', task: 'variation', drum: false, cls: 'exp', roles: ['lead', 'arpeggio', 'bass', 'pad', 'stabs'],
    fit: () => 0.6,
    knobs: [K.likeness(6), K.phrase(), K.density(5), K.harmony(1), K.changes(0), K.tension(4), K.range(5), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[7] * 7919);
        const evs = walk(ctx, partEvs(ctx), v[0], v[2], PHRASES[v[1]] * BAR, r);
        return finish(ctx, over(ctx, evs, { h: v[3], changes: v[4], tension: v[5], range: v[6], r }), {}, r);
    },
};

export const STYLE_D: Preset = {
    id: 'd-style', name: 'STYLE', task: 'variation', drum: true, cls: 'exp', fit: () => 0.6,
    knobs: [K.likeness(5), K.phrase(), K.density(5), K.seed()],
    generate: (ctx, v, seed) => drumWalk(ctx, v[0], v[2], PHRASES[v[1]] * BAR, rng(seed + v[3] * 7919)),
};
