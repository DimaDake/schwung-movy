/* The part of a chain's saved state that cannot ride the set document.
 *
 * The document says which module goes in which slot, and the engine attaches it
 * to a queued load. Everything else about a chain — the module's preset blob,
 * the two LFOs, the mixer triple — is addressed per chain and travels on the
 * bulk channel.
 *
 * **It is written once the loads the document queued have drained.** A payload
 * addressed to a chain whose module is not in yet has nothing to land on, and
 * the module comes up at its shipped defaults. Worse, the next capture then
 * reads those defaults and writes them into the set file, which is how a patch
 * was destroyed rather than merely not restored (measured under the overtake
 * host, where the shim's bulk mailbox also timed out behind a cold `dlopen`).
 *
 * So the payload waits for the drain (set-settle.ts knows when that is) and is
 * then queued once: movy-host's queue loses nothing, so the overtake-era retry
 * is gone (WP10). Until it is delivered, a capture must return what the set file
 * already holds — see `pendingPayloadFor`. */

import { mlog } from '../log.js';
import type { ChainTrackState } from './chain-persist.js';
import type { SendState } from './send-persist.js';
import { engineRootPort, portFor } from './registry.js';

export interface ChainPayload {
    /** Track index (0-15), or -1 for a send bus. */
    t: number;
    /** Set when this payload belongs to a send bus rather than a track. A send
     *  waits for the same drain for the same reason — its module load is queued
     *  by the same document and holds the same audio thread. */
    bus?: number;
    /** The per-chain writes, already namespaced by the destination's port. */
    pairs: [string, string][];
    /** What the set file holds for this chain. A capture taken before delivery
     *  returns THIS: the chain is still at the module's shipped defaults, and
     *  writing those down is the data loss, not the silent restore. */
    saved: ChainTrackState | SendState;
}

let pending: ChainPayload[] = [];

/** Hold these until the chain loads have drained. Replaces whatever the previous
 *  Set left outstanding — its chains are gone and its payload is not wanted. */
export function armChainPayloads(list: ChainPayload[]): void {
    pending = list;
}

export function resetChainPayloads(): void {
    pending = [];
}

/** The saved state of a track whose payload has not landed, or null.
 *
 *  This is the guard that keeps a failed restore from becoming a lost patch: the
 *  live chain is at defaults, so a capture must not read it. */
export function pendingPayloadFor(t: number): ChainTrackState | null {
    for (const p of pending) {
        if (p.bus === undefined && p.t === t) return p.saved as ChainTrackState;
    }
    return null;
}

/** The same guard for a send bus. */
export function pendingSendFor(bus: number): SendState | null {
    for (const p of pending) if (p.bus === bus) return p.saved as SendState;
    return null;
}

export function chainPayloadsPending(): boolean {
    return pending.length > 0;
}

/** Deliver what is still outstanding. Call only once the chain loads have
 *  drained — that is the whole point of the deferral.
 *
 *  Always lets the Set stop waiting. A write is refused only with no engine
 *  loaded, and a payload that cannot deliver must not hold the splash open;
 *  its entries STAY pending on purpose, so `pendingPayloadFor` goes on
 *  protecting the set file. */
export function deliverChainPayloads(): boolean {
    if (pending.length === 0) return true;

    const left: ChainPayload[] = [];
    for (const p of pending) {
        if (p.bus !== undefined) {
            /* A bus always exists — it is not a track and cannot be handed back
             * to the host mid-set. */
            if (!engineRootPort().setMany(p.pairs)) left.push(p);
            continue;
        }
        if (!portFor(p.t).setMany(p.pairs)) left.push(p);
    }
    pending = left;
    if (pending.length > 0) {
        mlog('chains: ' + pending.length + ' chain payload(s) NOT DELIVERED (no engine) — set file left intact');
    }
    return true;
}
