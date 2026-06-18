/* Autosave / restore of the sequencer state (davebox pattern: the engine
 * can't touch the filesystem, so the UI ferries the serialized state through
 * host_read_file / host_write_file).
 *
 * - Load once when the engine becomes ready: read the file and push it with a
 *   blocking set so it's applied before the user starts editing.
 * - Save on a slow timer when the engine reports unsaved changes (dirty):
 *   read the serialized state and write the file. Reading clears the engine's
 *   dirty flag, so steady state writes nothing. */

import { mlog } from '../log.js';
import { engineReady, requestLabelSync } from './engine.js';
import { seqState } from './state.js';

const STATE_PATH = '/data/UserData/schwung/modules/tools/movy/seq-state.json';
const SAVE_TICKS = 600; // ~3s at the ~196 Hz device rate

let loaded = false;
let saveCountdown = SAVE_TICKS;

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

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;
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
}
