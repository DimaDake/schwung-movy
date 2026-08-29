/* Saving and restoring the chains movy hosts itself.
 *
 * A host track's chain is schwung's — Move's own set file carries it. A movy
 * track's chain exists only inside movy's engine, so if movy does not write it
 * down it is gone on the next open. This is that write-down.
 *
 * **The set travels as one document, both ways.** It used to cross the wire as
 * one blocking param write per component, each with its own 50 ms timeout and
 * none of them acknowledged. The shim services those writes on the audio
 * thread — the same thread a chain load's blocking `dlopen` holds for 78-276 ms
 * — so a write issued during the drain could not be serviced, returned false,
 * and was discarded by a caller that never looked. The set then shrank on disk,
 * because the save read back whatever had actually loaded. One document can be
 * acknowledged, and retried whole when it is not.
 *
 * The engine answers with what was REQUESTED, not what has finished loading, so
 * a save taken while loads are still draining still reports the whole set.
 * Design: plans/2026-08-29-chain-set-document.md.
 *
 * Preset blobs, LFO state and the mixer level follow in one bulk write per
 * track, and they are DEFERRED rather than issued here — the document is what
 * starts the loads that make the bulk channel unwritable. chain-payload.ts owns
 * that wait and the reason for it. */

import { CHAIN_SLOTS, isLfoSlot } from '../chain/config.js';
import { armChainPayloads, pendingPayloadFor, resetChainPayloads, type ChainPayload }
    from './chain-payload.js';
import { decodeBulk, encodeBulk } from './bulk.js';
import { mlog } from '../log.js';
import { TRACK_COUNT, chainInstance, trackKind } from './ref.js';
import { portFor } from './registry.js';
import { lfoPairs, lfoStateKeys, packLfoState } from './lfo-persist.js';
import { MIX_KEY, mixPair, packMix } from './mix-persist.js';

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

/* Generous, and deliberately not the port's 50 ms: this write races a cold
 * `dlopen` on the shim's own thread, which is the whole reason the old
 * per-component writes were being dropped. */
const SET_TIMEOUT_MS = 500;

/* The chain components worth persisting: every real slot, minus the virtual LFO
 * page (it has no module of its own). */
function persistableComponents(): string[] {
    return CHAIN_SLOTS.filter((_, i) => !isLfoSlot(i)).map((s) => s.componentKey);
}

/** The last blob captured for `<track>|<component>`, so a read that fails can
 *  fall back to it. A module written into the set file with no preset is a
 *  track that lost its sound, and this file is the only place that blob is. */
const lastBlob = new Map<string, string>();

function readChainSet(): string | null {
    if (typeof host_module_get_param !== 'function') return null;
    return host_module_get_param(CHAIN_SET_KEY);
}

/** Deliver the set. One retry, because the refusal this is guarding against is
 *  transient by nature — the shim was busy opening the previous module. */
function writeChainSet(doc: string): boolean {
    if (typeof host_module_set_param_blocking !== 'function') return false;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (host_module_set_param_blocking(CHAIN_SET_KEY, doc, SET_TIMEOUT_MS)) return true;
    }
    return false;
}

/** Read every movy-hosted chain that has something loaded. */
export function captureChains(): ChainTrackState[] {
    const doc = decodeBulk(readChainSet());
    /* A malformed answer is not an empty set. Reading it as one would hand the
     * autosave a set with no chains and delete the user's work. */
    if (!doc || doc.length % 3 !== 0) return [];

    /* Group the flat triples by track. A movy track's chain IS its index, so
     * the slot the engine reports is the track we store. */
    const known = new Set(persistableComponents());
    const byTrack = new Map<number, ChainComponentState[]>();
    for (let i = 0; i + 2 < doc.length; i += 3) {
        const t = Number(doc[i]);
        const c = doc[i + 1], m = doc[i + 2];
        if (!Number.isInteger(t) || t < 0 || t >= TRACK_COUNT) continue;
        /* A chain the engine still holds for a track that is no longer movy's
         * belongs to the host now and must not be written into this set. */
        if (trackKind(t) !== 'movy' || !known.has(c) || m === '') continue;
        const comps = byTrack.get(t) ?? [];
        comps.push({ c, m });
        byTrack.set(t, comps);
    }

    const out: ChainTrackState[] = [];
    for (const t of [...byTrack.keys()].sort((a, b) => a - b)) {
        /* This track's saved payload has not reached the chain yet, so the chain
         * is sitting at the module's shipped defaults. Reading it would write
         * those defaults over the patch in the set file — the actual data loss
         * behind "my filter reopened". Hand back what is already on disk. */
        const held = pendingPayloadFor(t);
        if (held) { out.push(held); continue; }
        const comps = byTrack.get(t)!;
        const port = portFor(t);
        /* One bulk round trip for the whole track: the blobs, and the LFO keys
         * riding along. An LFO can only target a loaded module, so a track with
         * nothing loaded is never here and costs nothing. */
        const lfoKeys = lfoStateKeys();
        const tail = port.getMany(
            [...comps.map((c) => c.c + ':state'), ...lfoKeys, MIX_KEY]);
        const track: ChainTrackState = { t, comp: comps };
        comps.forEach((comp, i) => {
            const key = t + '|' + comp.c;
            const blob = tail[i] ?? lastBlob.get(key);
            if (blob) { comp.s = blob; lastBlob.set(key, blob); }
        });
        const lfo = packLfoState(tail.slice(comps.length, comps.length + lfoKeys.length));
        if (lfo) track.lfo = lfo;
        const mix = packMix(tail[comps.length + lfoKeys.length]);
        if (mix) track.mix = mix;
        out.push(track);
    }
    return out;
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
        /* The real gate, and the only one since `chtracks`: tracks 0-3 have a
         * chain when the flag is on and none when it is off. A set saved with
         * it on and reopened with it off leaves those entries on disk, so
         * turning it back on finds them again. */
        if (chainInstance(t) < 0) continue;
        if (!Array.isArray(track.comp)) continue;
        for (const c of track.comp) {
            if (!c || typeof c.c !== 'string' || typeof c.m !== 'string') continue;
            if (!known.has(c.c) || c.m === '') continue;
            flat.push(String(t), c.c, c.m);
        }
    }
    return flat;
}

/** Write the chains back. Safe to call with anything `captureChains` produced,
 *  including from an older build.
 *
 *  Returns the number of components delivered — 0 when the document did not
 *  land, which the caller must treat as "this set is not loaded", never as
 *  "this set has no chains". */
export function restoreChains(saved: ChainTrackState[] | undefined | null): number {
    /* Whatever the previous Set left outstanding is not wanted: its chains are
     * about to be unloaded by the document below. */
    resetChainPayloads();
    const triples = chainSetTriples(saved);
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
        if (typeof t !== 'number' || chainInstance(t) < 0) continue;
        const pairs: [string, string][] = [];
        for (const c of Array.isArray(track.comp) ? track.comp : []) {
            if (!c || typeof c.c !== 'string' || !sent.has(t + '|' + c.c)) continue;
            if (typeof c.s === 'string' && c.s !== '') {
                pairs.push([c.c + ':state', c.s]);
                lastBlob.set(t + '|' + c.c, c.s);
            }
        }
        const lfo = lfoPairs(track.lfo);
        if (lfo) pairs.push(...lfo);
        /* The mixer level. Not gated on the components the way a preset blob
         * is — it belongs to the chain, not to any module in it. */
        const mix = mixPair(track.mix);
        if (mix) pairs.push(mix);
        if (pairs.length === 0) continue;
        payloads.push({ t, pairs, saved: track });
    }
    armChainPayloads(payloads);
    return entries;
}
