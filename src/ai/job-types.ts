/* The job's shapes and words (job.ts): what the screen and the preview are
 * handed, and what a running request carries. */

import type { AiClip, AiNote } from './clip-dump.js';
import type { AiTrackInput } from './set-input.js';
import type { JobCtx } from './job-target.js';
import type { GenCtx } from '../gen/analysis/context.js';
import type { Request } from '../gen/engine.js';
import type { Preset } from '../gen/preset.js';
import type { GenLevel, Task } from '../gen/types.js';
import { STEP_AI_VARIATION, STEP_DOUBLE_LOOP, STEP_QUANTIZE } from '../seq/constants.js';

export type AiTask = Task;

export type AiPhase = 'idle' | 'running' | 'preview';

export const MSG_ERROR = 'GENERATOR ERROR';
export const MSG_NOTHING = 'NOTHING TO QUANTIZE';
export const MSG_NOTHING_DOUBLE = 'NOTHING TO DOUBLE';

export interface AiPreviewInput {
    task: AiTask;
    track: number;
    slot: number;
    orig: AiClip | null;      // null = the target slot was empty
    options: AiNote[][];
    len: number;
    scaleNum: number;
    scaleDen: number;
    /* What made each option, so its knobs can make it again. */
    gen?: { ctx: GenCtx; picks: { preset: Preset; knobs: number[] }[] };
}

export interface Running {
    task: AiTask;
    track: number;
    slot: number;
    level: GenLevel;          // read once at start: a Settings turn changes the next request
    uuid: string;
    next: number;             // next track to read; TRACKS = all read
    tracks: AiTrackInput[];
    ctx: JobCtx | null;
    gen: Request | null;      // the generators' request, once the reads are in
    nonce: number;            // New Clip: this run's own seed (gen/create)
}


const LABELS: Record<AiTask, string> = { quantize: 'QUANTIZING...', variation: 'VARIATION...', double: 'DOUBLING...', create: 'NEW CLIP...' };
export function label(task: AiTask): string { return LABELS[task]; }

/* The Shift + Step entry each generator is reached by; its icon is lit while
 * the clip on screen has a session, as an open page's is. */
const ENTRY: Record<AiTask, number> = { quantize: STEP_QUANTIZE, variation: STEP_AI_VARIATION, double: STEP_DOUBLE_LOOP, create: STEP_AI_VARIATION };
export function entryStep(task: AiTask): number { return ENTRY[task]; }
