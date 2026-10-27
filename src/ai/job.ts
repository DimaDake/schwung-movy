/* The AI job (design §5): idle → running → preview. While running the job
 * owns the screen and the LEDs and only Back does anything; tick.ts hands it
 * the frame through aiTick. Reads are spread one track per tick, the request
 * is polled, and nothing in the clip changes until the preview opens. */

import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { MOVY_MODULE_DIR } from '../seq/constants.js';
import { seqLedsInvalidate } from '../seq/led-cache.js';
import { seqToast } from '../seq/render.js';
import { currentSetUuid } from '../seq/set-session.js';
import { readAiConfig } from './config.js';
import { buildContext } from './context.js';
import { cancelHttp, fakeResponse, pollHttp, startHttp, type HttpReply } from './http-job.js';
import { jobTarget } from './job-target.js';
import { type AiPhase, type AiPreviewInput, label, MSG_ERROR, MSG_NO_KEY, MSG_NOTHING, type Running } from './job-types.js';
import { modelChain, timeoutFor, worthFallback } from './models.js';
import { buildPrompt, type AiTask } from './prompt.js';
import { LEVEL_TEMPERATURE } from './ladders.js';
import { genLevel } from '../seq/gen-level.js';
import { buildRequest, classifyStatus, extractText } from './provider.js';
import { drawAiRunning, resetAiRunningDraw } from './running-render.js';
import { readTrack, setHeader } from './set-input.js';
import { commitPreview, openPreview, resetPreview } from './preview.js';
import { THINK_FADE_SETTLE_MS, thinkingLedsStart, thinkingLedsTick } from './thinking-leds.js';
import { validateOptions } from './validate.js';

export { MSG_ERROR, MSG_NO_KEY, MSG_NOTHING } from './job-types.js';
export type { AiPhase, AiPreviewInput } from './job-types.js';
const TRACKS = 16;

let phase: AiPhase = 'idle';
let run: Running | null = null;
let preview: AiPreviewInput | null = null;
/* -2 none due; -1 due, its clock starts on the next tick; else when. */
let repaintAt = -2;

export function aiPhase(): AiPhase { return phase; }
export function aiPreviewInput(): AiPreviewInput | null { return preview; }

/* Leaving the running phase hands the frame back: every painter repaints. */
function release(): void {
    seqLedsInvalidate();
    appState.initLedsDone = false;
    appState.initLedIndex = 0;
    appState.dirty = true;
    resetAiRunningDraw();
    repaintAt = -1;
}

/* The sweep's last fades can finish over the repaint release() asked for and
 * leave pads in sweep colours; paint everything once more after them. */
function repaintAfterFades(now: number): void {
    if (repaintAt === -1) repaintAt = now + THINK_FADE_SETTLE_MS;
    else if (now >= repaintAt) { repaintAt = -2; seqLedsInvalidate(); appState.dirty = true; }
}

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
     * touch the user's real one. */
    const cfg = readAiConfig(MOVY_MODULE_DIR)
        ?? (fakeResponse(MOVY_MODULE_DIR) ? { model: 'fake', key: '' } : null);
    if (!cfg) { seqToast(MSG_NO_KEY); return; }
    run = { task, track, slot, level: genLevel(), cfg, uuid: currentSetUuid(), startMs: -1,
        next: 0, tracks: [], httpId: -1, sentMs: -1, ctx: null, models: modelChain(cfg), mi: 0, timeoutS: 0, prompt: null };
    phase = 'running';
    thinkingLedsStart();
}

function send(r: Running, now: number): void {
    const t = r.tracks.find((x) => x.index === r.track) ?? readTrack(r.track);
    const target = jobTarget(r.task, t, r.slot);
    if (target === 'nothing') return fail(MSG_NOTHING, 'nothing to quantize');
    if (target === 'no source') return fail(MSG_ERROR, 'no source clip');
    r.ctx = target.ctx;
    const context = buildContext({ ...setHeader(), tracks: r.tracks, target: { track: r.track, slot: r.slot },
        source: target.source === null ? null : { track: r.track, slot: target.source } });
    const prompt = buildPrompt(r.task, context, { len: r.ctx.len, drum: t.drum, level: r.level });
    r.ctx.units = prompt.units;
    r.prompt = prompt;
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
    const text = extractText(reply.body);
    const c = r.ctx!;
    const options = text === null ? [] : validateOptions(text, {
        task: r.task, len: c.len, drum: c.drum, original: c.orig?.notes ?? [], kitPads: c.kit, units: c.units });
    if (!options.length) return fail(MSG_ERROR, 'no usable option: ' + (text ?? reply.body).slice(0, 200));
    preview = { task: r.task, track: r.track, slot: r.slot, orig: c.orig, options,
        len: c.len, scaleNum: c.scale[0], scaleDen: c.scale[1] };
    run = null;
    phase = 'preview';
    release();
    openPreview(preview);
}

/** true = the job owns this frame (tick.ts draws nothing else). */
export function aiTick(now: number): boolean {
    if (repaintAt > -2 && phase !== 'running') repaintAfterFades(now);
    if (phase !== 'running' || !run) return false;
    const r = run;
    if (r.startMs < 0) r.startMs = now;
    if (r.uuid !== currentSetUuid()) { aiCancel(); return false; }
    if (r.next < TRACKS) {
        const t = readTrack(r.next++);
        if (t.clips.length || t.index === r.track) r.tracks.push(t);
        if (r.next === TRACKS) send(r, now);
    } else {
        const reply = pollHttp(r.httpId);
        if (reply) finish(r, reply, now);
        /* curl has its own timeout; past it plus a margin the child is gone
         * without a word, and only Back would ever end the wait. */
        else if (r.sentMs >= 0 && now - r.sentMs > (r.timeoutS + 10) * 1000
            && !fallBack(r, now, 'silent past the watchdog')) fail(MSG_ERROR, 'no reply within the watchdog');
    }
    if (phase !== 'running') return false;
    drawAiRunning(label(r.task), now - r.startMs);
    thinkingLedsTick(now - r.startMs);
    return true;
}

/** Running input: Back cancels, every other PRESS is swallowed, releases pass
 *  so a handler that armed a hold still hears its button come up. */
export function aiRunningInput(data: number[]): boolean {
    if (phase !== 'running') return false;
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
    repaintAt = -2;
    resetPreview();
    run = null;
    preview = null;
    phase = 'idle';
}
