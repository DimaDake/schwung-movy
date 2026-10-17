/* After a whole-module restore, make the slot's models re-read the module.
 *
 * A single param undo needs nothing here: it writes through the port, and the
 * Schwung page's read cache sees the write. Lives in undo/ rather than apply.ts
 * so apply.ts keeps no import of app state. */

import { appState } from '../app/state.js';

/** A whole-module restore changed everything at once, so there is no key list
 *  to walk — tell the slot's models to re-read from scratch. */
export function refreshModels(slot: number): void {
    for (const m of appState.trackModels[slot] ?? []) m.reload();
    appState.dirty = true;
}
