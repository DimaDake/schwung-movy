/* Where the scene's kick falls (plans/2026-11-06-bass-over-chords-evaluation.md):
 * a bass lands on the kick half the time in the public electronic parts and
 * 70% in pop, and the band's accents alone (common.ts bandSteps) mix the kick
 * with snares and struck chords, which drew the bass off it (41%). */

import { kitHints, kitOf } from '../analysis/kit.js';
import type { GenCtx } from '../analysis/context.js';
import { TPS } from '../types.js';
import { bandSteps, withBand } from './common.js';

/** The kick's steps in a bar (0..15) that it plays in at least 40% of bars. */
export function kickSteps(ctx: GenCtx): number[] {
    const { input } = ctx;
    const count = new Map<number, number>();
    let bars = 0;
    for (const t of input.tracks) {
        if (!t.drum || t.index === input.target.track) continue;
        for (const c of t.clips) {
            if (c.slot !== input.target.slot || !c.notes.length || c.len <= 0) continue;
            const kit = kitOf([...new Set(c.notes.map((n) => n.pitch))], kitHints(t), c.notes);
            const kicks = new Set(kit.by.kick);
            const m = c.scaleDen / c.scaleNum / ctx.k;
            const w0 = c.loopStart * TPS;
            bars = Math.max(bars, Math.max(1, Math.round((c.len * m) / 16)));
            for (const n of c.notes) {
                if (!kicks.has(n.pitch) || n.tick < w0 || n.tick >= w0 + c.len * TPS) continue;
                const s = Math.round(((n.tick - w0) * m) / TPS) % 16;
                count.set(s, (count.get(s) ?? 0) + 1);
            }
        }
    }
    return [...count].filter(([, n]) => n >= bars * 0.4).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([s]) => s);
}

/** A bar of hits locked to the band: the kick, with the strongest off-beat
 *  accent when the kick alone is too sparse to carry a line; the band's
 *  accents when there is no kick. */
export function lockFigure(ctx: GenCtx): number[] {
    const kick = kickSteps(ctx).slice(0, 5);
    if (!kick.length) return withBand(ctx, 6, []);
    const off = bandSteps(ctx).find((s) => s % 4 === 2 && !kick.includes(s));
    return [...kick, ...(kick.length <= 2 && off !== undefined ? [off] : [])].sort((a, b) => a - b);
}
