/* The part of a chain's saved state that cannot ride the set document.
 *
 * The document says which module goes in which slot, and the engine attaches it
 * to a queued load. Everything else about a chain — the module's preset blob,
 * the two LFOs, the mixer triple — is addressed per chain and travels on the
 * bulk channel.
 *
 * **It is written once the loads the document queued have drained.** A payload
 * addressed to a chain whose module is not in yet has nothing to land on, and
 * the module comes up at its shipped defaults (measured under the overtake
 * host, where the shim's bulk mailbox also timed out behind a cold `dlopen`).
 *
 * So the payload waits for the drain (set-settle.ts knows when that is) and is
 * then queued once: movy-host's queue loses nothing, so the overtake-era retry
 * is gone (WP10). */

import { mlog } from '../log.js';
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

export function chainPayloadsPending(): boolean {
    return pending.length > 0;
}

/** Deliver what is still outstanding. Call only once the chain loads have
 *  drained — that is the whole point of the deferral.
 *
 *  Always lets the Set stop waiting. A write is refused only with no engine
 *  loaded, and a payload that cannot deliver must not hold the splash open;
 *  its entries STAY pending, so a later delivery can still land them. */
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
