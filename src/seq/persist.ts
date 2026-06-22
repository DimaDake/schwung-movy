/* Autosave / restore of the sequencer state (davebox pattern: the engine
 * can't touch the filesystem, so the UI ferries the serialized state through
 * host_read_file / host_write_file).
 *
 * - Load once when the engine becomes ready: read the file and push it with a
 *   blocking set so it's applied before the user starts editing.
 * - Save on a slow timer when the engine reports unsaved changes (dirty):
 *   read the serialized state and write the file. Reading clears the engine's
 *   dirty flag, so steady state writes nothing.
 *
 * UI-only state (Root note + Scale) is persisted separately to movy-ui.json,
 * keeping the engine boundary clean (engine stores no UI state). */

import { mlog } from '../log.js';
import { engineReady, requestLabelSync } from './engine.js';
import { seqState } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { SCALES } from './scales.js';

const STATE_PATH = '/data/UserData/schwung/modules/tools/movy/seq-state.json';
const UI_STATE_PATH = '/data/UserData/schwung/modules/tools/movy/movy-ui.json';
const SAVE_TICKS = 600; // ~3s at the ~196 Hz device rate

let loaded = false;
let saveCountdown = SAVE_TICKS;
let uiLoaded = false;
let uiDirty = false;

export function markUiStateDirty(): void { uiDirty = true; }

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

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

export function seqPersistTick(): void {
    if (!engineReady() || !filesAvailable()) return;

    if (!loaded) {
        loaded = true;
        const data = host_read_file(STATE_PATH);
        if (data && data.length > 0 && typeof host_module_set_param_blocking === 'function') {
            host_module_set_param_blocking('state', data, 200);
            // Restore carries the lane labels/assignments. The boot label-sync
            // already ran (against the pre-restore engine) and read nothing, so
            // re-request it now that the engine holds the restored automation —
            // otherwise the UI registry stays empty (no dot, no held value, and
            // no read-back suppression for automated lanes).
            requestLabelSync();
            mlog('seq: restored state (' + data.length + ' bytes)');
        }
        return;
    }

    if (!uiLoaded) {
        uiLoaded = true;
        const ui = host_read_file(UI_STATE_PATH);
        if (ui && ui.length > 0) applyUiState(ui);
    }

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;

    if (uiDirty) {
        uiDirty = false;
        host_write_file(UI_STATE_PATH, serializeUiState());
    }

    if (!seqState.dirty) return;
    if (typeof host_module_get_param !== 'function') return;
    const state = host_module_get_param('state');
    if (state !== null) {
        host_write_file(STATE_PATH, state);
        seqState.dirty = false; // engine cleared its flag on the read
        mlog('seq: autosaved (' + state.length + ' bytes)');
    }
}

/* Test hook. */
export function resetSeqPersist(): void {
    loaded = false;
    saveCountdown = SAVE_TICKS;
    uiLoaded = false;
    uiDirty = false;
}
