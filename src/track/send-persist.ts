/* Saving and restoring the two send FX buses.
 *
 * A send is not a track, so it gets its own array in the saved blob rather than
 * a `ChainTrackState` with `t: 16` — a reader that took `t` for a track index
 * would address a track that does not exist. On the WIRE they travel in the
 * same chain-set document: the codec is flat `slot, component, module` triples
 * and slot-generic, and the engine already expects a bus at `MOVY_CHAINS + n`
 * (`send_queue_slot`), so one acknowledged document still says the whole truth
 * about what should be loaded. */

import { MOVY_CHAINS } from './ref.js';
import { engineRootPort } from './registry.js';
import { pendingSendFor } from './chain-payload.js';
import { SEND_COMPONENT, SEND_BUSES } from '../chain/config.js';

export interface SendState {
    /** Bus index, 0 or 1. */
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

/** Pull the send entries out of a decoded chain-set document. */
export function sendsFromDoc(doc: string[] | null): SendState[] {
    if (!doc || doc.length % 3 !== 0) return [];
    const out: SendState[] = [];
    for (let i = 0; i + 2 < doc.length; i += 3) {
        const bus = busOfDocSlot(Number(doc[i]));
        if (bus < 0 || doc[i + 1] !== SEND_COMPONENT || doc[i + 2] === '') continue;
        out.push({ b: bus, m: doc[i + 2] });
    }
    return out;
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

/** Read the sends the engine holds, with their preset blobs.
 *
 * `doc` comes from the same read `captureChains` uses — an engine GET blocks
 * ~3-5 ms and this runs on every autosave. */
export function captureSends(doc: string[] | null): SendState[] {
    const sends = sendsFromDoc(doc);
    if (sends.length === 0) return [];
    const port = engineRootPort();
    const blobs = port.getMany(sends.map((s) => 'snd' + s.b + ':state'));
    return sends.map((s, i) => {
        /* This bus's saved payload has not reached its FX yet, so the FX is
         * sitting at the module's shipped defaults. Reading it would write those
         * over the patch in the set file — the same trap `pendingPayloadFor`
         * guards for a track. */
        const held = pendingSendFor(s.b);
        if (held) return held;
        const key = 'snd' + s.b;
        const blob = blobs[i] ?? lastSendBlob.get(key);
        if (blob) { lastSendBlob.set(key, blob); return { ...s, s: blob }; }
        return s;
    });
}

/** The last blob captured per bus, so a read that fails falls back to it — a
 *  module written into the set file with no preset is a send that lost its
 *  sound, and this is the only place that blob is. */
const lastSendBlob = new Map<string, string>();

/** A saved send's per-bus writes, or null when it carries none. */
export function sendPayloadPairs(s: SendState): [string, string][] | null {
    if (!s || typeof s.s !== 'string' || s.s === '') return null;
    return [['snd' + s.b + ':state', s.s]];
}
