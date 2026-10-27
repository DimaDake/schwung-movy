/* DENSITY, 5 = as is. Thinner keeps the strongest onsets (metre, length,
 * loudness); denser adds what the part already does — a passing note in a
 * line, a re-strike of a held chord or drone — never a new kind of note. */

import type { GenCtx } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { spanTo, strength } from '../analysis/events.js';
import type { Rng } from '../rng.js';
import type { Chord, Ev } from '../types.js';
import { TPS } from '../types.js';
import { onsetRange } from '../../ai/role.js';
import { nearestPitch } from '../theory/pc.js';
import { colourPcs } from '../theory/category.js';

const weight = (e: Ev) => strength(e.tick) * 2 + Math.min(1, e.voices[0].gate / (TPS * 8)) + e.voices[0].vel / 254;

function thin(ctx: GenCtx, evs: Ev[], share: number, r: Rng): Ev[] {
    const min = ctx.role ? onsetRange(ctx.role, ctx.len)[0] : 1;
    const drop = Math.min(evs.length - Math.max(1, min), Math.round(evs.length * share));
    if (drop <= 0) return evs;
    const order = evs.map((e, i) => ({ i, w: weight(e) + r() * 0.05 })).sort((a, b) => a.w - b.w).slice(0, drop).map((x) => x.i);
    const gone = new Set(order);
    return evs.filter((_, i) => !gone.has(i));
}

function inBetween(ctx: GenCtx, a: Ev, b: Ev | null, tick: number, plan: (Chord | null)[]): Ev {
    const T = chordAt(plan, tick, ctx.k);
    const top = a.voices[a.voices.length - 1];
    if (a.voices.length > 1 || ctx.role?.kind === 'drone' || !T) {
        return { tick, voices: a.voices.map((v) => ({ ...v, dt: 0, vel: Math.round(v.vel * 0.85) })) };
    }
    const next = b ? b.voices[b.voices.length - 1].pitch : top.pitch;
    const want = Math.round((top.pitch + next) / 2) + (top.pitch === next ? 2 : 0);
    const pitch = nearestPitch(want, [...T.pcs, ...colourPcs(T, ctx.key)], ctx.lo - 3, ctx.hi + 3);
    return { tick, voices: [{ pitch, dt: 0, gate: Math.min(top.gate, TPS * 2), vel: Math.round(top.vel * 0.85) }] };
}

function add(ctx: GenCtx, evs: Ev[], share: number, r: Rng, plan: (Chord | null)[]): Ev[] {
    const max = ctx.role ? onsetRange(ctx.role, ctx.len)[1] : evs.length * 2;
    const room = Math.max(0, max - evs.length);
    const want = Math.min(room, Math.max(1, Math.round(evs.length * share)));
    const gaps = evs.map((e, i) => ({ i, span: spanTo(evs, i, ctx.end) })).filter((g) => g.span >= TPS * 2)
        .sort((a, b) => b.span - a.span || r() - 0.5).slice(0, want);
    const extra = gaps.map(({ i, span }) => {
        const step = Math.max(1, Math.round(span / TPS / 2));
        const tick = evs[i].tick + step * TPS;
        return tick < ctx.end ? inBetween(ctx, evs[i], evs[i + 1] ?? null, tick, plan) : null;
    }).filter((e): e is Ev => e !== null);
    return [...evs, ...extra].sort((a, b) => a.tick - b.tick);
}

/** v 0..10 (5 = as is); `plan` is the target harmony an added note fits. */
export function densityStage(ctx: GenCtx, evs: Ev[], v: number, r: Rng, plan: (Chord | null)[]): Ev[] {
    if (v === 5 || !evs.length) return evs;
    if (v < 5) return thin(ctx, evs, ((5 - v) / 5) * 0.6, r);
    /* Shorten what a new note now follows, so nothing overlaps. */
    const out = add(ctx, evs, ((v - 5) / 5) * 0.8, r, plan);
    return out.map((e, i) => ({ tick: e.tick, voices: e.voices.map((x) => ({ ...x,
        gate: Math.min(x.gate, Math.max(TPS, spanTo(out, i, ctx.end) - 2)) })) }));
}
