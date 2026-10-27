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
import type { AiClip, AiNote } from './clip-dump.js';
import { readAiConfig, type AiConfig } from './config.js';
import { buildContext, type AiTrackInput } from './context.js';
import { cancelHttp, pollHttp, startHttp, type HttpReply } from './http-job.js';
import { buildPrompt, type AiTask } from './prompt.js';
import { buildRequest, classifyStatus, extractText } from './provider.js';
import { drawAiRunning, resetAiRunningDraw } from './running-render.js';
import { kitPads, readTrack, setHeader } from './set-input.js';
import { commitPreview, openPreview, resetPreview } from './preview.js';
import { pickSource, variationTarget } from './target.js';
import { thinkingLedsStart, thinkingLedsTick } from './thinking-leds.js';
import { validateOptions } from './validate.js';

export type AiPhase = 'idle' | 'running' | 'preview';

export const MSG_NO_KEY = 'NO API KEY — MOVE.LOCAL:7700';
export const MSG_ERROR = 'AI ERROR';
export const MSG_NOTHING = 'NOTHING TO QUANTIZE';
const TRACKS = 16;

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

interface Running {
    task: AiTask;
    track: number;
    slot: number;
    cfg: AiConfig;
    uuid: string;
    startMs: number;
    next: number;             // next track to read; TRACKS = all read
    tracks: AiTrackInput[];
    httpId: number;
    ctx: { len: number; scale: [number, number]; orig: AiClip | null; drum: boolean; kit: number[] } | null;
}

let phase: AiPhase = 'idle';
let run: Running | null = null;
let preview: AiPreviewInput | null = null;

export function aiPhase(): AiPhase { return phase; }
export function aiPreviewInput(): AiPreviewInput | null { return preview; }

function label(task: AiTask): string { return task === 'quantize' ? 'QUANTIZING...' : 'VARIATION...'; }

/* Leaving the running phase hands the frame back: every painter repaints. */
function release(): void {
    seqLedsInvalidate();
    appState.initLedsDone = false;
    appState.initLedIndex = 0;
    appState.dirty = true;
    resetAiRunningDraw();
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
    const cfg = readAiConfig(MOVY_MODULE_DIR);
    if (!cfg) { seqToast(MSG_NO_KEY); return; }
    run = { task, track, slot, cfg, uuid: currentSetUuid(), startMs: -1, next: 0, tracks: [], httpId: -1, ctx: null };
    phase = 'running';
    thinkingLedsStart();
}

function send(r: Running, now: number): void {
    const t = r.tracks.find((x) => x.index === r.track) ?? readTrack(r.track);
    const clip = t.clips.find((c) => c.slot === r.slot) ?? null;
    let source: number | null = null;
    if (r.task === 'quantize') {
        if (!clip || !clip.notes.length) return fail(MSG_NOTHING, 'nothing to quantize');
        r.ctx = { len: clip.len, scale: [clip.scaleNum, clip.scaleDen], orig: clip, drum: t.drum, kit: kitPads(t) };
    } else {
        source = pickSource(t.clips.map((c) => ({ slot: c.slot, hasNotes: c.notes.length > 0 })), r.slot);
        if (source === null) return fail(MSG_ERROR, 'no source clip');
        const v = variationTarget(t.clips, r.slot, source);
        r.ctx = { len: v.len, scale: v.scale, orig: clip, drum: t.drum, kit: kitPads(t) };
    }
    const context = buildContext({ ...setHeader(), tracks: r.tracks, target: { track: r.track, slot: r.slot },
        source: source === null ? null : { track: r.track, slot: source } });
    const req = buildRequest(r.cfg, buildPrompt(r.task, context, { len: r.ctx.len, drum: t.drum }));
    r.httpId = startHttp(req, MOVY_MODULE_DIR);
    if (r.httpId < 0) return fail(MSG_ERROR, 'request not started');
    mlog(`ai: ${r.task} t${r.track} s${r.slot} sent ${req.body.length} B at ${now}`);
}

function finish(r: Running, reply: HttpReply): void {
    const status = classifyStatus(reply.http, reply.curlExit);
    if (status !== 'ok') return fail(status, `http ${reply.http} curl ${reply.curlExit} ${reply.body.slice(0, 200)}`);
    const text = extractText(r.cfg.provider, reply.body);
    const c = r.ctx!;
    const options = text === null ? [] : validateOptions(text, {
        task: r.task, len: c.len, drum: c.drum, original: c.orig?.notes ?? [], kitPads: c.kit });
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
        if (reply) finish(r, reply);
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
    resetPreview();
    run = null;
    preview = null;
    phase = 'idle';
}
