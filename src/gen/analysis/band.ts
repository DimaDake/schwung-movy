/* What the rest of the band hits under the target clip: every other track's
 * onsets in the target scene, each clip's loop window from its start and
 * repeated (the engine joins a doubled clip in phase with the longest loop
 * it divides, engine/phase.rs), in the target's ticks. An ending that hits
 * with the band — the bass's pickup on the drummer's fill — sounds played
 * together, not pasted on. */

import type { AiClip, GenInput } from '../types.js';
import { TPS } from '../types.js';
import { clipMasterTicks } from './sounding.js';

export interface Hit { tick: number; w: number }

/* Onsets this close are one hit (a loose drummer and a quantized bass). */
const BUCKET = TPS / 4;

/** The band's hits over [0, end) target ticks, `k` master ticks per target
 *  tick; a hit's weight sums its notes' velocities (100 = 1). */
export function bandHits(input: GenInput, end: number, k: number): Hit[] {
    const w = new Map<number, number>();
    const clips: AiClip[] = input.tracks.filter((t) => t.index !== input.target.track)
        .flatMap((t) => t.clips.filter((c) => c.slot === input.target.slot && c.notes.length > 0 && c.len > 0));
    for (const c of clips) {
        const loop = clipMasterTicks(c);
        const m = c.scaleDen / c.scaleNum;
        const w0 = c.loopStart * TPS;
        const heard = c.notes.filter((x) => x.tick >= w0 && x.tick < w0 + c.len * TPS);
        for (let off = 0; off < end * k; off += loop) {
            for (const x of heard) {
                const t = Math.round((off + (x.tick - w0) * m) / k / BUCKET) * BUCKET;
                if (t < end) w.set(t, (w.get(t) ?? 0) + x.vel / 100);
            }
        }
    }
    return [...w].map(([tick, v]) => ({ tick, w: v })).sort((a, b) => a.tick - b.tick);
}

/** A band hit strong enough to play with: a struck chord, a snare, two
 *  parts together; a quiet hat alone is not one. */
export const ACCENT = 0.9;
