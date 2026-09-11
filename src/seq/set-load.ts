/* Loading a Set into the live engine: one pass, no decisions.
 *
 * WHETHER to load is set-session's call — this module only knows HOW. Keeping
 * the two apart is what stops "load" from quietly reacquiring the policy that
 * used to let a blank Set land on top of a live pattern. */

import { requestLabelSync } from './engine.js';
import { mlog } from '../log.js';
import { noteRestore } from './restore-gate.js';
import { readBestState, readUiBlob } from './persist-store.js';
import { resolveState } from './set-inherit.js';
import { applyUiState } from './ui-state.js';

/** Does this Set already own state? The rename-vs-switch question. */
export function setHasState(id: string): boolean {
    return readBestState(id) !== null;
}

/* Blocking on purpose: the engine must be holding the Set before any input is
 * accepted, and this runs once per Set rather than per tick.
 *
 * And CHECKED, which it was not. The write goes into the overtake_dsp param
 * SHM — a single slot with four producers — where a write can simply be lost
 * (`CLAUDE.md`: "routinely lost"). Discarding the boolean meant a Set that
 * never reached the engine looked exactly like a Set that had: the next
 * autosave then read the engine's blank state and wrote it over the real one.
 * Reproduced: au=1 cl=2 size=670 on disk became "movy1\n".
 *
 * Retried, because one loss says nothing about the next attempt — the same
 * reasoning the device fixture uses for module loads. */
export function pushState(payload: string): boolean {
    let ok = false;
    if (typeof host_module_set_param_blocking === 'function') {
        for (let i = 0; i < 3 && !ok; i++) {
            ok = host_module_set_param_blocking('state', payload, 200);
            if (!ok) mlog('seq: state push attempt ' + (i + 1) + ' did not land');
        }
        if (!ok) mlog('seq: RESTORE FAILED — the engine never took this Set');
    } else {
        /* No blocking API to ask. Older hosts never reported either way, so
         * assume it landed rather than blocking every save on this device. */
        ok = true;
    }
    noteRestore(ok);
    /* The restore carries the lane labels and assignments with it, so the
     * automation registry has to be rebuilt from them — without this it stays
     * empty: no dot, no held value, no read-back suppression. */
    requestLabelSync();
    return ok;
}

/** Read a Set's state, push it into the engine, and apply its UI blob if it has
 *  one. The caller decides what to do when it does not. */
export function loadSet(id: string, name: string): { payload: string; gen: number; ok: boolean } {
    const st = resolveState(id, name);
    const ok = pushState(st.payload);
    const ui = readUiBlob(id);
    if (ui && ui.length > 0) applyUiState(ui);
    return { ...st, ok };
}
