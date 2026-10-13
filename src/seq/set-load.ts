/* Loading a Set into the live engine: one pass, no decisions.
 *
 * WHETHER to load is set-session's call — this module only knows HOW. Keeping
 * the two apart is what stops "load" from quietly reacquiring the policy that
 * used to let a blank Set land on top of a live pattern. */

import { requestLabelSync } from './engine.js';
import { flagValue } from './flags.js';
import { setsDir } from './set-source.js';
import { paramGet, paramSet } from '../host/param.js';
import { mlog } from '../log.js';
import { noteRestore } from './restore-gate.js';
import { readBestState, readUiBlob } from './persist-store.js';
import { BLANK_STATE } from './set-context.js';
import { applyUiState } from './ui-state.js';

/* CHECKED: a Set that never reached the engine must not look like one that
 * did, or the next autosave reads the engine's blank state and writes it over
 * the real one (reproduced under the overtake host: au=1 cl=2 size=670 on disk
 * became "movy1\n"). movy-host's queue loses nothing (WP10), so the only
 * failure left is an engine that is not loaded — and no retry answers that. */
export function pushState(payload: string): boolean {
    const ok = paramSet('state', payload);
    if (!ok) mlog('seq: RESTORE FAILED — the engine never took this Set');
    noteRestore(ok);
    /* The restore carries the lane labels and assignments with it, so the
     * automation registry has to be rebuilt from them — without this it stays
     * empty: no dot, no held value, no read-back suppression. */
    requestLabelSync();
    return ok;
}


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
    /* The restore carries the lane labels with it either way, so the automation
     * registry still has to be rebuilt from them. */
    requestLabelSync();
}


/** Read a Set's state, push it into the engine, and apply its UI blob if it has
 *  one. The caller decides what to do when it does not. */
export function loadSet(id: string): { payload: string; gen: number; ok: boolean } {
    /* Engine-owned: name the Set and let it read its own files. No payload is
     * read here and none is pushed, so there is nothing for the param slot to
     * lose — and the UI blob still applies, because its half is still the
     * UI's (the chains inside it are a mirror, ui-state.ts). */
    if (flagValue('engpersist')) {
        openSet(id);
        const ui = readUiBlob(id);
        if (ui && ui.length > 0) applyUiState(ui);
        return { payload: '', gen: 0, ok: true };
    }
    /* The generation comes back with the state so the next save continues the
     * sequence instead of restarting at 1 and losing to a stale higher copy. */
    const st = readBestState(id) ?? { payload: BLANK_STATE, gen: 0 };
    const ok = pushState(st.payload);
    const ui = readUiBlob(id);
    if (ui && ui.length > 0) applyUiState(ui);
    return { ...st, ok };
}
