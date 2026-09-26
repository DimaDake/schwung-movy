/* schwung-page-decorations.ts — the p-lock decoration pass.
 *
 * Which cells a held step has marked, and what each one will play. Split out of
 * `schwung-page-render.ts` when that file ran out of room: SP-16 (Cause G2)
 * changes the condition directly below and has to be able to write about why,
 * and the seam was already here — this answers "what should the cells SAY", the
 * rendering either side of it answers "draw them".
 */

import type { AutomationView } from '../types/viewmodel.js';

/* The decoration a cell carries, whole. `value` is never absent and `exact` is
 * always false (SP-59) — see the two notes below. */
export interface Decoration {
    locked: true;
    value: number;
    exact: false;
}

/*
 * ASKED BY PARAMETER, which is what makes re-pagination harmless: the mark
 * follows the key, not the cell it used to sit in.
 *
 * THE TWO FIELDS, AND THEIR EXACT MEANINGS — this is the whole contract, and
 * the migration ledger once named a third:
 *
 *   locked  TRUE means "the held step locks this PARAMETER". The cell gets a
 *           mark (a 2x2 top-left corner on the movy layout) and, from #509,
 *           its label band inverts to show the value.
 *
 *   value   SET means "and here is what the step will play". It REPLACES the
 *           live value in the cell — both `raw` and `liveRaw`, so the pointer
 *           moves too (`render_page_movy.mjs` ~2599). Always SET: a lane with no
 *           held value is a lane this step does not lock, so it gets no
 *           decoration at all rather than a mark with nothing behind it.
 *
 * `exact` IS ALWAYS FALSE, AND THAT IS A CHOICE ABOUT THE MARK, NOT A CLAIM
 * ABOUT THE LOCK (SP-59, the user's call). Since #509 `exact` gates only
 * Schwung's top-left corner ("a point sits on this step"); the inverted value
 * band keys on `locked` alone. movy cannot use that corner:
 *   - movy's lane is ALREADY marked, all the time, by `isAutomated`'s 2x2
 *     beside the label — a second dot on a held step says the same parameter
 *     twice, in two places, in the same glyph;
 *   - on a cell a graphic covers (envelope, filter) the corner lands on the
 *     picture's own pixels and cannot be seen;
 *   - movy has no curve between locks, so the distinction it draws (a point vs
 *     a curve passing through) never arises: the inverted value already means
 *     "this step locks it".
 * A Schwung older than #509 ignores the field and still draws its corner —
 * nothing to be done from here, and it goes with the upgrade.
 *
 * `null` means "no decorations at all", which is also what an empty page gets:
 * an all-null array is the array form of the same statement, and the controller
 * treats the two alike.
 */
export function decorationsFor(
    auto: AutomationView | undefined,
    keys: (string | null)[],
): (Decoration | null)[] | null {
    /* A HELD STEP IS THE ONLY THING THERE IS TO SAY (SP-16, Cause G2). The
     * bitmask is live for as long as the track HAS locks, so on an automated
     * page it is set on every frame — decorating on it alone put a lock mark
     * and an inverted label band on cells whose lock belongs to some step, not
     * to this one. Under the old viz gate that only cost the graphics; with
     * upstream's gate gone (schwung #509) it costs MEANING, and that is worse:
     * a mark that is always there says "locked" about a cell nobody locked. */
    if (!auto || !auto.held) return null;
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
        const held = auto.heldValues.get(lane);
        /* NO VALUE, NO DECORATION (SP-59). `heldValues` is the held step's
         * own locks, so a lane with no entry is a lane THIS step does not
         * lock — the "mark that lies" of SP-16, one level down. It drew the
         * top-left corner on every automated cell of a held step, and against
         * a Schwung that inverts a locked band (#509) it would show the live
         * value inverted as though the step played it. That the parameter HAS
         * a lane is `isAutomated`'s mark, which is always on. */
        return held === undefined ? null : { locked: true, value: held, exact: false };
    });
    return decs.some(Boolean) ? decs : null;
}
