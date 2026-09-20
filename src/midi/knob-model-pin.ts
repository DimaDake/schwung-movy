/* Ownership ledger for a knob that is under a finger — the MODEL that heard
 * the press, so its release lands on it and not on whatever model
 * `knobModel()` resolves to at release time.
 *
 * `knobModel()` (router.ts) is `masterChainActive() ? masterModel() :
 * activeModel()` — resolved fresh on every call, so a track switch, chain-slot
 * swap, or Session toggle between a knob's press and its release hands the
 * release to a DIFFERENT `Model` instance than the one whose `handleKnobTouch`
 * opened an enum/file overlay or armed `touchedSlots`. That model's overlay
 * then never commits: it sits open until `app/tick.ts`'s `shownKey` check
 * reactively wipes it the next time that model is shown again — after the
 * user's roll is already lost, never because the release landed right.
 *
 * Unlike `knob-page-pin.ts`'s pin, this one is flag-independent: the press
 * site (`router.ts`'s fallback branch) calls `knobModel()?.handleKnobTouch`
 * unconditionally, delegated or not, so there is always a model to pin
 * whenever there was a press to react to. `pinModel(knob, null)` therefore
 * means only "no model for this chain slot" (an empty chain slot — `knobModel()`
 * itself returned undefined) — it must NEVER mean "delegated, so forget it"
 * the way `knob-page-pin.ts`'s `pinPage(knob, null)` does. That page rule is
 * correct for a page (a movy-owned or not-yet-resolved page has no page to
 * hand a release to), but applying it here would delete the model pin right
 * after every press under `off` (or `page` before a contract settles) —
 * exactly the flag state where this bug is most reachable. That incompatible
 * "null clears" rule is why this is its own ledger and not a shared Map with
 * `knob-page-pin.ts`; only the Map bookkeeping (`createKnobLedger`) is shared. */

import { createKnobLedger } from './knob-page-pin.js';
import type { Model } from '../model/index.js';

const pinned = createKnobLedger<Model>();

/* Always sets when non-null; a `null` model deletes any pin for this knob, but
 * ONLY meaning "no model to pin" (empty chain slot) — never "delegated, so
 * forget it" the way `knob-page-pin.ts`'s `pinPage(knob, null)` means (see
 * file header). The press site calls this unconditionally on every press, so
 * a `null` here reflects `knobModel()` itself returning undefined, not a
 * page-ownership decision. */
export function pinModel(knob: number, model: Model | null): void {
    if (model) pinned.set(knob, model);
    else pinned.delete(knob);
}

/* Remove and return the model owed this release, or undefined if the press
 * pinned none (empty chain slot, or a release with no press). */
export function unpinModel(knob: number): Model | undefined {
    return pinned.take(knob);
}

export function modelPinnedCount(): number { return pinned.size; }

/* Forget every pin — same boundary as `clearPins()`: the foreground is being
 * handed away, or this is a fresh open, and past that point a release
 * provably cannot arrive. */
export function clearModelPins(): void { pinned.clear(); }
