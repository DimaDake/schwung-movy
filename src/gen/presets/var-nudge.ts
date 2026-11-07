/* NUDGE (plans/2026-11-07-generation-paths-bench.md, round 4): the part as it
 * is with a few notes moved, the small step a Set evolves by. Every other
 * Variation re-harmonises or re-writes (the chains bench: each step 0.8-0.95
 * away from the last); NUDGE walks DRIFT's fixed list of moves (drift.ts) on
 * the source, on the harmony it sounds in. AMOUNT is how many: its least is
 * the smallest change the same-loop guard (guard.ts) lets through, a fifth
 * of a line's notes and more of a chord part's or a duet's, whose moves are
 * one voice. Left to ANY, a chord part's voices turn away from the band's
 * nearest line. BARS puts the change where a phrase answers (every bar, the even
 * ones, the last); DIRECTION lets a part climb or sink as the Set goes on.
 * Drums have their own small steps (KICK, HATS, SHIFT). */

import { driftNotes } from '../drift.js';
import { count, custom, K } from '../knobs.js';
import { homePlan } from '../plan.js';
import type { Preset } from '../preset.js';
import { mix } from '../rng.js';
import { awayFromLines } from '../shape/band-pitch.js';
import { BAR } from '../types.js';

export const NUDGE: Preset = {
    id: 'v-nudge', name: 'NUDGE', task: 'variation', drum: false, cls: 'close', fit: () => 0.75,
    knobs: [count('AMOUNT', 8, 0), custom('BARS', ['EVERY', 'EVEN', 'LAST'], 0), custom('DIRECTION', ['ANY', 'UP', 'DOWN'], 0), K.seed()],
    generate: (ctx, v, seed) => {
        const bars = Math.max(1, Math.round(ctx.end / BAR));
        const where = [undefined, (b: number) => b % 2 === 1, (b: number) => b === bars - 1][v[1]];
        /* Fewer bars to move in, more moves in each, so a turn still changes the part. */
        /* More notes than onsets: a chord part or a duet, whose moves are one voice. */
        const poly = ctx.src.length > 1.2 * new Set(ctx.src.map((n) => n.tick)).size;
        const least = (poly ? 5 : 2) * (v[1] === 0 ? 1 : v[1] === 1 ? 2 : Math.min(4, bars));
        const dir = [poly ? awayFromLines(ctx) : 0, 1, -1][v[2]];
        return driftNotes(ctx, ctx.src.map((n) => ({ ...n })), v[0] + least, mix(seed, v[3] * 7919), homePlan(ctx)?.chords ?? [],
            { bars: where, dir });
    },
};
