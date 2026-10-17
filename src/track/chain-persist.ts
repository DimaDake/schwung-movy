/* Saving and restoring the chains movy hosts itself.
 *
 * A track's chain exists only inside movy's engine, so if movy does not write it
 * down it is gone on the next open. This is that write-down. Tracks 1-4 used to
 * be schwung's, carried in Move's own set file; `track/migrate.ts` brought the
 * last of them here.
 *
 * **The set travels as one document, both ways.** It used to cross the wire as
 * one blocking param write per component, and under the overtake host a write
 * issued while a chain load's `dlopen` held the audio thread was refused and
 * discarded. One document is one ordered write into movy-host's queue, which
 * loses nothing (WP10). The engine writes the set down itself (chains.json);
 * this side only restores it. Design: plans/2026-08-29-chain-set-document.md.
 *
 * Preset blobs, LFO state and the mixer level follow in one bulk write per
 * track, and they are DEFERRED rather than issued here — the document is what
 * starts the loads that make the bulk channel unwritable. chain-payload.ts owns
 * that wait and the reason for it. */

import { CHAIN_SLOTS, isVirtualSlot } from '../chain/config.js';
import { armChainPayloads, resetChainPayloads, type ChainPayload } from './chain-payload.js';
import { paramSet } from '../host/param.js';
import { encodeBulk } from './bulk.js';
import { mlog } from '../log.js';
import { TRACK_COUNT } from './ref.js';
import { lfoPairs } from './lfo-persist.js';
import { mixPair } from './mix-persist.js';
import { sendPayloadPairs, sendTriples, type SendState } from './send-persist.js';

export interface ChainComponentState {
    /** Component key: "synth", "fx1", … */
    c: string;
    /** Module id. */
    m: string;
    /** Module-preset blob, omitted when the module publishes none. */
    s?: string;
}

export interface ChainTrackState {
    /** Track index (0-15). Stored rather than implied by position so a partial
     *  save stays readable and a future TRACK_COUNT change cannot shift it. */
    t: number;
    comp: ChainComponentState[];
    /** The chain's two LFOs, positional per `lfoStateKeys()`. Absent when both
     *  are idle. */
    lfo?: string[];
    /** The summing mixer's `gain,pan,muted` triple. Absent at the default. */
    mix?: string;
}

/** The engine param carrying the whole chain set. Addressed at the engine root
 *  rather than through a `TrackPort`, which namespaces every key to one chain —
 *  the point of this key is that it is not per-chain. */
const CHAIN_SET_KEY = 'chains';

/** Deliver the set: queued once, in order (WP10 retired the resend). */
function writeChainSet(doc: string): boolean {
    return paramSet(CHAIN_SET_KEY, doc);
}

/* The chain components worth persisting: every real slot, minus the virtual
 * pages. Asked of the SLOT rather than of its index, so a page appended after
 * the LFO cannot quietly join the list — a virtual slot in here means every
 * save asks the engine for a module that cannot exist, and every restore tries
 * to load one. */
export function persistableComponents(): string[] {
    return CHAIN_SLOTS.filter((s) => !isVirtualSlot(s)).map((s) => s.componentKey);
}

/** The saved state as the engine's document — flat `slot, component, module`
 *  triples — dropping anything this build (or this Move) cannot honour:
 *  unknown tracks and components are skipped rather than trusted. */
function chainSetTriples(saved: ChainTrackState[] | undefined | null): string[] {
    const known = new Set(persistableComponents());
    const flat: string[] = [];
    if (!Array.isArray(saved)) return flat;

    for (const track of saved) {
        const t = track?.t;
        if (typeof t !== 'number' || t < 0 || t >= TRACK_COUNT) continue;
        if (!Array.isArray(track.comp)) continue;
        for (const c of track.comp) {
            if (!c || typeof c.c !== 'string' || typeof c.m !== 'string') continue;
            if (!known.has(c.c) || c.m === '') continue;
            flat.push(String(t), c.c, c.m);
        }
    }
    return flat;
}

/** Write the chains back. Safe to call with anything a saved Set holds,
 *  including one from an older build.
 *
 *  Returns the number of components delivered — 0 when the document did not
 *  land, which the caller must treat as "this set is not loaded", never as
 *  "this set has no chains". */
export function restoreChains(
    saved: ChainTrackState[] | undefined | null,
    sends?: SendState[] | null,
): number {
    /* Whatever the previous Set left outstanding is not wanted: its chains are
     * about to be unloaded by the document below. */
    resetChainPayloads();
    /* The sends ride the same document, and are appended rather than sent
     * separately for the reason the document exists at all: one acknowledged
     * message that says the whole truth. Sent even when empty — that is the
     * instruction to unload the previous set's sends. */
    const triples = [...chainSetTriples(saved), ...sendTriples(sends)];
    const entries = triples.length / 3;

    /* Sent even when it is empty, and that is the point: an empty set is the
     * instruction to unload. schwung clears every slot on a set change before
     * loading the new set's; movy does it by naming the set it wants. Without
     * this a module outlived every switch, followed the user into a Set that had
     * never held it, and was written into that Set on the next autosave. */
    if (!writeChainSet(encodeBulk(triples))) {
        mlog('chains: SET NOT DELIVERED — ' + entries + ' component(s) still pending');
        return 0;
    }
    if (entries === 0) return 0;

    /* Now the parts that are addressed per chain — one bulk write per track,
     * and only for tracks that have something in them. They are ARMED, not
     * written: the document above has just queued the loads, and the bulk
     * channel is unwritable for as long as they hold the audio thread. */
    /* Which components actually made it into the document, so a blob can never
     * be addressed to a component the engine was not told about. */
    const sent = new Set<string>();
    for (let i = 0; i + 2 < triples.length; i += 3) sent.add(triples[i] + '|' + triples[i + 1]);

    const payloads: ChainPayload[] = [];
    for (const track of Array.isArray(saved) ? saved : []) {
        const t = track?.t;
        if (typeof t !== 'number' || t < 0 || t >= TRACK_COUNT) continue;
        const pairs: [string, string][] = [];
        for (const c of Array.isArray(track.comp) ? track.comp : []) {
            if (!c || typeof c.c !== 'string' || !sent.has(t + '|' + c.c)) continue;
            if (typeof c.s === 'string' && c.s !== '') pairs.push([c.c + ':state', c.s]);
        }
        const lfo = lfoPairs(track.lfo);
        if (lfo) pairs.push(...lfo);
        /* The mixer level. Not gated on the components the way a preset blob
         * is — it belongs to the chain, not to any module in it. */
        const mix = mixPair(track.mix);
        if (mix) pairs.push(mix);
        if (pairs.length === 0) continue;
        payloads.push({ t, pairs });
    }
    /* The sends' blobs wait for the same drain, for the same reason: their
     * loads were queued by the document above and hold the same audio thread. */
    for (const s of Array.isArray(sends) ? sends : []) {
        const pairs = sendPayloadPairs(s);
        if (pairs) payloads.push({ t: -1, bus: s.b, pairs });
    }
    armChainPayloads(payloads);
    return entries;
}
