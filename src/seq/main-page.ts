/* Set Parameters page: global sequencer settings (tempo, swing, quantize,
 * root, key, mode, layout), opened with Shift+Step 5 and exited with Back.
 * Schwung draws it from a virtual contract (`set-params-contract.ts`, SP-53);
 * the writers are `main-page-apply.ts`. */

import { appState, VIEW_MAIN_PARAMS } from '../app/state.js';
import { endEdit } from '../undo/group.js';

/* No `active` flag lives here. Whether this page is up IS
 * `appState.currentView === VIEW_MAIN_PARAMS` — the same thing app/tick.ts
 * renders from. They used to be two fields synced by hand at the open site, and
 * any path that moved currentView without closing the page left this one
 * latched "active". The knob dispatch asks this page first, so a latched flag
 * silently ate every knob turn on every other page — until movy was reopened. */
export function mainPageActive(): boolean {
    return appState.currentView === VIEW_MAIN_PARAMS;
}

/* The undo boundary: each knob's turn is one gesture, closed on release. */
export function mainPageRelease(k: number): void {
    endEdit('mainknob:' + k);
}
