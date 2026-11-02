/* SEED, ordered close to far (plans/2026-11-01-generator-ux-design.md §2.8;
 * user: "SEED gives more valuable options"): a SEED knob's sixteen takes
 * sorted by how far each sounds from take #1 (select.ts spread), so turning
 * right moves away from what is playing step by step and turning back
 * returns the same notes. Built a take a slice (one regeneration per UI
 * tick, as the options are), never on the audio side of a turn. */

import type { GenCtx } from './analysis/context.js';
import { regenerate } from './engine.js';
import type { Preset } from './preset.js';
import { spread } from './select.js';
import { SEED_TAKES } from './knobs.js';

/** The raw SEED values in order, #1 first, each next one further from it. */
export function* seedOrder(ctx: GenCtx, p: Preset, knobs: number[], si: number): Generator<void, number[], void> {
    const take = (raw: number) => { const w = [...knobs]; w[si] = raw; return regenerate(ctx, p, w) ?? []; };
    const base = take(0);
    const dist = [0];
    for (let raw = 1; raw < SEED_TAKES; raw++) {
        yield;
        dist.push(spread(base, take(raw)));
    }
    return dist.map((_, raw) => raw).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : dist[a] - dist[b] || a - b));
}
