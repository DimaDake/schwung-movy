/* Loading a Set into the live engine: one pass, no decisions.
 *
 * WHETHER to load is set-session's call — this module only knows HOW. Keeping
 * the two apart is what stops "load" from quietly reacquiring the policy that
 * used to let a blank Set land on top of a live pattern. */

import { requestLabelSync } from './engine.js';
import { setsDir } from './set-source.js';
import { paramGet, paramSet } from '../host/param.js';
import { readUiBlob } from './persist-store.js';
import { applyUiState } from './ui-state.js';

/* The Set the engine says it has open, or null when it has not answered.
 *
 * `null` means UNKNOWN and must never be read as "not this Set": the caller
 * re-sends, and re-sending an open costs nothing because it is idempotent. The
 * same push-by-comparison `syncWatch` uses for the watched track.
 */
export function setStatusUuid(): string | null {
    const s = paramGet('set');
    if (s === null) return null;
    const m = s.match(/(?:^| )uuid=(\S*)/);
    return m ? m[1] : null;
}

/* Open a Set by NAME rather than by value: the engine reads its own files, so
 * nothing about the Set crosses the param slot. */
export function openSet(id: string): void {
    /* Re-stated on every open rather than once per session: a re-dlopen'd
     * engine comes up knowing nothing, and an engine with no sets directory
     * answers `phase=failed reason=no-setsdir` forever. One extra param write
     * per Set load buys a path that heals itself. */
    paramSet('setsdir', setsDir());
    paramSet('set', 'open ' + id);
    /* The Set carries its lane labels and assignments, so the automation
     * registry has to be rebuilt from them — without this it stays empty: no
     * dot, no held value, no read-back suppression. */
    requestLabelSync();
}


/** Open a Set in the engine and apply its UI blob if it has one. The caller
 *  decides what to do when it does not. */
export function loadSet(id: string): void {
    /* The engine reads its own files: no payload is read here and none is
     * pushed, so there is nothing for the param slot to lose. The UI blob still
     * applies, because its half is still the UI's. */
    openSet(id);
    const ui = readUiBlob(id);
    if (ui && ui.length > 0) applyUiState(ui, id);
}
