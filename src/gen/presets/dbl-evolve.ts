/* EVOLVE (user, 2026-10-28: "when I double something close to a chord
 * progression or anything backed by chords I want to see an option that
 * evolves that to something new. If the first bar has 2 chords and I double
 * it the second bar should have 2 different chords"): the first half stays
 * as played; the second plays the same part over the first half's chords
 * developed — a sequence, a Riemann turn, a substitute, a borrowing — the
 * way a B phrase answers an A. Only where the clip's own chords are the
 * scene's to change; in a partial scene only the moves that keep what the
 * others hold. */

import type { GenCtx } from '../analysis/context.js';
import { targetHalves } from '../analysis/context.js';
import { fromEvents, toEvents } from '../analysis/events.js';
import { K, rangeOfKnob } from '../knobs.js';
import { sample } from '../plan.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { realise } from '../realise/index.js';
import { rhythmStage } from '../shape/rhythm.js';
import { chordPart } from '../shape/seams.js';
import { colourPcs } from '../theory/category.js';
import { harmonicMoves, type MoveResult, tolerates } from '../theory/moves.js';
import type { Chord, Note } from '../types.js';

const cache = new WeakMap<GenCtx, MoveResult[]>();

/** The developments of the first half's chords this scene allows, closest first. */
export function evolutions(ctx: GenCtx): MoveResult[] {
    const hit = cache.get(ctx);
    if (hit) return hit;
    const n = targetHalves(ctx), h = Math.max(1, n >> 1);
    const first = sample(ctx.srcChords, h);
    const col = (c: Chord) => colourPcs(c, ctx.key);
    const fits = (cs: (Chord | null)[]) => cs.every((c, i) => !c || !ctx.pinned.length || tolerates(c, ctx.pinned[(h + i) % ctx.pinned.length], col));
    const out = !first.some((c) => c) ? [] : harmonicMoves(first, ctx.key, ctx.input.level === 'WILD')
        .filter((m) => m.name !== 'SAME' && fits(m.chords));
    cache.set(ctx, out);
    return out;
}

export const EVOLVE: Preset = {
    id: 'x-evolve', name: 'EVOLVE', task: 'double', drum: false, cls: 'exp',
    /* A chord part is where a new progression is heard most plainly. */
    fit: (ctx) => (chordPart(ctx) ? 0.8 : 0.62),
    accepts: (ctx) => ctx.freedom !== 'locked' && ctx.src.length > 0 && evolutions(ctx).length > 0,
    knobs: [{ name: 'MOVE', steps: (c) => Math.max(1, evolutions(c).length), def: () => 0, label: (v, c) => evolutions(c)[v]?.name ?? '-' },
        K.tension(4), K.rhythm(0), K.range(5)],
    generate: (ctx, v, seed) => {
        const ms = evolutions(ctx);
        const m = ms[Math.min(v[0], ms.length - 1)];
        if (!m) return [];
        const half = ctx.end / 2;
        const first = sample(ctx.srcChords, Math.max(1, targetHalves(ctx) >> 1));
        const plan = { chords: [...first, ...m.chords], sit: 'asis' as const, pedal: m.pedal, label: m.name };
        const tail = toEvents(ctx.src.filter((n) => n.tick >= half));
        const shaped = rhythmStage(ctx, tail, v[2], rng(seed)).filter((e) => e.tick >= half);
        const out = realise(ctx, shaped, { plan, tension: v[1] / 10, range: rangeOfKnob(v[3]) });
        const kept: Note[] = ctx.src.filter((n) => n.tick < half).map((n) => ({ ...n, gate: Math.min(n.gate, half - n.tick) }));
        return [...kept, ...fromEvents(out, ctx.end).filter((n) => n.tick >= half)];
    },
};
