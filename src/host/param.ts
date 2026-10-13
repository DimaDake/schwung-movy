/* The one door to movy's engine.
 *
 * Everything movy says to its engine — a sequencer command, a knob value, a
 * chain document, a Set command — goes through movy-host's param queue
 * (host/param_queue.c): one record per request, serviced in order by the audio
 * thread before each render. Nothing is lost and nothing is reordered, so a
 * write simply goes in the queue and the caller moves on.
 *
 * Until WP10 this file carried the overtake host's rules instead: a single
 * shared param slot that dropped writes, so every set blocked, counted its
 * refusals, and the ordered streams (the `cmd` batch, the chain document)
 * resent behind their own dedupe. The queue made all of that dead weight
 * (plans/2026-10-13-wp10-direct-engine-channel.md).
 *
 * A GET still waits for its answer: the audio thread services it at the next
 * frame boundary, up to ~2.9 ms. Status, which the UI wants every tick, is not
 * read this way at all — it comes from the snapshot (seq/engine.ts). */

/* The bulk wire format is `track/bulk.ts` — left where its own tests live and
 * where its six other callers already import it from, rather than moved here
 * for tidiness. */
import { decodeBulk, encodeBulk } from '../track/bulk.js';
import { platform } from '../platform/index.js';

export type ParamStats = {
    /** Writes queued. */
    sets: number;
    /** Reads attempted, and how many answered nothing. */
    gets: number;
    getNulls: number;
    /** Bulk reads that came back malformed and had to be re-read one by one.
     *  Channel health: the fallback is correct but costs N round trips. */
    bulkFallbacks: number;
};

let sets = 0;
let gets = 0;
let getNulls = 0;
let bulkFallbacks = 0;

export function paramStats(): ParamStats {
    return { sets, gets, getNulls, bulkFallbacks };
}

/** Test hook, and the reset a fresh engine session deserves. */
export function resetParamStats(): void {
    sets = 0; gets = 0; getNulls = 0; bulkFallbacks = 0;
}

export function paramGet(key: string): string | null {
    const v = platform.engineGet(key);
    gets++;
    if (v === null) getNulls++;
    return v;
}

/** Queue one write. `false` only when no engine is loaded. */
export function paramSet(key: string, value: string): boolean {
    sets++;
    return platform.engineSet(key, value);
}

/** Read many params in ONE round trip.
 *
 *  A single engine GET blocks ~3-5 ms on device and a param page refreshes
 *  eight knobs at a time; done one by one that is ~40 ms against a tick period
 *  that IS movy's MIDI sampling interval. */
export function paramGetMany(keys: string[]): (string | null)[] {
    if (keys.length === 0) return [];
    const raw = platform.engineGetBulk(encodeBulk(keys));
    const items = decodeBulk(raw);
    /* A malformed or short response must not read as "every param is empty" —
     * that would paint a whole page of zeroed knobs over the real values. */
    if (!items || items.length !== keys.length) {
        bulkFallbacks++;
        return keys.map(paramGet);
    }
    return items.map((v) => (v === '' ? null : v));
}

/** Write many params in ONE round trip. */
export function paramSetMany(pairs: [string, string][]): boolean {
    if (pairs.length === 0) return true;
    const flat: string[] = [];
    for (const [k, v] of pairs) { flat.push(k); flat.push(v); }
    sets += pairs.length;
    return platform.engineSetBulk(encodeBulk(flat));
}
