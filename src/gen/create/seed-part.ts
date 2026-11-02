/* What a Variation generator adopted by New Clip works from
 * (plans/2026-11-01-generator-ux-design.md §2.9): New Clip has no clip of
 * its own, so the scene is written as a plain source part first — a held
 * note, roots on a bass figure, chord tones in 8ths, or another track's
 * melody — and the generator develops that, as it would a played one. */

import { roleOf, type RoleKind } from '../../ai/role.js';
import { type GenCtx, looped } from '../analysis/context.js';
import { planAt } from '../plan.js';
import { nearestPitch } from '../theory/pc.js';
import { BAR, type Note, TPS } from '../types.js';
import { chordUnder } from './common.js';

export type SeedKind = 'drone' | 'root' | 'line' | 'melody';

/** The busiest melodic line another track plays in this scene, looped to the clip. */
export function otherMelody(ctx: GenCtx): Note[] {
    const { input } = ctx;
    let best: Note[] = [];
    for (const t of input.tracks) {
        if (t.drum || t.index === input.target.track) continue;
        for (const c of t.clips) {
            if (c.slot !== input.target.slot || !c.notes.length) continue;
            if (roleOf(c.notes, c.len, false)?.kind !== 'lead' || c.notes.length <= best.length) continue;
            best = looped(c.notes, c.len * TPS, ctx.end);
        }
    }
    return best;
}

/** The scene as a source part of `kind` at `centre`; `steps` are a bar's onsets. */
export function seedPart(ctx: GenCtx, kind: SeedKind, h: number, centre: number, steps: number[] = [0, 2, 4, 6, 8, 10, 12, 14]): Note[] {
    if (kind === 'melody') return otherMelody(ctx);
    const out: Note[] = [];
    if (kind === 'drone') {
        const p = nearestPitch(centre, [chordUnder(ctx, h, 0).root]);
        for (let t = 0; t < ctx.end; t += BAR) out.push({ tick: t, pitch: p, gate: Math.min(BAR, ctx.end - t) - 2, vel: 90 });
        return out;
    }
    let i = 0;
    for (let bar = 0; bar * BAR < ctx.end; bar++) {
        steps.forEach((s, j) => {
            const tick = bar * BAR + s * TPS;
            if (tick >= ctx.end) return;
            const c = chordUnder(ctx, h, tick);
            const pcs = kind === 'root' ? [c.root] : [c.pcs[i++ % c.pcs.length]];
            const next = steps[j + 1] ?? 16 + steps[0];
            out.push({ tick, pitch: nearestPitch(centre, pcs), gate: Math.max(TPS / 2, (next - s) * TPS - 4), vel: 96 });
        });
    }
    return out;
}

/** The New Clip context with `src` as the clip a Variation generator reads:
 *  its role, range and chords (the scene's for a melody, else the plan's). */
export function asSource(ctx: GenCtx, src: Note[], kind: RoleKind, h: number, sceneChords: boolean): GenCtx {
    const ps = src.map((n) => n.pitch).sort((a, b) => a - b);
    const role = roleOf(src, ctx.len, false);
    return { ...ctx, task: 'variation', src, role: role ? { ...role, kind } : null, loops: [],
        srcChords: sceneChords ? ctx.srcChords : planAt(ctx, h).chords,
        lo: ps[0] ?? 48, hi: ps[ps.length - 1] ?? 72, mid: ps[ps.length >> 1] ?? 60 };
}
