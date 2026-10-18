/* The only file that talks to the engine for the sequencer (plan WP10).
 *
 * Boot: movy-host loads its own dsp.so before ui.js starts and never reloads
 * it, so boot is one question. `ping` answering ENGINE_VERSION is ready;
 * another version is a broken install (ui.js and dsp.so from different
 * builds), and silence is an engine that did not load. Neither has a fix movy
 * can apply, so both go straight to the failure screen.
 *
 * Steady state: commands queue during an app tick and flush as ONE batched
 * `cmd` write into movy-host's ordered queue, which loses nothing. Status is
 * not polled: the audio thread publishes it after every render
 * (host/status_snap.h), and the tick reads the newest when it has moved. */

import { paramGet, paramSet } from '../host/param.js';
import { platform } from '../platform/index.js';
import { mlog } from '../log.js';
import { CHAIN_MODULE_DIR, ENGINE_VERSION, MOVY_MODULE_DIR } from './constants.js';
import { probeBridgeTick } from './probe-bridge.js';
import { readPrefModuleBlacklist } from './prefs.js';
import { pushMasterVolume } from '../mixer/master-volume.js';
import { pushClickVolume } from './click-volume.js';
import { resetPadRoute, syncPadRoute } from '../track/pad-route.js';
import { resetWatchPush, syncWatch } from './watch.js';
import { parseStatus, resetEngineStatus } from './engine-status.js';
import { resetNoteView } from './note-view.js';
import { requestLabelSync } from './label-sync.js';

export { parseStatusForTest, takeNoopSnapId } from './engine-status.js';
export { requestLabelSync, takeLabelSync } from './label-sync.js';

/* Ticks between parses of a moved snapshot. The audio thread publishes ~344
 * times a second and the tick runs ~380; parsing every one would spend the
 * tick on text the screen cannot show. 4 is ~95 Hz, four times the old poll. */
const PARSE_TICKS = 4;

type BootState = 'probe' | 'ok' | 'absent';

/** Why the engine is absent: it never answered, or it answered with a version
 *  this ui.js was not built with. */
export type AbsentReason = 'silent' | 'mismatch';

const cmdQueue: string[] = [];
let bootState: BootState = 'probe';
let absentReason: AbsentReason = 'silent';
/* 1 once the engine is in service. Kept as a number because persistence and
 * undo compare it against the generation they authored; movy-host never
 * reloads the engine, so it never moves past 1. */
let generation = 0;
let lastSnapSeq = 0;
let parseCountdown = 0;
/* The `served` stamp of the last snapshot parsed: every request up to it was
 * in the engine when that status was taken. */
let lastServed = -1;
let uiTickCount = 0;

export function engineGeneration(): number { return generation; }
export function engineReady(): boolean { return bootState === 'ok'; }
/** The engine is not there and will not be: the session shows why. */
export function engineAbsent(): boolean { return bootState === 'absent'; }
/** Only meaningful while `engineAbsent()`. */
export function engineAbsentReason(): AbsentReason { return absentReason; }

/* Monotonic UI-tick counter, for short interaction timers (e.g. double-tap
 * detection) that need a coarse clock without wall-time access. */
export function uiTick(): number { return uiTickCount; }

/** A point in the request stream: everything sent before this call. */
export function engineMark(): number { return platform.engineSubmitted(); }

/** Has a parsed status reflected every request up to `mark`? A mirror field
 *  read as ZERO (chpend while loads are queued) is only an answer once this
 *  holds — before it, it is the previous state's zero. */
export function engineCaughtUp(mark: number): boolean { return lastServed >= mark; }

/* Undo's inspection hook, registered by undo/record.ts. Lives as a callback
 * rather than a direct import because undo/ imports this file — and because a
 * hook here catches EVERY seqCmd, including a new call site that never thought
 * about undo. That is the point: a bypass is exactly what it must notice. */
let editGuard: ((op: string) => void) | null = null;
export function setEditGuard(fn: ((op: string) => void) | null): void { editGuard = fn; }

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
    paramSet('cmd', cmdQueue.join(';'));
    cmdQueue.length = 0;
}

export function seqEngineTick(): void {
    uiTickCount++;
    if (bootState === 'absent') return;
    if (bootState === 'probe') { boot(); return; }
    /* Keep the engine's pad map current. Rebuilt and compared every tick — the
     * comparison is what makes it correct, because the set of things that change
     * the mapping (track, octave, root, scale, layout, drum lane, module) is a
     * list that would rot, and a stale map sends notes to the wrong pitch. */
    syncPadRoute(paramSet);
    /* Same rule, same reason: the step view's track and drum lane are pushed by
     * comparing them against what the engine was last told. Queued rather than
     * sent, so they ride the batch the flush below is about to send. */
    syncWatch(seqCmd);
    seqCmdFlush();
    readSnapshot();
    /* After the parse, so a request noticed in THIS snapshot is answered in the
     * same tick. Costs nothing when no request is waiting. */
    probeBridgeTick(paramGet, paramSet);
}

function readSnapshot(): void {
    if (--parseCountdown > 0) return;
    const seq = platform.engineSnapshotSeq();
    if (seq === lastSnapSeq) return;
    const snap = platform.engineSnapshot();
    if (!snap) return;
    parseCountdown = PARSE_TICKS;
    lastSnapSeq = snap.seq;
    lastServed = snap.served;
    parseStatus(snap.text);
}

function boot(): void {
    const pong = paramGet('ping');
    if (pong !== 'pong ' + ENGINE_VERSION) {
        absentReason = pong === null ? 'silent' : 'mismatch';
        mlog('seq: engine ' + (pong === null ? 'did not answer' : 'is ' + pong + ', ui.js wants ' + ENGINE_VERSION));
        bootState = 'absent';
        cmdQueue.length = 0;
        return;
    }
    mlog('seq: engine ready v' + ENGINE_VERSION);
    bootState = 'ok';
    generation++;
    parseCountdown = 0;
    /* The hazard list, before `chain_host`, which is where the chains start
     * existing. Sent on EVERY boot, even when empty: a re-dlopened engine knows
     * nothing, and the engine replaces the list wholesale, so an empty write is
     * how a module removed from prefs.json stops being pinned. */
    paramSet('chblock', readPrefModuleBlacklist().join(','));
    pushMasterVolume(paramSet);
    pushClickVolume(paramSet);
    /* Only the UI knows the install paths, so it hands them over once the
     * engine answers. Refreshing the private copy and dlopening the chain host
     * both happen inside this set, off the render path. */
    paramSet('chain_host', CHAIN_MODULE_DIR + '|' + MOVY_MODULE_DIR);
    resetPadRoute();
    resetWatchPush();
    requestLabelSync(); // rebuild automation registry + re-apply chain mappings
}

/* Test hook: inspect the pending command queue. */
export function peekSeqCmdQueue(): string[] { return cmdQueue.slice(); }

/* Test hook: back to before boot. */
export function resetSeqEngine(): void {
    cmdQueue.length = 0;
    bootState = 'probe';
    absentReason = 'silent';
    generation = 0;
    lastSnapSeq = 0;
    parseCountdown = 0;
    lastServed = -1;
    resetEngineStatus();
    resetNoteView();
}
