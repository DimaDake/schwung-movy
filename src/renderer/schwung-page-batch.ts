/* schwung-page-batch.ts — what one round trip asks for, and what comes back.
 *
 * The epoch cache in `schwung-page-cache.ts` makes two decisions: WHEN to spend
 * a round trip, and WHICH KEYS to spend it on. This is the second, and it is
 * apart from the first because the two have different reasons — the divider is
 * about freshness (SP-26), the key list is about coverage (SP-39).
 *
 * A KEY THE CACHE HAS NEVER SEEN IS NEVER PREFETCHED. `fill` walks the entries
 * the cache already holds, and a key enters that map only by being asked for, so
 * the first read of a cell is always a live round trip. For a page that has been
 * on screen for a while that is one read per rotation and the divider hides it;
 * for a page that has just ARRIVED it is every cell at once, and Schwung's
 * `warmCurrentPage` pays all of them synchronously on the gesture that turns the
 * page. `warm` is the way out: hand it the keys of a page you know is arriving
 * and it reads the whole page in one request, before the controller asks.
 */

import type { TrackPort } from '../track/port.js';

/* A key asked within this many epochs stays in the batch. Two, because the
 * cursor's rotation (page keys + 1) can outlast one fill, so a key can go
 * unasked for a whole epoch and still be on screen. */
export const KEEP_EPOCHS = 2;

/* The shim caps a bulk request at SHADOW_BULK_MAX_ITEMS = 64
 * (schwung_shim.c:4689) and drops the whole request above it; the overflow here
 * is read live rather than lost. */
export const BATCH_MAX_KEYS = 48;

/* A BIG VALUE IS READ ALONE. The whole bulk RESPONSE shares
 * SHADOW_PARAM_VALUE_LEN (131072) and the fleet's heaviest contract (minijv) is
 * 39 KB of `ui_hierarchy` plus 45 KB of `chain_params`. An overflow is not a
 * correctness problem — `paramGetMany` falls back to one read per key — but it
 * costs exactly what this file removes. Plaits is 2.3 KB for both, so an
 * ordinary module's contract still rides the batch. */
export const BATCH_VALUE_MAX = 16384;

export interface Entry {
    value: string | null;
    /** The epoch this answer was read in; anything older is a miss. */
    epoch: number;
    /** The last epoch someone asked for this key — what keeps it in the batch. */
    asked: number;
    /** Last seen value length, so an oversized value stays out of the batch. */
    len: number;
}

/** The keys worth asking for in one round trip, most recently asked first. */
export function batchKeys(entries: Map<string, Entry>, epoch: number): string[] {
    const live: Entry[] = [];
    const keys: string[] = [];
    for (const [k, e] of entries) {
        if (epoch - e.asked > KEEP_EPOCHS) { entries.delete(k); continue; }
        /* THE SIZE POLICY IS APPLIED HERE AND NOT AT SEEDING, which is a real
         * asymmetry and a deliberate one to leave alone: `warm` (SP-39) seeds an
         * entry directly at the current epoch with `len` unset, so a page whose
         * cell is enormous can enter the batch for one window that a cache which
         * had READ it would have kept out. It costs the once-per-epoch read the
         * warm was making anyway, and `len` is corrected by that read, so the
         * entry drops out of the batch from the next window on. Not fixed: the
         * fix is a second size policy at the seeding site, and the ledger records
         * why it is not worth one (SP-39, "noticed and left alone"). */
        if (e.len > BATCH_VALUE_MAX) continue;
        live.push(e);
        keys.push(k);
    }
    if (keys.length <= BATCH_MAX_KEYS) return keys;
    const order = keys.map((k, i) => [k, live[i].asked] as const)
                      .sort((a, b) => b[1] - a[1]);
    return order.slice(0, BATCH_MAX_KEYS).map(([k]) => k);
}

export function fill(port: TrackPort, entries: Map<string, Entry>, epoch: number): void {
    const keys = batchKeys(entries, epoch);
    if (keys.length === 0) return;
    apply(port, entries, epoch, keys);
}

/**
 * Read keys the cache has not covered — for a page whose cells are all new.
 *
 * THE CALLER KNOWS THE PAGE IS COMING AND THE CACHE DOES NOT, which is the
 * whole reason this is a parameter and not a rule of the divider: a page change
 * is an instant, and a divider is a cadence. Reading the arriving page's cells
 * here costs ONE request where the asks that follow would have cost one each.
 */
export function warm(port: TrackPort, entries: Map<string, Entry>, epoch: number,
                     keys: readonly string[]): void {
    const ask: string[] = [];
    for (const k of keys) {
        if (!k) continue;
        const e = entries.get(k);
        /* Asked-for-this-epoch is already an answer; a stale one is a miss the
         * divider would have picked up, and reading it here is free. */
        if (e && e.epoch === epoch) { e.asked = epoch; continue; }
        ask.push(k);
    }
    if (ask.length === 0) return;
    apply(port, entries, epoch, ask.slice(0, BATCH_MAX_KEYS));
}

/** One request for `keys`, and what a short or refused answer means for each. */
function apply(port: TrackPort, entries: Map<string, Entry>, epoch: number,
               keys: string[]): void {
    const values = port.getMany(keys);
    for (let i = 0; i < keys.length; i++) {
        const v = values[i];
        /*
         * A BATCH NULL IS NOT AN ANSWER, and caching it would be the granny
         * `--` bug wearing a new hat. `paramGetMany` maps "" to null, so a
         * bulk answer cannot tell "served and empty" — which is what a module
         * says when there is no file — from "the read did not complete",
         * which is what the controller holds and retries on. Leaving it
         * absent costs one live read, which IS faithful, and that answer is
         * what gets cached.
         */
        if (v === null || v === undefined) {
            /* ...but a batch null over a value that is ALREADY "" says what
             * the live read said, so that entry stays current rather than
             * costing a round trip every epoch — on device an unserved key
             * answers "" and `preset_name` is unserved on plenty of
             * modules. A batch null over a REAL value still expires. */
            const e0 = entries.get(keys[i]);
            if (e0 && e0.value === '') e0.epoch = epoch;
            continue;
        }
        const e = entries.get(keys[i]);
        if (!e) { entries.set(keys[i], { value: v, epoch, asked: epoch, len: v.length }); continue; }
        e.value = v; e.epoch = epoch; e.asked = epoch; e.len = v.length;
    }
}
