/* The AI job (design §5): idle → running → preview. While running only Back
 * (and the power and leave dialogs) does anything; the screen and the LEDs
 * stay the app's, the header naming the job. Reads are spread one track per
 * tick, the request is polled, and nothing in the clip changes until the
 * preview opens. */

import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { MOVY_MODULE_DIR } from '../seq/constants.js';
import { seqHeaderAnnounce, seqToast } from '../seq/render.js';
import { leaveModalActive } from '../app/leave-modal.js';
import { currentSetUuid } from '../seq/set-session.js';
import { readAiConfig } from './config.js';
import { cancelHttp, fakeResponse, pollHttp, startHttp, type HttpReply } from './http-job.js';
import { jobTarget } from './job-target.js';
import { type AiPhase, type AiPreviewInput, label, MSG_ERROR, MSG_NO_KEY, MSG_NOTHING, MSG_NOTHING_DOUBLE, type Running } from './job-types.js';
import { modelChain, timeoutFor, worthFallback } from './models.js';
import type { AiTask } from './prompt.js';
import { LEVEL_TEMPERATURE } from './ladders.js';
import { genLevel } from '../seq/gen-level.js';
import { buildRequest, classifyStatus } from './provider.js';
import { readTrack } from './set-input.js';
import { commitPreview, openPreview, resetPreview } from './preview.js';
import { algoTick, replyGen, startAlgo } from './job-algo.js';
import { modelPrompt, replyOptions } from './job-model.js';
import { genMode } from '../seq/gen-mode.js';

export { MSG_ERROR, MSG_NO_KEY, MSG_NOTHING, MSG_NOTHING_DOUBLE } from './job-types.js';
export type { AiPhase, AiPreviewInput } from './job-types.js';
const TRACKS = 16;

let phase: AiPhase = 'idle';
let run: Running | null = null;
let preview: AiPreviewInput | null = null;

export function aiPhase(): AiPhase { return phase; }
export function aiPreviewInput(): AiPreviewInput | null { return preview; }

/* The job never takes the screen or the LEDs (user, 2026-10-28: the
 * loading animation stuck, and the power-off dialog could not show over it):
 * the header says what runs, everything else draws as always. */
function release(): void { appState.dirty = true; }

function fail(msg: string, why: string): void {
    mlog('ai: ' + why);
    if (run) cancelHttp(run.httpId);
    run = null;
    phase = 'idle';
    release();
    seqToast(msg);
}

export function startAiJob(task: AiTask, track: number, slot: number): void {
    if (phase !== 'idle') return;
    /* A canned reply (device scenarios) needs no key, so a test never has to
     * touch the user's real one; it also pins the model path it stands in for. */
    const fake = fakeResponse(MOVY_MODULE_DIR);
    /* Smart Double and New Clip have no model prompt: one keeps the clip and
     * writes its seams, the other has nothing to vary; the generators do both. */
    const algo = task === 'double' || task === 'create' || (genMode() === 'ALGORITHMIC' && !fake);
    const cfg = algo ? { model: null, key: '' } : readAiConfig(MOVY_MODULE_DIR) ?? (fake ? { model: 'fake', key: '' } : null);
    if (!cfg) { seqToast(MSG_NO_KEY); return; }
    run = { task, track, slot, level: genLevel(), cfg, uuid: currentSetUuid(), startMs: -1, next: 0, tracks: [], httpId: -1,
        sentMs: -1, ctx: null, models: modelChain(cfg), mi: 0, timeoutS: 0, prompt: null, algo, gen: null, nonce: Date.now() >>> 0 };
    phase = 'running';
    appState.dirty = true;
}

function send(r: Running, now: number): void {
    const t = r.tracks.find((x) => x.index === r.track) ?? readTrack(r.track);
    const target = jobTarget(r.task, t, r.slot, r.tracks);
    if (target === 'nothing') return fail(r.task === 'double' ? MSG_NOTHING_DOUBLE : MSG_NOTHING, 'nothing to ' + r.task);
    if (target === 'no source') return fail(MSG_ERROR, 'no source clip');
    r.ctx = { ...target.ctx, srcSlot: target.source };
    if (r.algo) { r.gen = startAlgo(r, target.source); return; }
    r.prompt = modelPrompt(r, t, target.source);
    dispatch(r, now);
}

function dispatch(r: Running, now: number): void {
    const req = buildRequest({ model: r.models[r.mi], key: r.cfg.key }, r.prompt!, LEVEL_TEMPERATURE[r.level]);
    r.timeoutS = timeoutFor(r.mi, r.models.length);
    r.httpId = startHttp(req, MOVY_MODULE_DIR, r.timeoutS);
    if (r.httpId < 0) return fail(MSG_ERROR, 'request not started');
    r.sentMs = now;
    mlog(`ai: ${r.task} t${r.track} s${r.slot} sent ${req.body.length} B to ${r.models[r.mi]} at ${now}`);
}

/** Busy or silent: the next model in the chain, if there is one. */
function fallBack(r: Running, now: number, why: string): boolean {
    if (r.mi + 1 >= r.models.length) return false;
    mlog(`ai: ${r.models[r.mi]} ${why}, asking ${r.models[r.mi + 1]}`);
    cancelHttp(r.httpId);
    r.mi++;
    dispatch(r, now);
    return true;
}

function finish(r: Running, reply: HttpReply, now: number): void {
    const status = classifyStatus(reply.http, reply.curlExit);
    if (worthFallback(status, reply.http, r.cfg.model !== null && r.mi === 0) && fallBack(r, now, `busy (http ${reply.http} curl ${reply.curlExit})`)) return;
    if (status !== 'ok') return fail(status, `http ${reply.http} curl ${reply.curlExit} ${reply.body.slice(0, 200)}`);
    const { v, text } = replyOptions(r, reply.body);
    const c = r.ctx!;
    if (!v?.options.length) return fail(MSG_ERROR, 'no usable option: ' + text);
    open({ task: r.task, track: r.track, slot: r.slot, orig: c.orig, options: v.options, slots: v.slots,
        len: c.len, scaleNum: c.scale[0], scaleDen: c.scale[1], gen: replyGen(r, v.options) });
}

function open(p: AiPreviewInput): void {
    preview = p;
    run = null;
    phase = 'preview';
    release();
    openPreview(p);
}

/** Per tick while a request runs; the frame stays the app's. */
export function aiTick(now: number): void {
    if (phase !== 'running' || !run) return;
    const r = run;
    if (r.startMs < 0) r.startMs = now;
    if (r.uuid !== currentSetUuid()) { aiCancel(); return; }
    if (r.next < TRACKS) {
        const t = readTrack(r.next++);
        if (t.clips.length || t.index === r.track) r.tracks.push(t);
        if (r.next === TRACKS) send(r, now);
    } else if (r.gen) {
        const p = algoTick(r);
        if (p === null) fail(MSG_ERROR, 'no generator option survived');
        else if (p !== 'busy') open(p);
    } else {
        const reply = pollHttp(r.httpId);
        if (reply) finish(r, reply, now);
        /* curl has its own timeout; past it plus a margin the child is gone
         * without a word, and only Back would ever end the wait. */
        else if (r.sentMs >= 0 && now - r.sentMs > (r.timeoutS + 10) * 1000
            && !fallBack(r, now, 'silent past the watchdog')) fail(MSG_ERROR, 'no reply within the watchdog');
    }
    if (phase !== 'running') return;
    /* A model request takes seconds: they count on the right. */
    const s = Math.floor((now - r.startMs) / 1000);
    seqHeaderAnnounce(label(r.task), 8, r.algo ? '' : s + ' S');
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
    cancelHttp(run.httpId);
    run = null;
    phase = 'idle';
    release();
}

/** The preview is over (committed by preview.ts). */
export function endAiPreview(): void {
    preview = null;
    if (phase === 'preview') phase = 'idle';
}

/** A Set is about to be replaced: a request in flight is abandoned. */
export function aiSetWillChange(): void {
    if (phase === 'running') aiCancel();
    commitPreview();   // a no-op unless a preview is open
}

export function resetAiJob(): void {
    if (run) cancelHttp(run.httpId);
    resetPreview();
    run = null;
    preview = null;
    phase = 'idle';
}
