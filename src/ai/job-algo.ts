/* The job's algorithmic path (plans/2026-10-27-algorithmic-generators-design.md
 * §7): the same Set reads as a model request, then the generators in slices —
 * one preset per tick — and the same preview. No key, no network. */

import { mlog } from '../log.js';
import { finishRequest, prepare, type Request, startRequest, stepRequest } from '../gen/engine.js';
import { defaults } from '../gen/preset.js';
import { replyPreset } from '../gen/presets/reply.js';
import type { AiNote } from './clip-dump.js';
import type { GenInput } from '../gen/types.js';
import type { AiPreviewInput, Running } from './job-types.js';
import { setHeader } from './set-input.js';

function inputOf(r: Running, source: number | null): GenInput {
    const c = r.ctx!;
    const h = setHeader();
    return {
        task: r.task, level: r.level, tracks: r.tracks, target: { track: r.track, slot: r.slot },
        source: source === null ? null : { track: r.track, slot: source },
        len: c.len, scale: c.scale, drum: c.drum, kit: c.kit, root: h.root, mode: h.mode,
    };
}

export function startAlgo(r: Running, source: number | null): Request {
    return startRequest(inputOf(r, source));
}

/** A model's options as REPLY presets, so they have knobs too (design §5.2). */
export function replyGen(r: Running, options: AiNote[][]): AiPreviewInput['gen'] {
    const ctx = prepare(inputOf(r, r.ctx!.srcSlot ?? null));
    return { ctx, picks: options.map((o) => {
        const preset = replyPreset(r.task, r.ctx!.drum, o);
        return { preset, knobs: defaults(preset, ctx) };
    }) };
}

/** One preset run; the preview input once all ran, null when none survived,
 *  'busy' until then. */
export function algoTick(r: Running): AiPreviewInput | null | 'busy' {
    const g = r.gen!;
    if (!stepRequest(g)) return 'busy';
    const picks = finishRequest(g);
    if (g.dropped.length) mlog('gen: dropped ' + g.dropped.join(' '));
    mlog(`gen: ${r.task} t${r.track} s${r.slot} ${g.ctx.freedom} key ${g.ctx.key.tonic}${g.ctx.key.minor ? 'm' : ''} `
        + `options ${picks.map((p) => p.preset.id).join(' ')}`);
    if (!picks.length) return null;
    const c = r.ctx!;
    return {
        task: r.task, track: r.track, slot: r.slot, orig: c.orig, options: picks.map((p) => p.notes),
        len: c.len, scaleNum: c.scale[0], scaleDen: c.scale[1],
        gen: { ctx: g.ctx, picks: picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs] })) },
    };
}
