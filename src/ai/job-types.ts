/* The job's shapes and words (job.ts): what the screen and the preview are
 * handed, and what a running request carries. */

import type { AiClip, AiNote } from './clip-dump.js';
import type { AiConfig } from './config.js';
import type { AiTrackInput } from './context.js';
import type { JobCtx } from './job-target.js';
import type { GenLevel } from './ladders.js';
import type { AiTask } from './prompt.js';

export type AiPhase = 'idle' | 'running' | 'preview';

export const MSG_NO_KEY = 'NO API KEY — MOVE.LOCAL:7700';
export const MSG_ERROR = 'GENERATOR ERROR';
export const MSG_NOTHING = 'NOTHING TO QUANTIZE';

export interface AiPreviewInput {
    task: AiTask;
    track: number;
    slot: number;
    orig: AiClip | null;      // null = the target slot was empty
    options: AiNote[][];
    len: number;
    scaleNum: number;
    scaleDen: number;
}

export interface Running {
    task: AiTask;
    track: number;
    slot: number;
    level: GenLevel;          // read once at start: a Settings turn changes the next request
    cfg: AiConfig;
    uuid: string;
    startMs: number;
    next: number;             // next track to read; TRACKS = all read
    tracks: AiTrackInput[];
    httpId: number;
    sentMs: number;
    ctx: JobCtx | null;
    models: string[];         // models.ts: the bench's pick, then the fast fallback
    mi: number;               // which of them this request went to
    timeoutS: number;
    prompt: { system: string; user: string } | null;
}


export function label(task: AiTask): string { return task === 'quantize' ? 'QUANTIZING...' : 'VARIATION...'; }
