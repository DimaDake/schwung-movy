/* What a job writes and what it grows from (design §2, §3): Smart Quantize
 * rewrites the clip it is on; Variation fills the slot from the track's
 * previous clip, at that clip's speed; Smart Double rewrites the clip at twice
 * its loop's length (plans/2026-10-28-smart-double-design.md); New Clip writes
 * the slot from nothing (plans/2026-10-28-new-clip-design.md). */

import type { AiClip, AiNote } from './clip-dump.js';
import type { AiTrackInput } from './context.js';
import type { AiTask } from './prompt.js';
import { MAX_STEPS } from '../seq/constants.js';
import { kitPads } from './set-input.js';
import { pickSource, variationTarget } from './target.js';

export interface JobCtx {
    len: number;
    scale: [number, number];
    orig: AiClip | null;
    drum: boolean;
    kit: number[];
    units?: 'steps' | 'ticks';
    srcSlot?: number | null; // the clip a variation grows from (the knobs' generators read it)
    source?: AiNote[];      // Variation (facts.ts): what validate.ts checks the role and loops against
    loops?: AiNote[][];
}

/** The job's target, or why there is none ('nothing' to quantize, 'no source'). */
export function jobTarget(task: AiTask, t: AiTrackInput, slot: number, scene: AiTrackInput[] = []): { ctx: JobCtx; source: number | null } | 'nothing' | 'no source' {
    const clip = t.clips.find((c) => c.slot === slot) ?? null;
    if (task === 'create') {
        const len = Math.min(MAX_STEPS, clip?.len || sceneSteps(scene, t.index, slot) || 16);
        return { ctx: { len, scale: [clip?.scaleNum ?? 1, clip?.scaleDen ?? 1], orig: clip, drum: t.drum,
            kit: [...new Set([...kitPads(t), ...(t.pads ?? [])])] }, source: null };
    }
    if (task === 'double') {
        if (!clip || !clip.notes.length || clip.loopStart + clip.len * 2 > MAX_STEPS) return 'nothing';
        return { ctx: { len: clip.len * 2, scale: [clip.scaleNum, clip.scaleDen], orig: clip, drum: t.drum, kit: kitPads(t) }, source: null };
    }
    if (task === 'quantize') {
        if (!clip || !clip.notes.length) return 'nothing';
        return { ctx: { len: clip.len, scale: [clip.scaleNum, clip.scaleDen], orig: clip, drum: t.drum, kit: kitPads(t) }, source: null };
    }
    const source = pickSource(t.clips.map((c) => ({ slot: c.slot, hasNotes: c.notes.length > 0 })), slot);
    if (source === null) return 'no source';
    const v = variationTarget(t.clips, slot, source);
    return { ctx: { len: v.len, scale: v.scale, orig: clip, drum: t.drum, kit: kitPads(t) }, source };
}

/** The longest loop the other tracks play in this slot, in master steps (0: none). */
export function sceneSteps(scene: AiTrackInput[], me: number, slot: number): number {
    const lens = scene.filter((x) => x.index !== me).flatMap((x) => x.clips)
        .filter((c) => c.slot === slot && c.notes.length > 0).map((c) => Math.round((c.len * c.scaleDen) / c.scaleNum));
    return lens.length ? Math.max(...lens) : 0;
}
