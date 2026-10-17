/* Writing the UI's half of a Set to disk.
 *
 * The engine saves the sequence and the chains itself, on its own dirty flag
 * and its own thread. What is left here is `ui-state.json`: the keyboard
 * settings and the mutes (ui-state.ts). */

import { markUiStateDirty, takeUiDirty, uiStateDirty } from './ui-dirty.js';
import { serializeUiState } from './ui-state.js';
import { writeUiBlob } from './persist-store.js';

export function saveNeeded(): boolean {
    /* The UI's own flag, never `seqState.dirty`: that mirrors the ENGINE's,
     * which the engine clears on its own thread — an edit that only touches the
     * UI blob (a mute, a solo, the root note, the scale) raced that clearing
     * and lost, and `ui-state.json` was never written. A device sweep found it
     * through mutes and the migration: seven mute/solo checks and three
     * migration checks. */
    return uiStateDirty();
}

/** Write the UI blob under `id` when it is dirty, or always when `force`d —
 *  a switch-out or a teardown, the last save a Set will ever get. A failed
 *  write stays dirty, so the next save retries it. */
export function saveSet(id: string, force = false): void {
    /* Never `state`: reading it would not merely be redundant — the read CLEARS
     * the engine's dirty flag, so a UI that asked would silently cancel the
     * engine's own reason to save. */
    if ((takeUiDirty() || force) && !writeUiBlob(id, serializeUiState())) markUiStateDirty();
}
