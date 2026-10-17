/* Saving and restoring the send FX buses.
 *
 * A send is not a track, so it gets its own array in the saved blob rather than
 * a `ChainTrackState` with `t: 16` — a reader that took `t` for a track index
 * would address a track that does not exist. On the WIRE they travel in the
 * same chain-set document: the codec is flat `slot, component, module` triples
 * and slot-generic, and the engine already expects a bus at `MOVY_CHAINS + n`
 * (`send_queue_slot`), so one acknowledged document still says the whole truth
 * about what should be loaded. */

import { MOVY_CHAINS } from './ref.js';
import { SEND_COMPONENT, SEND_BUSES } from '../chain/config.js';

export interface SendState {
    /** Bus index, 0 to SEND_BUSES-1. */
    b: number;
    /** Module id. */
    m: string;
    /** Module-preset blob, omitted when the module publishes none. */
    s?: string;
}

/** Document slot for a bus. Must match `send_queue_slot` in `chain_slots.rs`. */
export function sendDocSlot(bus: number): number { return MOVY_CHAINS + bus; }

/** The bus a document slot addresses, or -1 when it addresses a track. */
export function busOfDocSlot(slot: number): number {
    const bus = slot - MOVY_CHAINS;
    return bus >= 0 && bus < SEND_BUSES ? bus : -1;
}

/** Saved sends as document triples, dropping anything this build cannot honour. */
export function sendTriples(saved: SendState[] | undefined | null): string[] {
    const flat: string[] = [];
    if (!Array.isArray(saved)) return flat;
    const seen = new Set<number>();
    for (const s of saved) {
        if (!s || typeof s.b !== 'number' || typeof s.m !== 'string') continue;
        if (s.b < 0 || s.b >= SEND_BUSES || s.m === '') continue;
        /* One module per bus. A duplicate would queue two loads into the same
         * instance and the second would win silently. */
        if (seen.has(s.b)) continue;
        seen.add(s.b);
        flat.push(String(sendDocSlot(s.b)), SEND_COMPONENT, s.m);
    }
    return flat;
}

export function sendPayloadPairs(s: SendState): [string, string][] | null {
    if (!s || typeof s.s !== 'string' || s.s === '') return null;
    return [['snd' + s.b + ':state', s.s]];
}
