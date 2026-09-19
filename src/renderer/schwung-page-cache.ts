/* schwung-page-cache.ts — one round trip for a page, not one key per tick.
 *
 * SP-26. Schwung's controller has no bulk read: `page_controller.mjs:526` is
 * `io.getParam || (() => null)` and its value cursor is deliberately ONE key a
 * tick, sized against a schwung SLOT read at ~2.8 ms. On a movy CHAIN that read
 * is an engine GET at ~3.4 ms, and `reloadIfChanged` adds two more per 8 ticks,
 * so a delegated page cost ~1.25 blocking round trips a tick where movy's own
 * refresh cost ~0.1 — one `paramGetMany` for a whole page. Measured on device
 * (SP-13): the tick period went 4.9 ms to 9.1 ms, and the tick period IS movy's
 * MIDI sampling interval, which is the swallowed-detent complaint in its units.
 *
 * movy owns the `io` object it hands the controller, so this sits behind
 * `io.getParam`: an EPOCH cache in front of one port. Every FILL_TICKS the
 * epoch advances and one `port.getMany()` refills every tracked key; a read
 * inside the epoch is a map lookup. Nothing about Schwung changes — it still
 * asks one key at a time, and it still gets an answer no older than one fill.
 *
 * WHICH keys that round trip asks for is `schwung-page-batch.ts`, together with
 * `warm` — the way a page that has just ARRIVED gets covered before the
 * controller asks for it (SP-39).
 */

import type { TrackPort } from '../track/port.js';
import type { Entry } from './schwung-page-batch.js';
import { fill, warm as warmKeys } from './schwung-page-batch.js';

/*
 * THE SAME DIVIDER `reloadIfChanged` ALREADY RUNS ON, and Schwung's own host
 * paces its round trips on. Not a freshness trade: every drawn cell is
 * refreshed every ~40 ms, against a cursor that reached a given cell once per
 * ROTATION (~10 ticks on an eight-knob page). What does get coarser is a
 * modulated or `live` key, which refreshModulatedValues re-read every tick and
 * which now moves on the fill — ~25 Hz, the cadence the screen redraws at.
 */
const FILL_TICKS = 8;

export interface PageReadCache {
    /** Read a component-qualified key, from this epoch's fill where possible. */
    get(key: string): string | null;
    /** One movy tick. Advances the epoch and refills on the divider. */
    tick(): void;
    /**
     * Cover a set of keys — a page that is about to be shown — in ONE request.
     *
     * THE MOMENT MATTERS. Schwung's `warmCurrentPage` asks for every cell of the
     * page it has just turned to, synchronously, inside the gesture that turned
     * it; on a pad press that is the whole user-visible cost (SP-39). Warming
     * here, before that runs, turns the page's first read into one bulk request
     * instead of one blocking round trip per cell.
     */
    warm(keys: readonly string[]): void;
    /** Everything this port holds is suspect — a re-plan, or a module swap. */
    invalidateAll(): void;
}

/** Off: every read is a live read, which is what a non-bulk port wants. */
function passthrough(port: TrackPort): PageReadCache {
    return { get: (k) => port.getParam(k), tick() {}, warm() {}, invalidateAll() {} };
}

export function createPageReadCache(port: TrackPort): PageReadCache {
    /* A shadow slot read is served from schwung's own cache at ~0.3 ms, so
     * batching buys nothing there and the staleness would be a pure cost. */
    if (!port.bulkReads || typeof port.getMany !== 'function') return passthrough(port);

    const entries = new Map<string, Entry>();
    let epoch = 1;
    let sinceFill = 0;
    /* Where the port's write log was last drained from. Starting at the port's
     * CURRENT sequence rather than 0 is what stops a long-lived session's first
     * drain from reporting an overrun and dropping an empty cache. */
    let seenWrites = typeof port.writeSeq === 'function' ? port.writeSeq() : 0;

    /*
     * WHAT A WRITE MAKES STALE — the hazard SP-13 named, and why it is PULLED
     * from the port rather than pushed from the io. On a delegated page movy is
     * the writer: the knob under the hand (`io.setParam`), the sequencer, a
     * lane, undo, the drum handler — all through the one memoized
     * `portFor(track)`. Draining that log before serving ANY value covers every
     * one of them with a single rule and leaves nothing subscribed when a mode
     * change throws the page away. A knob that snaps back to a cached value is
     * a worse bug than a slow tick.
     */
    function drainWrites(): void {
        if (typeof port.writeSeq !== 'function' || typeof port.writesSince !== 'function') return;
        const seq = port.writeSeq();
        if (seq === seenWrites) return;
        const keys = port.writesSince(seenWrites);
        seenWrites = seq;
        if (keys === null) { entries.clear(); return; }
        for (const k of keys) invalidate(k);
    }

    function invalidate(key: string): void {
        /* A MODULE SWAP CHANGES EVERY VALUE ON THE PAGE — the hierarchy, the
         * param list and all eight cells belong to a module that has gone. */
        if (key.endsWith(':module')) { entries.clear(); return; }
        entries.delete(key);
        /* `k:base` and `k:effective` are the same parameter seen two other ways,
         * and Schwung reads both — a write to `k` invalidates all three. */
        const prefix = key + ':';
        for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
    }

    return {
        get(key: string): string | null {
            drainWrites();
            let e = entries.get(key);
            if (e && e.epoch === epoch) { e.asked = epoch; return e.value; }
            const v = port.getParam(key);
            /*
             * A NULL IS NEVER CACHED — not even one a live read just returned.
             * null is the channel saying it did not answer, the state the
             * controller's tri-state exists to re-ask about; storing it turns "I
             * do not know yet" into "there is nothing there" for the rest of the
             * epoch. It cost a whole page: a module that arrived while the grid
             * was off screen read as having no hierarchy, so the controller
             * paginated `chain_params` into ONE page and the jog had nowhere to
             * go. An empty STRING is a real answer and is cached like any other.
             */
            if (v === null) { entries.delete(key); return v; }
            if (!e) {
                e = { value: v, epoch, asked: epoch, len: v.length };
                entries.set(key, e);
            } else {
                e.value = v; e.epoch = epoch; e.asked = epoch; e.len = v.length;
            }
            return v;
        },
        tick(): void {
            drainWrites();
            if (++sinceFill < FILL_TICKS) return;
            sinceFill = 0;
            epoch++;
            fill(port, entries, epoch);
        },
        warm(keys: readonly string[]): void {
            drainWrites();
            warmKeys(port, entries, epoch, keys);
        },
        invalidateAll(): void { entries.clear(); },
    };
}
