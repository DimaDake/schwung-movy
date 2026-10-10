/* Which Set is open, in library mode — the answer active_set.txt gives in
 * Move mode.
 *
 * Boot is three steps on the engine's own clock: point the saver at the
 * library and import (once per engine generation — a re-dlopened engine knows
 * nothing), wait for the first answer, then take its last-open Set. A library
 * with no Sets at all gets one, so movy always has somewhere to put what the
 * user plays. Nothing here waits: until the answer lands, the session simply
 * has no identity yet and keeps the splash up. */

import { paramSet } from '../host/param.js';
import { engineGeneration } from './engine.js';
import { flagValue } from './flags.js';
import { defaultSetName, libImportCmd, libRefresh, libSend, libState } from './sets-lib.js';
import { setsDir, wantSet, wantedSet } from './set-source.js';

let bootedGen = -1;
let madeBefore: string | null = null;   // non-null while a first Set is being made
let pendingDel = '';

export function resetLibSession(): void {
    bootedGen = -1; madeBefore = null; pendingDel = '';
}

/** Why library mode cannot run, or '' when it can. */
export function libraryBlocked(): string {
    /* The library is the engine's (set_library.rs). With the UI writing Set
     * files itself there would be two writers again — the thing `engpersist`
     * exists to end — so refuse rather than guess. */
    return flagValue('engpersist') ? '' : 'SETS NEED ENGINE SAVES';
}

/** The Set to have open, or null while the library has not answered. */
export function libraryIdentity(): { uuid: string; name: string } | null {
    const gen = engineGeneration();
    if (gen !== bootedGen) {
        bootedGen = gen;
        paramSet('setsdir', setsDir(), 200);
        libSend(libImportCmd());
    }
    libRefresh();
    const st = libState();
    if (!st) return null;
    if (!wantedSet()) {
        if (st.cur && st.rows.some((r) => r.id === st.cur)) wantSet(st.cur);
        else if (st.rows.length > 0) wantSet(st.rows[0].id);
        else if (madeBefore === null) {
            madeBefore = st.made;
            libSend('new ' + defaultSetName(new Date(), []));
            return null;
        } else if (st.made && st.made !== madeBefore) {
            wantSet(st.made);
        } else {
            return null;
        }
    }
    const id = wantedSet();
    const row = st.rows.find((r) => r.id === id);
    return { uuid: id, name: row ? row.name : '' };
}

/** Delete `id` once the session has moved off it — the engine refuses to
 *  delete the Set its saver has open, and so must we. */
export function deleteWhenLeft(id: string): void { pendingDel = id; }

export function libraryTick(openId: string, live: boolean): void {
    if (pendingDel && live && openId !== pendingDel) {
        libSend('del ' + pendingDel);
        pendingDel = '';
    }
}
