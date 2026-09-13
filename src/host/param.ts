/* The one door to Schwung's param channel.
 *
 * Everything movy says to its engine — a sequencer command, a knob value, a
 * chain document, a Set command — goes through `overtake_dsp`'s param SHM, and
 * that is a SINGLE SLOT shared with every other writer on the device. A write
 * claims the slot, waits for the shim to service it, and reports failure by
 * returning false. It fails for two different reasons the caller cannot tell
 * apart: the claim timed out (nothing was written), or the response did not
 * arrive in time (the request may have been taken anyway).
 *
 * Why this file exists at all: that one fact had been rediscovered, on device,
 * by six subsystems in turn — the DSP load re-issues itself until `ping`
 * matches, the automation registry came back empty from polling during a
 * restore, the probe grew a 150-frame gap, Set persistence moved wholesale into
 * the engine so commands travel instead of payloads, master FX grew a mirror,
 * and the sequencer's own command batches were being dropped in silence until
 * 2026-09-13. Six workarounds for one missing property. This does not add that
 * property — a reliable transport needs the slot to stop being one slot, which
 * is a Schwung change — but it gives every caller ONE place that knows the
 * rules, and it makes the failure COUNTABLE. A dropped write is otherwise
 * perfectly silent, which is why a green test run never proved the channel was
 * healthy.
 *
 * What this file does NOT do is retry. Retrying is not universally correct: a
 * knob stream wants last-write-wins (the value after it supersedes the one that
 * was lost), while an ordered command stream wants delivery. So delivery is
 * opt-in and lives where the ordering is understood — `seq/engine.ts` resends
 * its `cmd` batch behind a `#<seq>` tag the engine deduplicates on.
 * `track/chain-persist.ts` has its own bounded retry for the same reason.
 */

/* The bulk wire format is `track/bulk.ts` — left where its own tests live and
 * where its six other callers already import it from, rather than moved here
 * for tidiness. */
import { decodeBulk, encodeBulk } from '../track/bulk.js';

/* Blocking writes need a timeout, and a UI tick is the budget. 50 ms is long
 * enough for the shim's SPI frame and short enough that a contended slot costs
 * one late frame rather than a visible stall. */
const DEFAULT_SET_TIMEOUT_MS = 50;

/* Routing marker for the bulk channel: the shim dispatches on this prefix and
 * hands the payload to whichever DSP is loaded as overtake — movy's engine. */
const BULK_MARKER = 'overtake_dsp:';

export type ParamStats = {
    /** Writes attempted. */
    sets: number;
    /** Writes the slot REFUSED — the number that matters. */
    refused: number;
    /** The last key a refusal was carrying, for the page that shows the count. */
    lastRefusedKey: string;
    /** Reads attempted, and how many answered nothing. */
    gets: number;
    getNulls: number;
    /** Bulk reads that came back malformed and had to be re-read one by one.
     *  Also channel health: the fallback is correct but costs N round trips. */
    bulkFallbacks: number;
};

let sets = 0;
let refused = 0;
let lastRefusedKey = '';
let gets = 0;
let getNulls = 0;
let bulkFallbacks = 0;

export function paramStats(): ParamStats {
    return { sets, refused, lastRefusedKey, gets, getNulls, bulkFallbacks };
}

/** Test hook, and the reset a fresh engine session deserves. */
export function resetParamStats(): void {
    sets = 0; refused = 0; lastRefusedKey = ''; gets = 0; getNulls = 0; bulkFallbacks = 0;
}

/** Both halves of the channel are present — i.e. we are on a host at all. */
export function paramAvailable(): boolean {
    return typeof host_module_set_param === 'function'
        && typeof host_module_get_param === 'function';
}

export function paramGet(key: string): string | null {
    if (typeof host_module_get_param !== 'function') return null;
    gets++;
    const v = host_module_get_param(key);
    if (v === null) getNulls++;
    return v;
}

/** Write one param. `false` means it did not get through — see the header for
 *  why that is not the same as "it did not happen". */
export function paramSet(key: string, value: string,
                         timeoutMs: number = DEFAULT_SET_TIMEOUT_MS): boolean {
    sets++;
    if (typeof host_module_set_param_blocking === 'function') {
        /* An explicit false is a REFUSAL. Anything else — including a host that
         * returns nothing at all — counts as delivered, because a host with no
         * answer gives us no grounds to claim a loss. */
        if (host_module_set_param_blocking(key, value, timeoutMs) === false) {
            refused++;
            lastRefusedKey = key;
            return false;
        }
        return true;
    }
    if (typeof host_module_set_param === 'function') {
        /* Fire-and-forget: no answer, so no verdict. Counted as delivered for
         * the same reason as above, and this path is not what runs on device. */
        host_module_set_param(key, value);
        return true;
    }
    return false;
}

/** Read many params in ONE round trip.
 *
 *  A single engine GET blocks ~3-5 ms on device and a param page refreshes
 *  eight knobs at a time; done one by one that is ~40 ms against a tick period
 *  that IS movy's MIDI sampling interval. */
export function paramGetMany(keys: string[]): (string | null)[] {
    if (keys.length === 0) return [];
    if (typeof shadow_get_params !== 'function') return keys.map(paramGet);
    const items = decodeBulk(shadow_get_params(0, BULK_MARKER, encodeBulk(keys)));
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
    if (typeof shadow_set_params !== 'function') {
        let ok = true;
        for (const [k, v] of pairs) if (!paramSet(k, v)) ok = false;
        return ok;
    }
    const flat: string[] = [];
    for (const [k, v] of pairs) { flat.push(k); flat.push(v); }
    sets += pairs.length;
    if (shadow_set_params(0, BULK_MARKER, encodeBulk(flat)) === true) return true;
    refused += pairs.length;
    lastRefusedKey = pairs[pairs.length - 1][0];
    return false;
}
