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
import { markUiStateDirty, takeUiDirty, uiStateDirty } from './ui-dirty.js';
import { serializeUiState } from './ui-state.js';
import { writeStateBlob, writeUiBlob } from './persist-store.js';
import { captureAutoIfDue } from './version-capture.js';
import { restoreLanded } from './restore-gate.js';
import { flagValue } from './flags.js';

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
    /* The UI half counts. `seqState.dirty` mirrors the ENGINE's flag, and with
     * `engpersist` on the engine clears its own on its own thread — so an edit
     * that only touches the UI blob (a mute, a solo, the root note, the scale,
     * the migration marker, the chains mirror) raced that clearing and lost:
     * the autosave saw nothing to do and `ui-state.json` was never written.
     * A device sweep found it through mutes and the migration, not through
     * persistence: seven mute/solo checks and three migration checks. */
    return seqState.dirty || saveRetry || uiStateDirty();
}

/** Persist the engine's state, and the UI blob when dirty, under `id`.
 *
 *  `force` skips the dirty mirror and asks the engine directly: that mirror is
 *  refreshed by a 24 Hz status poll, so on the last save a Set will ever get —
 *  a switch-out or a teardown — a stale read is a lost edit. */
export function saveSet(
    id: string, gen: number, force = false,
): { ok: boolean; wrote: boolean; gen: number } {
    /* FIRST, above the UI write as well as the state write.
     *
     * ui-state.json is not only keyboard settings: serializeUiState() calls
     * readChainDoc(), an engine GET, so the movy chains in it come from the
     * same engine the sequencer state does. A blank engine costs the chains
     * too — observed on device as ui-state.json collapsing from 5141 to 217
     * bytes, and in the suite as `"chains":[]` written over a real chain.
     *
     * Also before reading `state` below, because that read CLEARS the engine's
     * dirty flag: a read we then decline to act on would cost the next save
     * its reason to run. Both halves stay PENDING instead. */
    if (!restoreLanded()) {
        saveRetry = true;
        /* `force` carries no dirty flag to preserve, so mark it: otherwise a
         * forced save that we refuse here is a UI blob nothing writes later. */
        markUiStateDirty();
        mlog('seq: SAVE BLOCKED — this Set never reached the engine');
        return { ok: false, wrote: false, gen };
    }
    if ((takeUiDirty() || force) && !writeUiBlob(id, serializeUiState(id))) markUiStateDirty();
    /* Engine-owned: it saves on its own dirty flag, on its own thread. Reading
     * `state` here would not merely be redundant — the read CLEARS the engine's
     * dirty flag, so a UI that asked would silently cancel the engine's own
     * reason to save. The UI blob above is still ours. */
    if (flagValue('engpersist')) return { ok: true, wrote: false, gen };
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
    /* Rides the save that just wrote, so the history costs no extra engine
     * read — and is rate-limited inside, because this runs every few seconds. */
    captureAutoIfDue(id, payload, gen + 1);
    return { ok: true, wrote: true, gen: gen + 1 };
}
