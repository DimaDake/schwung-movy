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
import { CHAIN_MODULE_DIR, ENGINE_DSP_PATH, ENGINE_VERSION, MOVY_MODULE_DIR } from './constants.js';
import { activeFromStr, adoptLoopWindow, muteFromStr, occFromHex, seqState, sessionFromStr } from './state.js';
import { rationalToIdx } from './clip-scale.js';
import { markUiStateDirty } from './ui-dirty.js';
import { applyFlagsToEngine } from './flags.js';
import { resetPadRoute, syncPadRoute } from '../track/pad-route.js';

/* -1 until the first poll: the opening value is not a change, and treating it
 * as one would mark every fresh open dirty and rewrite the set for nothing. */
let lastChainGen = -1;

const STATUS_POLL_TICKS = 8;  // ~24 Hz at the ~196 Hz device tick rate
const PROBE_TICKS = 30;       // ping cadence while booting
const PROBES_PER_LOAD = 10;   // failed pings before (re)issuing a load
const MAX_LOADS = 3;          // consecutive load attempts before backing off
const MAX_STATUS_FAILURES = 16;
/* Ticks spent in 'absent' before probing again (~10-30 s at the 63-205 Hz
 * device tick). Giving up permanently was wrong: the single overtake_dsp slot
 * is shared, so another tool can take the engine away and hand it back long
 * after we stopped asking. */
const ABSENT_RETRY_TICKS = 2000;

type BootState = 'probe' | 'ok' | 'absent';

const cmdQueue: string[] = [];
let bootState: BootState = 'probe';
/* Bumped every time the engine enters service. A re-dlopen after a wedge comes
 * up as a brand new, EMPTY Engine; persist.ts compares this against the
 * generation whose contents it authored, so it can never autosave over a set
 * with an engine it did not restore. */
let generation = 0;
let probeCountdown = 1;
let probeFailures = 0;
let loadAttempts = 0;
let absentCountdown = 0;
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

export function engineGeneration(): number { return generation; }

export function engineReady(): boolean {
    return bootState === 'ok';
}

/** The engine has stopped being probed for now — it never answered, or it
 *  stopped answering and gave up. The session turns this into a visible
 *  failure rather than an indefinite loading screen. */
export function engineAbsent(): boolean {
    return bootState === 'absent';
}

/* Monotonic UI-tick counter, for short interaction timers (e.g. double-tap
 * detection) that need a coarse clock without wall-time access. */
let uiTickCount = 0;
export function uiTick(): number {
    return uiTickCount;
}

/* Undo's inspection hook, registered by undo/record.ts. Lives as a callback
 * rather than a direct import because undo/ imports this file — and because a
 * hook here catches EVERY seqCmd, including a new call site that never thought
 * about undo. That is the point: a bypass is exactly what it must notice. */
let editGuard: ((op: string) => void) | null = null;
export function setEditGuard(fn: ((op: string) => void) | null): void {
    editGuard = fn;
}

/* Queue one engine op, e.g. "play" or "tog 0 0 60 100". Sent on the next
 * tick (held through boot, dropped only if the engine never appears). */
export function seqCmd(op: string): void {
    if (editGuard) editGuard(op);
    cmdQueue.push(op);
}

/* Send the queued ops now rather than on the next tick. Teardown has no next
 * tick, so anything the engine must have applied before its state is
 * serialized — a note-off closing a recording capture — has to go out here. */
export function seqCmdFlush(): void {
    if (!engineReady() || cmdQueue.length === 0) return;
    engineSet('cmd', cmdQueue.join(';'));
    cmdQueue.length = 0;
}

/* Automation label re-sync request: set on engine boot/reload; the app tick
 * consumes it once to fetch `alabels` and rebuild the lane registry. */
let labelSyncPending = false;
export function requestLabelSync(): void { labelSyncPending = true; }
export function takeLabelSync(): boolean {
    if (!labelSyncPending) return false;
    labelSyncPending = false;
    return true;
}

/* The engine reports (via `unop`) that a committed group changed nothing. Held
 * here and drained by the app tick rather than dispatched directly, so this
 * file keeps no import of undo/ — which imports this one. */
let noopSnapId = -1;
export function takeNoopSnapId(): number {
    const id = noopSnapId;
    noopSnapId = -1;
    return id;
}

export function seqEngineTick(): void {
    uiTickCount++;
    if (!engineAvailable()) return;
    if (bootState === 'absent') {
        if (--absentCountdown > 0) return;
        mlog('seq: retrying engine probe');
        bootState = 'probe';
        probeCountdown = 1;
        probeFailures = 0;
        loadAttempts = 0;
        return;
    }
    if (bootState === 'probe') {
        probeTick();
        return;
    }
    /* Keep the engine's pad map current. Rebuilt and compared every tick — the
     * comparison is what makes it correct, because the set of things that change
     * the mapping (track, octave, root, scale, layout, drum lane, module) is a
     * list that would rot, and a stale map sends notes to the wrong pitch. */
    syncPadRoute(engineSet);
    seqCmdFlush();
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
        generation++;
        statusFailures = 0;
        /* A healthy engine clears the load budget. Without this the three
         * attempts were cumulative over the whole session, so three unrelated
         * engine losses — each recovered at the time — added up to a permanent
         * 'absent': every later command silently dropped while the DSP played
         * on, and only reopening movy brought the sequencer back. */
        loadAttempts = 0;
        pollCountdown = 1;
        /* Only the UI knows the install paths, so it hands them over once the
         * engine answers. Sent on every (re)boot because a re-dlopened engine
         * is a brand new one that has never been told. Refreshing the private
         * copy and dlopening the chain host both happen inside this set, off
         * the render path. */
        /* Before `chain_host`, which is where the chains start existing: the
         * flags decide how they render, and a lane count that arrives after the
         * pool has been built for the old one costs a rebuild. Every boot, not
         * once — a re-dlopened engine has default flags and has never heard of
         * prefs.json. */
        applyFlagsToEngine(engineSet);
        engineSet('chain_host', CHAIN_MODULE_DIR + '|' + MOVY_MODULE_DIR);
        /* A re-dlopened engine has no pad map; believing otherwise would leave
         * the pads dead until something happened to change the mapping. */
        resetPadRoute();
        requestLabelSync(); // rebuild automation registry + re-apply chain mappings
        return;
    }
    probeFailures++;
    const stale = pong !== null;
    if (stale || probeFailures >= PROBES_PER_LOAD) {
        probeFailures = 0;
        if (loadAttempts >= MAX_LOADS) {
            mlog('seq: engine unavailable after ' + MAX_LOADS + ' load attempts');
            bootState = 'absent';
            absentCountdown = ABSENT_RETRY_TICKS;
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
        else if (key === 'ext') seqState.extSync = val === '1';
        else if (key === 'link') seqState.linkEnabled = val === '1';
        else if (key === 'swing') seqState.swingPct = Number(val) || seqState.swingPct;
        else if (key === 'trk') seqState.watchTrack = Number(val) || 0;
        else if (key === 'step') seqState.curStep = Number(val) || 0;
        else if (key === 'len') seqState.lenSteps = Number(val) || 0;
        else if (key === 'lstart') seqState.loopStart = Number(val) || 0;
        else if (key === 'csc') {
            const [n, d] = val.split('/').map(Number);
            seqState.clipScaleIdx = rationalToIdx(n || 1, d || 1);
        }
        else if (key === 'ctr') seqState.clipTranspose = Number(val) || 0;
        else if (key === 'quant') seqState.clipQuant = Number(val) || 0;
        else if (key === 'dquant') seqState.defaultQuant = Number(val) || 0;
        /* The engine's count of serviced chain-module changes. A movy chain
         * lives only inside the engine, so the UI cannot know it changed unless
         * the engine says so — and it must be persisted whoever changed it: a
         * browser load, an undo, a restore, or a remote param write the UI never
         * saw. Watching a counter covers all of them; hooking the browser
         * gesture would have covered only the first. */
        else if (key === 'chgen') {
            const g = Number(val) || 0;
            if (lastChainGen >= 0 && g !== lastChainGen) markUiStateDirty();
            lastChainGen = g;
        }
        else if (key === 'rec') seqState.recording = val === '1';
        else if (key === 'cin') seqState.countingIn = val === '1';
        else if (key === 'cap') {
            const [p, g] = val.split('.');
            seqState.capPending = Number(p) || 0;
            seqState.capGen = Number(g) || 0;
        }
        else if (key === 'metro') seqState.metro = val === '1';
        else if (key === 'dirty') seqState.dirty = val === '1';
        else if (key === 'pos') seqState.posTick = Number(val) || 0;
        else if (key === 'hlen') seqState.holdLen = Number(val) || 0;
        else if (key === 'hnotes') {
            seqState.holdNotes = val
                ? val.split('.').map(Number).filter((n) => n >= 0 && n <= 127)
                : [];
        }
        else if (key === 'hvel') seqState.holdVel = Number(val) || 0;
        else if (key === 'hgate') seqState.holdGate = Number(val) || 0;
        else if (key === 'hgmix') seqState.holdGateMixed = val === '1';
        else if (key === 'hprob') seqState.holdProb = Number(val) || 0;
        else if (key === 'hcond') {
            const [a, b] = val.split(':').map(Number);
            seqState.holdCondA = a || 1;
            seqState.holdCondB = b || 1;
        }
        else if (key === 'hinv') seqState.holdInvert = val === '1';
        else if (key === 'hlmax') seqState.holdMaxGate = Number(val) || 0;
        else if (key === 'act') activeFromStr(val);
        else if (key === 'mute') muteFromStr(val);
        else if (key === 'sess') sessionFromStr(val);
        else if (key === 'occ') occFromHex(val);
        else if (key === 'unop') noopSnapId = Number(val);
        else if (key === 'alanes') seqState.autoAssigned = parseInt(val, 16) || 0;
        else if (key === 'aauto') seqState.autoActive = parseInt(val, 16) || 0;
        else if (key === 'hauto') {
            seqState.heldLocks.clear();
            if (val) for (const pair of val.split('.')) {
                const [l, v] = pair.split(':').map(Number);
                if (l >= 0 && l < 8) seqState.heldLocks.set(l, v);
            }
        }
    }
    adoptLoopWindow();   // a window the UI has not seen before takes the view with it
    if (lastEnginePlay !== seqState.playing) {
        mlog('seq: play=' + (seqState.playing ? 1 : 0));
        lastEnginePlay = seqState.playing;
    }
}

/* Test hook: drive parseStatus directly. */
export function parseStatusForTest(s: string): void { parseStatus(s); }

/* Test hook: inspect the pending command queue. */
export function peekSeqCmdQueue(): string[] {
    return cmdQueue.slice();
}

/* Test hook: reset boot/queue/backoff between test cases. */
export function resetSeqEngine(): void {
    cmdQueue.length = 0;
    bootState = 'probe';
    generation = 0;
    probeCountdown = 1;
    probeFailures = 0;
    loadAttempts = 0;
    absentCountdown = 0;
    pollCountdown = 1;
    statusFailures = 0;
    lastEnginePlay = null;
    /* A re-dlopened engine starts its chain generation at 0 again; carrying the
     * old value across would read as a change and dirty the set for nothing. */
    lastChainGen = -1;
}
