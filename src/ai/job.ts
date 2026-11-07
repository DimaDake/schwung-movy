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
import { readTrack } from './set-input.js';
import { aiForgetClip, aiSessionOpen, commitPreview, endAllPreviews, openPreview, previewInputOpen, resetPreview } from './preview.js';
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
    if (phase !== 'idle') return;
    /* A generator on top of an open session (user, 2026-10-29): what is
     * showing is kept, and the new one starts from it. */
    if (aiSessionOpen()) {
        const was = previewInputOpen()!;
        commitPreview('another generator');
        aiForgetClip(was.track, was.slot);   // the new run starts from it: that session is over
    }
    const early = spec && spec.r.task === task && spec.r.track === track && spec.r.slot === slot && spec.r.uuid === currentSetUuid() ? spec : null;
    spec = null;
    if (early?.done) { finish(early.done); return; }
    run = early?.r ?? fresh(task, track, slot);
    phase = 'running';
    appState.dirty = true;
}

const fresh = (task: AiTask, track: number, slot: number): Running => ({ task, track, slot, uuid: currentSetUuid(), next: 0, tracks: [],
    ctx: null, gen: null, nonce: Date.now() >>> 0 });

/* A hold takes 1.3 s to fill: the request starts at the press, unseen (no
 * header, no input taken), and the full hold picks it up where it stands,
 * or opens what it already made. A tap, a let-go or a new Set drops it. */
type Step = 'busy' | { open: AiPreviewInput } | { fail: string; why: string };
let spec: { r: Running; done: Exclude<Step, 'busy'> | null } | null = null;

/** A hold that may become this job was pressed: start on it early. */
export function aiPrewarm(task: AiTask, track: number, slot: number): void {
    if (phase !== 'idle' || aiSessionOpen()) return;
    spec = { r: fresh(task, track, slot), done: null };
}

/** The hold that would have used the early start is gone. */
export function aiPrewarmDrop(): void { spec = null; }
export const aiPrewarming = (): boolean => !!spec;

function finish(s: Exclude<Step, 'busy'>): void {
    if ('open' in s) open(s.open); else fail(s.fail, s.why);
}

function send(r: Running): Step {
    const t = r.tracks.find((x) => x.index === r.track) ?? readTrack(r.track);
    const target = jobTarget(r.task, t, r.slot, r.tracks);
    if (target === 'nothing') return { fail: r.task === 'double' ? MSG_NOTHING_DOUBLE : MSG_NOTHING, why: 'nothing to ' + r.task };
    if (target === 'no source') return { fail: MSG_ERROR, why: 'no source clip' };
    r.ctx = { ...target.ctx, srcSlot: target.source };
    r.gen = startAlgo(r, target.source);
    return 'busy';
}

/** One tick of a request: a track read, or a slice of the generators. */
function stepRun(r: Running): Step {
    if (r.next < TRACKS) {
        const t = readTrack(r.next++);
        if (t.clips.length || t.index === r.track) r.tracks.push(t);
        return r.next === TRACKS ? send(r) : 'busy';
    }
    if (!r.gen) return 'busy';
    const p = algoTick(r);
    return p === null ? { fail: MSG_ERROR, why: 'no generator option survived' } : p === 'busy' ? 'busy' : { open: p };
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
    if (phase !== 'running' || !run) {
        if (spec && !spec.done) {
            if (spec.r.uuid !== currentSetUuid()) spec = null;
            else { const s = stepRun(spec.r); if (s !== 'busy') spec.done = s; }
        }
        return;
    }
    const r = run;
    if (r.uuid !== currentSetUuid()) { aiCancel(); return; }
    const s = stepRun(r);
    if (s !== 'busy') finish(s);
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
    spec = null;
    if (phase === 'running') aiCancel();
    endAllPreviews('set change');
}

export function resetAiJob(): void {
    resetPreview();
    run = null;
    spec = null;
    preview = null;
    phase = 'idle';
}
