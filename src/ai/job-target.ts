/* What a job writes and what it grows from (design §2, §3): Smart Quantize
 * rewrites the clip it is on; Variation fills the slot from the track's
 * previous clip, at that clip's speed. */

import type { AiClip, AiNote } from './clip-dump.js';
import type { AiTrackInput } from './context.js';
import type { AiTask } from './prompt.js';
import { kitPads } from './set-input.js';
import { pickSource, variationTarget } from './target.js';

export interface JobCtx {
    len: number;
    scale: [number, number];
    orig: AiClip | null;
    drum: boolean;
    kit: number[];
    units?: 'steps' | 'ticks';
    source?: AiNote[];      // Variation (facts.ts): what validate.ts checks the role and loops against
    loops?: AiNote[][];
}

/** The job's target, or why there is none ('nothing' to quantize, 'no source'). */
export function jobTarget(task: AiTask, t: AiTrackInput, slot: number): { ctx: JobCtx; source: number | null } | 'nothing' | 'no source' {
    const clip = t.clips.find((c) => c.slot === slot) ?? null;
    if (task === 'quantize') {
        if (!clip || !clip.notes.length) return 'nothing';
        return { ctx: { len: clip.len, scale: [clip.scaleNum, clip.scaleDen], orig: clip, drum: t.drum, kit: kitPads(t) }, source: null };
    }
    const source = pickSource(t.clips.map((c) => ({ slot: c.slot, hasNotes: c.notes.length > 0 })), slot);
    if (source === null) return 'no source';
    const v = variationTarget(t.clips, slot, source);
    return { ctx: { len: v.len, scale: v.scale, orig: clip, drum: t.drum, kit: kitPads(t) }, source };
}
