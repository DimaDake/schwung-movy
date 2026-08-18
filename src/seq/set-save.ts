/* Writing a Set to disk.
 *
 * Two rules survive from the persistence rewrite, and both were written against
 * real data loss:
 *
 *  - `host_module_get_param('state')` CLEARS the engine's dirty flag as a side
 *    effect of the read, so a write we fail to complete is one nothing will ever
 *    ask us for again. `saveRetry` outlives the engine-sourced mirror for
 *    exactly that reason.
 *  - An unchanged payload is not rewritten. Flash on this device is not free,
 *    and the autosave runs every few seconds forever. */

import { mlog } from '../log.js';
import { seqState } from './state.js';
import { markUiStateDirty, takeUiDirty } from './ui-dirty.js';
import { serializeUiState } from './ui-state.js';
import { writeStateBlob, writeUiBlob } from './persist-store.js';

let lastGoodPayload = '';
let saveRetry = false;

export function resetSetSave(): void {
    lastGoodPayload = '';
    saveRetry = false;
}

/** The bytes last known durable — what a rename carries to the new id. */
export function savedPayload(): string { return lastGoodPayload; }

/** Treat `payload` as already durable under the current id. Used after a
 *  rename, where the bytes were written by the rename itself. */
export function adoptSaved(payload: string): void {
    lastGoodPayload = payload;
    saveRetry = false;
}

export function saveNeeded(): boolean {
    return seqState.dirty || saveRetry;
}

/** Persist the engine's state, and the UI blob when dirty, under `id`.
 *
 *  `force` skips the dirty mirror and asks the engine directly: that mirror is
 *  refreshed by a 24 Hz status poll, so on the last save a Set will ever get —
 *  a switch-out or a teardown — a stale read is a lost edit. */
export function saveSet(
    id: string, gen: number, force = false,
): { ok: boolean; wrote: boolean; gen: number } {
    if ((takeUiDirty() || force) && !writeUiBlob(id, serializeUiState())) markUiStateDirty();
    if (!saveNeeded() && !force) return { ok: true, wrote: false, gen };
    if (typeof host_module_get_param !== 'function') return { ok: false, wrote: false, gen };

    const payload = host_module_get_param('state');
    if (payload === null) { saveRetry = true; return { ok: false, wrote: false, gen }; }
    /* The engine cleared its own flag on that read; clear the mirror too rather
     * than waiting for the next poll to tell us what we already know. */
    seqState.dirty = false;
    if (payload === lastGoodPayload) { saveRetry = false; return { ok: true, wrote: false, gen }; }
    if (!writeStateBlob(id, payload, gen + 1)) {
        saveRetry = true;
        mlog('seq: SAVE FAILED — retrying');
        return { ok: false, wrote: false, gen };
    }
    lastGoodPayload = payload;
    saveRetry = false;
    mlog('seq: saved ' + payload.length + ' bytes (gen ' + (gen + 1) + ')');
    return { ok: true, wrote: true, gen: gen + 1 };
}
