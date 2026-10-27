/* Which clip a variation grows from, and what the new clip looks like
 * (design §3). "Several clips may inform it, but the previous one is the one
 * to switch from": the nearest clip above the target, else the nearest below. */

import type { AiClip } from './clip-dump.js';

export function pickSource(slots: { slot: number; hasNotes: boolean }[], target: number): number | null {
    const withNotes = slots.filter((s) => s.hasNotes && s.slot !== target).map((s) => s.slot);
    const above = withNotes.filter((s) => s < target);
    if (above.length) return Math.max(...above);
    const below = withNotes.filter((s) => s > target);
    return below.length ? Math.min(...below) : null;
}

/** Length: an existing target keeps its own; an empty one takes the source's.
 *  Playback speed always follows the source, so a 1/2-speed A gives a 1/2-speed B. */
export function variationTarget(clips: AiClip[], target: number, source: number): { len: number; scale: [number, number] } {
    const src = clips.find((c) => c.slot === source);
    const tgt = clips.find((c) => c.slot === target);
    return { len: tgt?.len || src?.len || 16, scale: [src?.scaleNum ?? 1, src?.scaleDen ?? 1] };
}
