/* Loading a Set into the live engine: one pass, no decisions.
 *
 * WHETHER to load is set-session's call — this module only knows HOW. Keeping
 * the two apart is what stops "load" from quietly reacquiring the policy that
 * used to let a blank Set land on top of a live pattern. */

import { requestLabelSync } from './engine.js';
import { readBestState, readUiBlob } from './persist-store.js';
import { resolveState } from './set-inherit.js';
import { applyUiState } from './ui-state.js';

/** Does this Set already own state? The rename-vs-switch question. */
export function setHasState(id: string): boolean {
    return readBestState(id) !== null;
}

/* Blocking on purpose: the engine must be holding the Set before any input is
 * accepted, and this runs once per Set rather than per tick. */
export function pushState(payload: string): void {
    if (typeof host_module_set_param_blocking === 'function')
        host_module_set_param_blocking('state', payload, 200);
    /* The restore carries the lane labels and assignments with it, so the
     * automation registry has to be rebuilt from them — without this it stays
     * empty: no dot, no held value, no read-back suppression. */
    requestLabelSync();
}

/** Read a Set's state, push it into the engine, and apply its UI blob if it has
 *  one. The caller decides what to do when it does not. */
export function loadSet(id: string, name: string): { payload: string; gen: number } {
    const st = resolveState(id, name);
    pushState(st.payload);
    const ui = readUiBlob(id);
    if (ui && ui.length > 0) applyUiState(ui);
    return st;
}
