/* Nothing leaves a generator unchecked (design §3.7): inside the clip, at
 * most the engine's 512 notes, drums only on the kit, the source's role kept,
 * not a copy of what was there, and never one of the track's clips again. */

import type { GenCtx } from './analysis/context.js';
import { onsetRange, roleBreak } from '../ai/role.js';
import { isSameLoop, loopMatch, NEAR_DUP } from '../ai/same-loop.js';
import { MAX_NOTES } from '../ai/validate.js';
import type { Note } from './types.js';

/* The generators may change a part's rhythm more than a model was allowed
 * to (user, 2026-10-27: "I don't like rhythmic limitations"): a third to
 * three times the onsets, still the same kind of part. */
export const ONSET_SLACK = 1.5;

export function onsetBounds(ctx: GenCtx): [number, number] {
    return ctx.role ? onsetRange(ctx.role, ctx.len, ONSET_SLACK) : [1, 512];
}

export type GuardResult = { ok: true; notes: Note[] } | { ok: false; why: string };

const keyOf = (a: Note[]) => [...a].sort((x, y) => x.tick - y.tick || x.pitch - y.pitch)
    .map((n) => `${n.tick}.${n.pitch}.${n.gate}.${n.vel}`).join(',');

export function clampNotes(ctx: GenCtx, notes: Note[]): Note[] {
    const kit = ctx.drum && ctx.kit ? new Set(ctx.kit.pads) : null;
    const seen = new Set<number>();
    const out: Note[] = [];
    for (const n of [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch)) {
        const tick = Math.round(n.tick);
        if (tick < 0 || tick >= ctx.end || !Number.isFinite(n.pitch)) continue;
        const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
        if (kit && !kit.has(pitch)) continue;
        const k = tick * 128 + pitch;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ tick, pitch, gate: Math.max(1, Math.min(Math.round(n.gate), ctx.end - tick)),
            vel: Math.max(1, Math.min(127, Math.round(n.vel))) });
    }
    return out.slice(0, MAX_NOTES);
}

export function guard(ctx: GenCtx, raw: Note[]): GuardResult {
    const notes = clampNotes(ctx, raw);
    if (!notes.length) return { ok: false, why: 'empty' };
    if (keyOf(notes) === keyOf(ctx.task === 'quantize' ? ctx.src : [])) return { ok: false, why: 'copy' };
    if (ctx.task === 'variation') {
        if (ctx.role) {
            const broke = roleBreak(notes, ctx.role, ctx.len, ONSET_SLACK);
            if (broke) return { ok: false, why: 'role ' + broke };
        }
        /* Unchanged is not a variation, for drums too (the loop rule lets an
         * unmoved drum pattern through on purpose: a B close to its A is
         * fine, the same one is not). */
        if (loopMatch(notes, ctx.src, ctx.len, 'still') >= NEAR_DUP) return { ok: false, why: 'copy' };
        const loops = ctx.loops.length ? ctx.loops : [ctx.src];
        if (isSameLoop(notes, loops, ctx.len, ctx.drum)) return { ok: false, why: 'same loop' };
    }
    return { ok: true, notes };
}
