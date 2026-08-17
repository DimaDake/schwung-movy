/* Per-set autosave / restore of the sequencer state (davebox pattern: the
 * engine can't touch the filesystem, so the UI ferries the serialized state
 * through host_read_file / host_write_file).
 *
 * State is keyed by the active Move set's UUID (see set-context.ts), so each
 * set recalls an independent movy project — aligned with how schwung stores
 * tracks per set. Both the engine state and the UI-only state are per-set.
 *
 * Two invariants keep a set from being lost, and most of what follows exists
 * only to hold them:
 *
 *  1. Never persist an engine we did not restore. seq/engine.ts re-dlopens
 *     dsp.so when the engine stops answering, and the reload comes up EMPTY.
 *     Autosave stays muted until the generation we last pushed into matches
 *     the engine's current one — otherwise the first edit after a wedge
 *     serializes a blank engine straight over the user's set.
 *  2. Never drop a write. host_module_get_param('state') clears the engine's
 *     own dirty flag as a side effect of the read, so a write we fail to
 *     complete is one nothing will ever ask us for again — hence saveRetry,
 *     which outlives the engine-sourced dirty mirror. */

import { mlog } from '../log.js';
import { engineReady, engineGeneration, requestLabelSync } from './engine.js';
import { seqState } from './state.js';
import { markUiStateDirty, takeUiDirty, clearUiDirty } from './ui-dirty.js';
import { serializeUiState, applyUiState, resetUiState } from './ui-state.js';
import { BLANK_STATE, readActiveSet, rememberSet } from './set-context.js';
import { readUiBlob, writeStateBlob, writeUiBlob } from './persist-store.js';
import { resolveState } from './set-inherit.js';

const SAVE_TICKS = 600;       // ~3s autosave cadence at the ~205 Hz device rate
const SET_POLL_TICKS = 96;    // ~0.5s: catch native set switches (incl. on resume)
const UNKNOWN_SET_POLLS = 20; // ~10s of no active_set.txt before using _default

let saveCountdown = SAVE_TICKS;
let setPollCountdown = 1;     // resolve the set on the first ready tick
let unknownPolls = 0;
let curUuid: string | null = null;  // null = which set is active is still unknown
let lastGoodPayload = '';     // newest payload known durable for curUuid
let savedGen = 0;             // envelope generation of lastGoodPayload
let restoredGen = -1;         // engine generation whose contents we authored
let saveRetry = false;        // a write failed; retry regardless of the engine

export { markUiStateDirty };
export function currentSetUuid(): string { return curUuid || ''; }

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

/* Push a payload into the live engine and record that this engine generation
 * now holds state we authored — the gate the autosave checks. */
function pushToEngine(payload: string): void {
    if (typeof host_module_set_param_blocking === 'function')
        host_module_set_param_blocking('state', payload, 200);
    // Restore carries the lane labels/assignments; re-request the label sync so
    // the automation registry reflects the just-loaded set (otherwise the UI
    // registry stays empty — no dot, no held value, no read-back suppression).
    requestLabelSync();
    lastGoodPayload = payload;
    restoredGen = engineGeneration();
    seqState.dirty = false;
    saveRetry = false;
}

/* Keep what the engine is already holding and claim it for the current set —
 * the counterpart to pushToEngine, for the case where the engine, not the disk,
 * holds the newer truth. lastGoodPayload stays empty on purpose: it means
 * "already durable", and these bytes are not durable anywhere yet. */
function adoptEngineState(): void {
    requestLabelSync();
    lastGoodPayload = '';
    restoredGen = engineGeneration();
    seqState.dirty = true;
    saveRetry = false;
}

/* Does the live engine hold a pattern? A `cl` line is a clip; an engine with
 * none has nothing that pushing a blank state could destroy. Asked only when a
 * set resolves to no state at all, so this round trip is paid at most once per
 * open — and never for a set that has been saved before. */
function engineHoldsClips(): boolean {
    if (typeof host_module_get_param !== 'function') return false;
    const payload = host_module_get_param('state');
    return payload !== null && /(^|\n)cl /.test(payload);
}

/* Read the engine's state and persist it under `uuid`. `wrote` distinguishes
 * "persisted new bytes" from "nothing had changed" — during a data-loss
 * investigation the log has to mean exactly one of those, not both. */
function saveState(uuid: string): { ok: boolean; wrote: boolean } {
    if (typeof host_module_get_param !== 'function') return { ok: false, wrote: false };
    const payload = host_module_get_param('state');
    if (payload === null) return { ok: false, wrote: false };
    if (payload === lastGoodPayload) return { ok: true, wrote: false };  // spare the flash
    if (!writeStateBlob(uuid, payload, savedGen + 1)) return { ok: false, wrote: false };
    lastGoodPayload = payload;
    savedGen++;
    return { ok: true, wrote: true };
}

/* Persist everything dirty for the current set. Shared by the autosave tick,
 * the set switch and onUnload — closing movy used to drop up to a full save
 * interval of edits on the floor.
 *
 * `force` skips the dirty check and asks the engine directly. seqState.dirty is
 * a mirror refreshed by the 24 Hz status poll, so an edit made in the last few
 * milliseconds can still read clean; on the last save this set will ever get —
 * a switch-out or a teardown — that stale read is a lost edit. saveState still
 * writes nothing when the payload is unchanged, so forcing costs one param read. */
export function seqPersistFlush(force = false): void {
    if (curUuid === null || !filesAvailable()) return;
    if (engineGeneration() !== restoredGen) return;   // not our engine — see the tick

    if ((takeUiDirty() || force) && !writeUiBlob(curUuid, serializeUiState())) markUiStateDirty();

    if (!seqState.dirty && !saveRetry && !force) return;
    const r = saveState(curUuid);
    if (r.ok) {
        saveRetry = false;
        /* The engine cleared its own flag on the state read; clear the mirror
         * too rather than waiting for the next status poll to tell us what we
         * already know. */
        seqState.dirty = false;
        if (r.wrote)
            mlog('seq: saved ' + lastGoodPayload.length + ' bytes (gen ' + savedGen + ')');
    } else {
        saveRetry = true;
        mlog('seq: SAVE FAILED — retrying');
    }
}

/* Optionally save the outgoing set, then load the incoming set's engine + UI
 * state into the live engine. */
export function switchToSet(uuid: string, name: string, saveOld: boolean): void {
    if (saveOld && curUuid !== null && curUuid !== uuid) seqPersistFlush(true);

    const st = resolveState(uuid, name);
    /* Which set we are is DISCOVERED, not known at open: Move writes a brand-new
     * set's active_set.txt only once it saves it, and movy's pads, steps and
     * transport all work in the meantime. So the engine can already hold a whole
     * pattern by the time the answer arrives, and that pattern belongs to the
     * set we just learned about — pushing its (nonexistent) state over it was
     * silent data loss: the sequence vanished mid-session, the clip went back to
     * zero steps, and Play then ran an empty clip. Restricted to a set with no
     * state of its own; one that HAS state restores it, because then the disk
     * holds something authored under this set and the engine does not. */
    const first = curUuid === null;
    const adopt = first && st.payload === BLANK_STATE && engineHoldsClips();
    curUuid = uuid;
    savedGen = st.gen;
    if (adopt) adoptEngineState();
    else pushToEngine(st.payload);

    const ui = readUiBlob(uuid);
    if (ui && ui.length > 0) applyUiState(ui);
    else if (!adopt) resetUiState();   // adopting keeps the live scale/layout too

    rememberSet(name, uuid);
    clearUiDirty();
    /* Ordered after clearUiDirty, which is there to drop the OUTGOING set's
     * pending write — the adopted UI state is the incoming set's, and unsaved. */
    if (adopt) markUiStateDirty();
}

/* Returns true when the set changed, so the caller skips the save this tick. */
function pollActiveSet(): boolean {
    const id = readActiveSet();
    if (!id) {
        /* Unknown → keep whatever set we have. Only a boot that never sees a
         * real uuid falls back to _default, so movy still persists on a device
         * with no native set rather than waiting forever. */
        if (curUuid === null && ++unknownPolls >= UNKNOWN_SET_POLLS) {
            switchToSet('', '', false);
            mlog('seq: no active set — using _default');
            return true;
        }
        return false;
    }
    if (id.uuid === curUuid) return false;
    const first = curUuid === null;
    switchToSet(id.uuid, id.name, !first);
    mlog('seq: ' + (first ? 'loaded' : 'switched to') + ' set ' + id.uuid);
    return true;
}

export function seqPersistTick(): void {
    if (!engineReady() || !filesAvailable()) return;

    /* An engine we did not restore is an EMPTY engine. Restoring before
     * anything else — and refusing to save until we have — is what stops a
     * wedged engine's reload from overwriting the set with a blank one. */
    if (curUuid !== null && engineGeneration() !== restoredGen) {
        pushToEngine(lastGoodPayload);
        mlog('seq: engine reloaded — restored ' + lastGoodPayload.length + ' bytes');
        return;
    }

    if (--setPollCountdown <= 0) {
        setPollCountdown = SET_POLL_TICKS;
        if (pollActiveSet()) return;
    }
    if (curUuid === null) return;

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;
    seqPersistFlush();
}

/* Test hook. */
export function resetSeqPersist(): void {
    saveCountdown = SAVE_TICKS;
    setPollCountdown = 1;
    unknownPolls = 0;
    curUuid = null;
    lastGoodPayload = '';
    savedGen = 0;
    restoredGen = -1;
    saveRetry = false;
    clearUiDirty();
}
