/* schwung-page-decorations.ts — the p-lock decoration pass.
 *
 * Which cells a held step has marked, and what each one will play. Split out of
 * `schwung-page-render.ts` when that file ran out of room: SP-16 (Cause G2)
 * changes the condition directly below and has to be able to write about why,
 * and the seam was already here — this answers "what should the cells SAY", the
 * rendering either side of it answers "draw them".
 */

import type { AutomationView } from '../types/viewmodel.js';

/* The decoration a cell carries, whole. There is no third field and there is no
 * `exact` — see the two meanings below, which is all of it. */
export interface Decoration {
    locked: true;
    value?: number;
}

/*
 * ASKED BY PARAMETER, which is what makes re-pagination harmless: the mark
 * follows the key, not the cell it used to sit in.
 *
 * THE TWO FIELDS, AND THEIR EXACT MEANINGS — this is the whole contract, and
 * the migration ledger once named a third:
 *
 *   locked  TRUE means "some automation lane that is live on this frame holds
 *           this PARAMETER". The cell gets a mark (a 2x2 top-left corner on the
 *           movy layout, `render_page_movy.mjs` ~2700).
 *
 *   value   SET means "and here is what the step will play". It REPLACES the
 *           live value in the cell — both `raw` and `liveRaw`, so the pointer
 *           moves too (`render_page_movy.mjs` ~2599). ABSENT means "marked, but
 *           the lock has no resolved value"; the live value is drawn as usual.
 *           That is the case for a lock recorded against a lane whose value the
 *           engine has not reported, and it must stay distinguishable from a
 *           lock that resolves to the value the knob already holds.
 *
 * THERE IS NO `exact` FLAG, and the migration brief for SP-18 assumed one. The
 * decorations contract in this Schwung version is `{ locked, value }` and
 * nothing else — grep `setDecorations` across `param_pages/`: `render_page.mjs`
 * consumes exactly those two, `render_page_movy.mjs` likewise, and the
 * controller's `setDecorations` is a bare passthrough besides. So "keep
 * `exact`" is the `value === undefined` case above. Nothing here may start
 * writing a third field — the renderer would ignore it and the mark would
 * silently mean the wrong thing.
 *
 * `null` means "no decorations at all", which is also what an empty page gets:
 * an all-null array is the array form of the same statement, and the controller
 * treats the two alike.
 */
export function decorationsFor(
    auto: AutomationView | undefined,
    keys: (string | null)[],
): (Decoration | null)[] | null {
    if (!auto) return null;
    const decs = keys.map((k): Decoration | null => {
        if (!k) return null;
        const lane = auto.laneForKey(k);
        const on = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
        if (!on) return null;
        /* ON A HELD STEP YOU LOOK AT WHAT THE STEP WILL PLAY, not at where the
         * knob happens to be. movy has already resolved the held value per lane;
         * passing only `locked` marked the cell and then drew the LIVE value
         * underneath it, which is the one reading a parameter lock must not
         * show. `decoration.value` is exactly this, and Schwung already prefers
         * it over the live value. */
        const held = auto.held ? auto.heldValues.get(lane) : undefined;
        return held === undefined ? { locked: true } : { locked: true, value: held };
    });
    return decs.some(Boolean) ? decs : null;
}
