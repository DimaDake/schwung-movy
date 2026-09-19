/* automated-keys.ts — what a delegated page needs to know about movy's lanes.
 *
 * SP-36. Two answers, one lookup, for a page that belongs to a (track,
 * component) rather than to a model — the same shape and the same reason as
 * `modulated-keys.ts`: the lane registry is app state, the page is a renderer,
 * so the page is handed a FUNCTION and never imports `seq/`.
 *
 * WHY THE PAGE ASKS AT ALL. Schwung's controller already draws the reading the
 * reporter asked for — the pointer stays at the base you dialled in and a
 * 5-pixel mark rides the arc at the driven value — for any key movy reports as
 * modulated. It gets there by asking movy's own io for `<key>:base` and
 * `<key>:effective`, and under `page` both of those go to the engine port,
 * which has only ONE value for an automated parameter: the one the lane is
 * driving it to. So the base has to come from movy (`seq/automation-base.ts`),
 * and this is where the page reaches it.
 *
 * ACTIVE, NOT MERELY ASSIGNED, and that is the same test movy's own renderer
 * applies for its automation dot (`model/viewmodel.ts`: `lane >= 0 &&
 * (activeLanes & 1 << lane)`). A lane with no automation recorded anywhere
 * drives nothing, so marking it would say "this is moving" about a parameter
 * that is standing still — and the two arms would disagree about what the word
 * means, which is the divergence the migration ledger exists to prevent.
 */

import { seqState } from '../seq/state.js';
import { automationRegistry, laneForParam } from '../seq/automation.js';
import { laneBase, noteLaneBase } from '../seq/automation-base.js';

import type { PageAutomation } from '../types/page-automation.js';

/**
 * The lane view for `track`, as the page's keys address it.
 *
 * THE KEY FORM IS THE REGISTRY'S, WITH NOTHING TO TRANSLATE. A lane's
 * `targetParam` is `component:concreteKey` (`assignLane`), and the controller
 * asks its io with the component already on the key and a child level already
 * resolved — so the two are the same string and a lane belonging to another
 * pad's voice simply matches nothing, which is exactly what should happen to
 * its mark.
 */
const cache: (PageAutomation | undefined)[] = [];

/* One object per track, kept. The view closes over the track index and nothing
 * else — every answer is read live off the registry — so a fresh one per call
 * would be a new object and three new closures on EVERY param read the page
 * makes, once a tick on the value cursor and once more on the modulated lane.
 * The page is asking about ownership, not allocating. */
export function automationFor(track: number): PageAutomation {
    const hit = cache[track];
    if (hit) return hit;
    const laneOf = (fullKey: string): number => {
        const lane = laneForParam(track, fullKey);
        if (lane < 0) return -1;
        /* `autoActive` is the engine's own bitmask, mirrored by the status
         * poll — a lane is ACTIVE when it has automation to play.
         *
         * IT IS THE WATCHED TRACK'S MASK, whatever `track` says: the engine
         * builds `aauto` from `self.tracks[self.watch_track]` (`engine.rs`
         * status()), so this is exact for the track whose page is on screen and
         * an approximation for any other. `model/viewmodel.ts` reads it the
         * same way through `buildAutomationView`, which is the property that
         * matters here — the two renderers must not disagree about which
         * parameters are automated. Do not reach for it from a caller that is
         * NOT drawing the watched track without fixing it in both places. */
        return (seqState.autoActive & (1 << lane)) !== 0 ? lane : -1;
    };
    const view: PageAutomation = {
        isAutomated: (fullKey: string) => laneOf(fullKey) >= 0,
        baseOf(fullKey: string) {
            const lane = laneOf(fullKey);
            return lane < 0 ? null : laneBase(track, lane);
        },
        noteBase(fullKey: string, value: number) {
            /* ASSIGNED, not active: a turn is an edit of the base whether or
             * not the lane has a lock recorded yet, and the mirror going stale
             * for the window before the first lock is what would make the
             * pointer jump back the moment automation started. */
            const lane = laneForParam(track, fullKey);
            if (lane >= 0) noteLaneBase(track, lane, value);
        },
    };
    cache[track] = view;
    return view;
}

/** The registry range for a lane, for the engine's 7-bit base seed. */
export function laneRangeOf(track: number, lane: number): { min: number, max: number } | null {
    const e = automationRegistry()[track]?.[lane];
    return e ? { min: e.min, max: e.max } : null;
}

/**
 * Is there an assigned lane whose base movy does not hold?
 *
 * THE GUARD IN FRONT OF THE `abases` READ, and it is not micro-optimisation.
 * That read goes to the `overtake_dsp:` param SHM, which is a SINGLE SLOT: a
 * read issued while something else is using it does not merely queue, it
 * competes, and movy's own set restore has been starved by exactly this kind of
 * traffic before (`test-device/device.ts` open()). The seed is only ever useful
 * for a lane movy never sent a base for — a Set the engine restored — so asking
 * when there is no such lane is a round trip for an answer that would be
 * discarded, on the one channel that cannot afford it.
 *
 * Cheap: at most 16 x 8 array reads and a Map lookup each, and it short-circuits
 * on the first lane that needs the seed.
 */
export function anyLaneNeedsBase(): boolean {
    const reg = automationRegistry();
    for (let t = 0; t < reg.length; t++) {
        const lanes = reg[t];
        if (!lanes) continue;
        for (let l = 0; l < 8; l++) {
            if (lanes[l] && laneBase(t, l) === null) return true;
        }
    }
    return false;
}
