/* Per-set autosave / restore of the sequencer state (davebox pattern: the
 * engine can't touch the filesystem, so the UI ferries the serialized state
 * through host_read_file / host_write_file).
 *
 * State is keyed by the active Move set's UUID (see set-context.ts), so each
 * set recalls an independent movy project — aligned with how schwung stores
 * tracks per set. Both the engine state and the UI-only state (root note +
 * scale) are per-set.
 *
 * - switchToSet() is the one routine both the boot-load and the live set-switch
 *   funnel through: optionally save the outgoing set, then load the incoming
 *   set's engine + UI state (own file → inherited-from-parent → blank).
 * - seqPersistTick() polls active_set.txt to detect native set switches and
 *   autosaves the current set on a slow dirty timer. */

import { mlog } from '../log.js';
import { engineReady, requestLabelSync } from './engine.js';
import { seqState } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { SCALES } from './scales.js';
import {
    readActiveSet, resolveStateBlob, resolveUiBlob, rememberSet,
    writeStateFile, writeUiFile,
} from './set-context.js';

const SAVE_TICKS = 600;     // ~3s autosave cadence at the ~205 Hz device rate
const SET_POLL_TICKS = 96;  // ~0.5s: catch native set switches (incl. on resume)

let loaded = false;
let saveCountdown = SAVE_TICKS;
let setPollCountdown = SET_POLL_TICKS;
let uiDirty = false;
let curUuid = '';
let curName = '';

export function markUiStateDirty(): void { uiDirty = true; }
export function currentSetUuid(): string { return curUuid; }

/** `{root,scale}` JSON of the persisted UI keyboard state. */
export function serializeUiState(): string {
    return JSON.stringify({ root: keyboardState.rootNote, scale: keyboardState.scale });
}

/** Apply a serialized UI-state blob (tolerant of missing/invalid fields). */
export function applyUiState(blob: string): void {
    try {
        const o = JSON.parse(blob);
        if (typeof o.root === 'number') keyboardState.rootNote = Math.max(0, Math.min(103, o.root | 0));
        if (typeof o.scale === 'number') keyboardState.scale = Math.min(SCALES.length - 1, Math.max(0, o.scale | 0));
    } catch { /* corrupt file → keep defaults */ }
}

/* Defaults match init() (root 48, Major scale 0). */
function resetUiState(): void {
    keyboardState.rootNote = 48;
    keyboardState.scale = 0;
}

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

/* Read the engine's current state and persist it (with UI state) to `uuid`. */
function saveSet(uuid: string): void {
    if (typeof host_module_get_param === 'function') {
        const state = host_module_get_param('state');
        if (state !== null) writeStateFile(uuid, state);
    }
    writeUiFile(uuid, serializeUiState());
    seqState.dirty = false;
}

/* Optionally save the outgoing set, then load the incoming set's engine + UI
 * state into the live engine. */
export function switchToSet(uuid: string, name: string, saveOld: boolean): void {
    if (saveOld && curUuid !== uuid) saveSet(curUuid);

    const blob = resolveStateBlob(uuid, name);
    if (typeof host_module_set_param_blocking === 'function')
        host_module_set_param_blocking('state', blob, 200);
    // Restore carries the lane labels/assignments; re-request the label sync so
    // the automation registry reflects the just-loaded set (otherwise the UI
    // registry stays empty — no dot, no held value, no read-back suppression).
    requestLabelSync();

    const ui = resolveUiBlob(uuid);
    if (ui && ui.length > 0) applyUiState(ui);
    else resetUiState();

    curUuid = uuid;
    curName = name;
    rememberSet(name, uuid);
    seqState.dirty = false;
    uiDirty = false;
}

export function seqPersistTick(): void {
    if (!engineReady() || !filesAvailable()) return;

    if (!loaded) {
        loaded = true;
        const { uuid, name } = readActiveSet();
        switchToSet(uuid, name, false);
        mlog('seq: loaded set ' + (uuid || '_default'));
        return;
    }

    if (--setPollCountdown <= 0) {
        setPollCountdown = SET_POLL_TICKS;
        const { uuid, name } = readActiveSet();
        if (uuid !== curUuid) {
            switchToSet(uuid, name, true);
            mlog('seq: switched to set ' + (uuid || '_default'));
            return;
        }
    }

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;

    if (uiDirty) {
        uiDirty = false;
        writeUiFile(curUuid, serializeUiState());
    }

    if (!seqState.dirty) return;
    if (typeof host_module_get_param !== 'function') return;
    const state = host_module_get_param('state');
    if (state !== null) {
        writeStateFile(curUuid, state);
        seqState.dirty = false; // engine cleared its flag on the read
        mlog('seq: autosaved (' + state.length + ' bytes)');
    }
}

/* Test hook. */
export function resetSeqPersist(): void {
    loaded = false;
    saveCountdown = SAVE_TICKS;
    setPollCountdown = SET_POLL_TICKS;
    uiDirty = false;
    curUuid = '';
    curName = '';
}
