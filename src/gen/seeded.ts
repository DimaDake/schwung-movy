/* SEED on the generators that roll dice and had knobs to spare (user,
 * 2026-10-28: "are there any generator algorithms where we have free knobs
 * and we can add a seed knob (which would make sense)"): the ones whose take
 * moves with their seed — which notes AMOUNT touches, which pads a fill
 * hits — and that had four knobs. SEED #1 is the take they always gave, so
 * a default is unchanged; every other position is another roll of the dice. */

import { K } from './knobs.js';
import type { Preset } from './preset.js';
import { mix } from './rng.js';

export function withSeed(p: Preset): Preset {
    const n = p.knobs.length;
    return { ...p, knobs: [...p.knobs, K.seed()],
        generate: (ctx, v, seed) => p.generate(ctx, v.slice(0, n), v[n] ? mix(seed, v[n]) : seed) };
}
