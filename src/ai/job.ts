/* The generator job (design §5): idle → running → preview. While running only
 * Back (and the power and leave dialogs) does anything; the screen and the
 * LEDs stay the app's, the header naming the job. Reads are spread one track
 * per tick, the generators run one preset per tick, and nothing in the clip
 * changes until the preview opens. */

import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { seqHeaderAnnounce, seqToast } from '../seq/render.js';
import { leaveModalActive } from '../app/leave-modal.js';
import { currentSetUuid } from '../seq/set-session.js';
import { jobTarget } from './job-target.js';
import { type AiPhase, type AiPreviewInput, type AiTask, label, MSG_ERROR, MSG_NOTHING, MSG_NOTHING_DOUBLE, type Running } from './job-types.js';
import { genLevel } from '../seq/gen-level.js';
import { readTrack } from './set-input.js';
import { aiSessionOpen, endAllPreviews, openPreview, resetPreview } from './preview.js';
import { algoTick, startAlgo } from './job-algo.js';

export { MSG_ERROR, MSG_NOTHING, MSG_NOTHING_DOUBLE } from './job-types.js';
export type { AiPhase, AiPreviewInput, AiTask } from './job-types.js';
const TRACKS = 16;

let phase: AiPhase = 'idle';
let run: Running | null = null;
let preview: AiPreviewInput | null = null;

/* 'preview' is not a phase of the job: a session lives on its clip
 * (preview.ts), so the job is idle again the moment one opens. */
export function aiPhase(): AiPhase { return phase === 'running' ? phase : aiSessionOpen() ? 'preview' : 'idle'; }
export function aiPreviewInput(): AiPreviewInput | null { return preview; }

/* The job never takes the screen or the LEDs (user, 2026-10-28: the
 * loading animation stuck, and the power-off dialog could not show over it):
 * the header says what runs, everything else draws as always. */
function release(): void { appState.dirty = true; }

function fail(msg: string, why: string): void {
    mlog('ai: ' + why);
    run = null;
    phase = 'idle';
    release();
    seqToast(msg);
}

export function startAiJob(task: AiTask, track: number, slot: number): void {
    if (phase !== 'idle' || aiSessionOpen()) return;
    run = { task, track, slot, level: genLevel(), uuid: currentSetUuid(), next: 0, tracks: [],
        ctx: null, gen: null, nonce: Date.now() >>> 0 };
    phase = 'running';
    appState.dirty = true;
}

function send(r: Running): void {
    const t = r.tracks.find((x) => x.index === r.track) ?? readTrack(r.track);
    const target = jobTarget(r.task, t, r.slot, r.tracks);
    if (target === 'nothing') return fail(r.task === 'double' ? MSG_NOTHING_DOUBLE : MSG_NOTHING, 'nothing to ' + r.task);
    if (target === 'no source') return fail(MSG_ERROR, 'no source clip');
    r.ctx = { ...target.ctx, srcSlot: target.source };
    r.gen = startAlgo(r, target.source);
}

function open(p: AiPreviewInput): void {
    preview = p;
    run = null;
    phase = 'idle';
    release();
    openPreview(p);
}

/** Per tick while a request runs; the frame stays the app's. */
export function aiTick(): void {
    if (phase !== 'running' || !run) return;
    const r = run;
    if (r.uuid !== currentSetUuid()) { aiCancel(); return; }
    if (r.next < TRACKS) {
        const t = readTrack(r.next++);
        if (t.clips.length || t.index === r.track) r.tracks.push(t);
        if (r.next === TRACKS) send(r);
    } else if (r.gen) {
        const p = algoTick(r);
        if (p === null) fail(MSG_ERROR, 'no generator option survived');
        else if (p !== 'busy') open(p);
    }
    if (phase !== 'running') return;
    seqHeaderAnnounce(label(r.task), 8, '');
}

/** Running input: Back cancels, every other PRESS is swallowed, releases pass
 *  so a handler that armed a hold still hears its button come up. */
export function aiRunningInput(data: number[]): boolean {
    /* The power and leave dialogs answer while a request runs. */
    if (phase !== 'running' || leaveModalActive()) return false;
    const kind = data[0] & 0xF0;
    const press = (kind === 0x90 || kind === 0xB0) && data[2] > 0;
    if (kind === 0xB0 && data[1] === MoveBack && press) { aiCancel(); return true; }
    return press;
}

export function aiCancel(): void {
    if (phase !== 'running' || !run) return;
    run = null;
    phase = 'idle';
    release();
}

/** The preview is over (committed by preview.ts). */
export function endAiPreview(): void { preview = null; }

/** A Set is about to be replaced: a running request is abandoned, every
 *  session ends where it stands. */
export function aiSetWillChange(): void {
    if (phase === 'running') aiCancel();
    endAllPreviews('set change');
}

export function resetAiJob(): void {
    resetPreview();
    run = null;
    preview = null;
    phase = 'idle';
}
