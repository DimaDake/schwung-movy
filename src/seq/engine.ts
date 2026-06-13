/* The only file that talks IPC for the sequencer.
 *
 * Boot: the framework's overtake_dsp:load is fire-and-forget on a single-
 * slot param SHM, so it can be overwritten before the shim consumes it
 * (and a previously loaded engine survives redeploys). The UI therefore
 * probes `ping` and re-issues the load itself until the reported version
 * matches ENGINE_VERSION — making both tool launch and engine redeploys
 * self-healing.
 *
 * Steady state: commands queue during an app tick and flush as ONE batched
 * `set_param("cmd", "op;op;…")` — the param channel is a single slot, so
 * multiple writes per tick can clobber each other. Status comes back via
 * one `get_param("status")` poll every STATUS_POLL_TICKS; each get blocks
 * ~3-5 ms on device, so the cadence is a deliberate IPC budget. */

import { mlog } from '../log.js';
import { ENGINE_DSP_PATH, ENGINE_VERSION } from './constants.js';
import { activeFromStr, muteFromStr, occFromHex, seqState, sessionFromStr } from './state.js';

const STATUS_POLL_TICKS = 8;  // ~24 Hz at the ~196 Hz device tick rate
const PROBE_TICKS = 30;       // ping cadence while booting
const PROBES_PER_LOAD = 10;   // failed pings before (re)issuing a load
const MAX_LOADS = 3;          // load attempts before giving up
const MAX_STATUS_FAILURES = 16;

type BootState = 'probe' | 'ok' | 'absent';

const cmdQueue: string[] = [];
let bootState: BootState = 'probe';
let probeCountdown = 1;
let probeFailures = 0;
let loadAttempts = 0;
let pollCountdown = 1;
let statusFailures = 0;

export function engineAvailable(): boolean {
    return typeof host_module_set_param === 'function'
        && typeof host_module_get_param === 'function';
}

/* Sets MUST block: non-blocking writes share a single-slot param SHM with
 * movy's own blocking param GETs and get clobbered before the shim consumes
 * them (observed on device: even the framework's own DSP-load request was
 * lost this way). */
function engineSet(key: string, value: string): void {
    if (typeof host_module_set_param_blocking === 'function') {
        host_module_set_param_blocking(key, value, 50);
    } else {
        host_module_set_param(key, value);
    }
}

export function engineReady(): boolean {
    return bootState === 'ok';
}

/* Monotonic UI-tick counter, for short interaction timers (e.g. double-tap
 * detection) that need a coarse clock without wall-time access. */
let uiTickCount = 0;
export function uiTick(): number {
    return uiTickCount;
}

/* Queue one engine op, e.g. "play" or "tog 0 0 60 100". Sent on the next
 * tick (held through boot, dropped only if the engine never appears). */
export function seqCmd(op: string): void {
    cmdQueue.push(op);
}

export function seqEngineTick(): void {
    uiTickCount++;
    if (!engineAvailable()) return;
    if (bootState === 'absent') return;
    if (bootState === 'probe') {
        probeTick();
        return;
    }
    if (cmdQueue.length > 0) {
        engineSet('cmd', cmdQueue.join(';'));
        cmdQueue.length = 0;
    }
    if (--pollCountdown <= 0) {
        pollCountdown = STATUS_POLL_TICKS;
        const s = host_module_get_param('status');
        if (s === null) {
            /* Engine vanished (unloaded/replaced) — reprobe. */
            if (++statusFailures >= MAX_STATUS_FAILURES) {
                mlog('seq: engine lost — reprobing');
                bootState = 'probe';
                probeCountdown = 1;
                probeFailures = 0;
            }
            return;
        }
        statusFailures = 0;
        parseStatus(s);
    }
}

function probeTick(): void {
    if (--probeCountdown > 0) return;
    probeCountdown = PROBE_TICKS;
    const pong = host_module_get_param('ping');
    if (pong === 'pong ' + ENGINE_VERSION) {
        mlog('seq: engine ready v' + ENGINE_VERSION);
        bootState = 'ok';
        statusFailures = 0;
        pollCountdown = 1;
        return;
    }
    probeFailures++;
    const stale = pong !== null;
    if (stale || probeFailures >= PROBES_PER_LOAD) {
        probeFailures = 0;
        if (loadAttempts >= MAX_LOADS) {
            mlog('seq: engine unavailable after ' + MAX_LOADS + ' load attempts');
            bootState = 'absent';
            cmdQueue.length = 0;
            return;
        }
        loadAttempts++;
        mlog('seq: requesting engine load #' + loadAttempts + (stale ? ' (stale ' + pong + ')' : ''));
        /* "load" is handled by the shim itself (dlopen), routed through the
         * same overtake_dsp: prefix as instance params. */
        engineSet('load', ENGINE_DSP_PATH);
    }
}

/* Status format: space-separated key=value pairs, e.g.
 * "play=1 tick=4321 bpm=12000 trk=0 step=3 len=16 occ=<64 hex>". Unknown
 * keys are ignored so the engine can extend the format freely. */

/* Engine-reported play state from the previous poll — kept separately from
 * the mirror (which the UI updates optimistically) so real transport
 * transitions are always logged. */
let lastEnginePlay: boolean | null = null;

function parseStatus(s: string): void {
    seqState.engineOk = true;
    for (const kv of s.split(' ')) {
        const eq = kv.indexOf('=');
        if (eq <= 0) continue;
        const key = kv.slice(0, eq);
        const val = kv.slice(eq + 1);
        if (key === 'play') seqState.playing = val === '1';
        else if (key === 'tick') seqState.engineTick = Number(val) || 0;
        else if (key === 'bpm') seqState.bpmX100 = Number(val) || seqState.bpmX100;
        else if (key === 'trk') seqState.watchTrack = Number(val) || 0;
        else if (key === 'step') seqState.curStep = Number(val) || 0;
        else if (key === 'len') seqState.lenSteps = Number(val) || 0;
        else if (key === 'lstart') seqState.loopStart = Number(val) || 0;
        else if (key === 'rec') seqState.recording = val === '1';
        else if (key === 'cin') seqState.countingIn = val === '1';
        else if (key === 'metro') seqState.metro = val === '1';
        else if (key === 'dirty') seqState.dirty = val === '1';
        else if (key === 'act') activeFromStr(val);
        else if (key === 'mute') muteFromStr(val);
        else if (key === 'sess') sessionFromStr(val);
        else if (key === 'occ') occFromHex(val);
    }
    if (lastEnginePlay !== seqState.playing) {
        mlog('seq: play=' + (seqState.playing ? 1 : 0));
        lastEnginePlay = seqState.playing;
    }
}

/* Test hook: reset boot/queue/backoff between test cases. */
export function resetSeqEngine(): void {
    cmdQueue.length = 0;
    bootState = 'probe';
    probeCountdown = 1;
    probeFailures = 0;
    loadAttempts = 0;
    pollCountdown = 1;
    statusFailures = 0;
    lastEnginePlay = null;
}
