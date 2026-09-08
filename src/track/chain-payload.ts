/* The part of a chain's saved state that cannot ride the set document.
 *
 * The document says which module goes in which slot, and the engine attaches it
 * to a queued load. Everything else about a chain — the module's preset blob,
 * the two LFOs, the mixer triple — is addressed per chain and travels on the
 * shim's bulk channel.
 *
 * **That channel cannot be written while the loads the document just queued are
 * draining.** `shadow_param_bulk_js` waits `SHADOW_PARAM_DEFAULT_TIMEOUT_MS`
 * (100 ms, shadow_ui.c) and does not retry, and the shim services the mailbox on
 * the audio thread — the same thread holding a cold `dlopen`. Measured on
 * device: obxd's load blocks it for 428 ms, so all four of a set's payload
 * writes timed out and every module came up at its shipped defaults. Worse, the
 * next capture then read those defaults and wrote them into the set file, which
 * is how a patch was destroyed rather than merely not restored.
 *
 * So the payload waits for the loads to drain (set-settle.ts already knows when
 * that is) and is retried until it lands. Until it does, a capture must return
 * what the set file already holds — see `pendingPayloadFor`. */

import { mlog } from '../log.js';
import type { ChainTrackState } from './chain-persist.js';
import type { SendState } from './send-persist.js';
import { chainInstance } from './ref.js';
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

/* Retries are ticks, not milliseconds: this runs from the settle loop, which is
 * already the thing bounding how long a Set may take to become playable. Twenty
 * is ~0.1-0.3 s at the device's 63-205 Hz — long enough to outlast a mailbox
 * that is merely busy, short enough that a wedged shim does not hold the splash
 * on its own (set-settle's own 10 s cap is the outer bound either way). */
const MAX_ATTEMPTS = 20;

let pending: ChainPayload[] = [];
let attempts = 0;

/** Hold these until the chain loads have drained. Replaces whatever the previous
 *  Set left outstanding — its chains are gone and its payload is not wanted. */
export function armChainPayloads(list: ChainPayload[]): void {
    pending = list;
    attempts = 0;
}

export function resetChainPayloads(): void {
    pending = [];
    attempts = 0;
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
 *  Returns whether the Set may stop waiting: true when everything landed, and
 *  also true once the attempts are spent, because a payload that will not
 *  deliver must not hold the splash open forever. In that second case the
 *  entries STAY pending on purpose — the chains are audibly wrong and the user
 *  can see that, but `pendingPayloadFor` goes on protecting the set file. */
export function deliverChainPayloads(): boolean {
    if (pending.length === 0) return true;
    attempts++;

    const left: ChainPayload[] = [];
    for (const p of pending) {
        if (p.bus !== undefined) {
            /* A bus always exists — it is not a track and cannot be handed back
             * to the host mid-set. */
            if (!engineRootPort().setMany(p.pairs)) left.push(p);
            continue;
        }
        /* No longer a movy chain — `chtracks` was turned off under us, or the
         * track went back to the host. There is nothing to deliver to, and
         * holding it would guard a capture that is no longer ours to guard. */
        if (chainInstance(p.t) < 0) continue;
        if (!portFor(p.t).setMany(p.pairs)) left.push(p);
    }
    pending = left;

    if (pending.length === 0) return true;
    if (attempts < MAX_ATTEMPTS) return false;
    mlog('chains: ' + pending.length + ' chain payload(s) NOT DELIVERED after '
        + attempts + ' attempts — set file left intact');
    return true;
}
