/* EVOLVE (user, 2026-10-28: "when I double something close to a chord
 * progression or anything backed by chords I want to see an option that
 * evolves that to something new. If the first bar has 2 chords and I double
 * it the second bar should have 2 different chords"): the first half stays
 * as played; the second plays the same part over the first half's chords
 * developed — a sequence, a Riemann turn, a substitute, a borrowing — the
 * way a B phrase answers an A. Only where the clip's own chords are the
 * scene's to change; in a partial scene only the moves that keep what the
 * others hold. MOVE also runs 2 | its moves | 8 like New Clip's HARMONY
 * (user, 2026-11-06), loops from the first half's own chords laid over the
 * second (theory/sections.ts). */

import type { GenCtx } from '../analysis/context.js';
import { targetHalves } from '../analysis/context.js';
import { fromEvents, toEvents } from '../analysis/events.js';
import { custom, K, type KnobDef, rangeOfKnob } from '../knobs.js';
import { periodOf } from '../theory/develop.js';
import { sample } from '../plan.js';
import { chordsLabel } from '../theory/chord-label.js';
import { type Laid, progId, sectionsOver } from '../theory/sections.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { realise } from '../realise/index.js';
import { rhythmStage } from '../shape/rhythm.js';
import { chordPart } from '../shape/seams.js';
import { colourPcs } from '../theory/category.js';
import { harmonicMoves, type MoveResult, tolerates } from '../theory/moves.js';
import type { Chord, Note } from '../types.js';

const cache = new WeakMap<GenCtx, MoveResult[]>();

/** The developments of the first half's chords this scene allows, closest
 *  first, between its 2 and 8 sections. */
export function evolutions(ctx: GenCtx): MoveResult[] {
    const hit = cache.get(ctx);
    if (hit) return hit;
    const n = targetHalves(ctx), h = Math.max(1, n >> 1);
    const first = sample(ctx.srcChords, h);
    const col = (c: Chord) => colourPcs(c, ctx.key);
    const fits = (cs: (Chord | null)[]) => cs.every((c, i) => !c || !ctx.pinned.length || tolerates(c, ctx.pinned[(h + i) % ctx.pinned.length], col));
    const mid = !first.some((c) => c) ? [] : harmonicMoves(first, ctx.key)
        .filter((m) => m.name !== 'SAME' && fits(m.chords));
    const out = mid.length ? withSections(ctx, h, first, mid, fits) : mid;
    cache.set(ctx, out);
    return out;
}

/** The second half's sections; never the first half again. */
function withSections(ctx: GenCtx, h: number, first: (Chord | null)[], mid: MoveResult[], fits: (cs: (Chord | null)[]) => boolean): MoveResult[] {
    const move = (l: Laid): MoveResult => ({ name: chordsLabel(l.chords), dist: 0, chords: l.chords, pedal: null, count: l.count });
    const [two, eight] = sectionsOver(first, ctx.key, h, true, fits, new Set([progId(first), ...mid.map((m) => progId(m.chords))]));
    return [...two.map(move), ...mid, ...eight.map(move)];
}

/** Where MOVE opens: the first development, past the 2 section. */
const firstMove = (ctx: GenCtx): number => Math.max(0, evolutions(ctx).findIndex((m) => !m.count));

/* PHRASES: one development for the whole second half, or one per phrase
 * of it — the first half's own repeat, or its halves when it has none — so
 * a long clip's answer moves through more chords than the question had. */
const blockOf = (ctx: GenCtx): number => {
    const h = Math.max(1, targetHalves(ctx) >> 1);
    const p = periodOf(sample(ctx.srcChords, h));
    return p < h ? p : h >= 4 ? h / 2 : h;
};
/* EACH opens where the first half repeats itself, so its repeats answer
 * differently; elsewhere it is one move, every chord a new one. */
const repeats = (c: GenCtx): boolean => { const h = Math.max(1, targetHalves(c) >> 1); return periodOf(sample(c.srcChords, h)) < h; };
const PHRASES: KnobDef = { ...custom('PHRASES', ['ONE MOVE', 'EACH']), def: (c) => (repeats(c) ? 1 : 0) };

export const EVOLVE: Preset = {
    id: 'x-evolve', name: 'EVOLVE', task: 'double', drum: false, cls: 'exp',
    /* A drone over new chords is DRONE MOVE's and PEDAL's (Variation). */
    roles: ['pad', 'stabs', 'bass', 'arpeggio', 'lead'],
    /* A chord part is where a new progression is heard most plainly. */
    fit: (ctx) => (chordPart(ctx) ? 0.8 : 0.62),
    accepts: (ctx) => ctx.freedom !== 'locked' && ctx.src.length > 0 && evolutions(ctx).some((m) => !m.ext && !m.count),
    knobs: [{ name: 'MOVE', steps: (c) => Math.max(1, evolutions(c).length), def: firstMove, label: (v, c) => evolutions(c)[v]?.name ?? '-' },
        K.tension(4), K.rhythm(0), K.range(5), PHRASES],
    generate: (ctx, v, seed) => {
        const ms = evolutions(ctx);
        const m = ms[Math.min(v[0], ms.length - 1)];
        if (!m) return [];
        const half = ctx.end / 2;
        const first = sample(ctx.srcChords, Math.max(1, targetHalves(ctx) >> 1));
        const B = blockOf(ctx);
        /* EACH goes round its own section: a 2 answer stays two chords. */
        const pool = ms.filter((x) => x.count === m.count), at = pool.indexOf(m);
        const answer = v[4] ? m.chords.map((_, i) => pool[(at + Math.floor(i / B)) % pool.length].chords[i]) : m.chords;
        const plan = { chords: [...first, ...answer], sit: 'asis' as const, pedal: m.pedal, label: m.name };
        const tail = toEvents(ctx.src.filter((n) => n.tick >= half));
        const shaped = rhythmStage(ctx, tail, v[2], rng(seed)).filter((e) => e.tick >= half);
        const out = realise(ctx, shaped, { plan, tension: v[1] / 10, range: rangeOfKnob(v[3]) });
        const kept: Note[] = ctx.src.filter((n) => n.tick < half).map((n) => ({ ...n, gate: Math.min(n.gate, half - n.tick) }));
        return [...kept, ...fromEvents(out, ctx.end).filter((n) => n.tick >= half)];
    },
};
