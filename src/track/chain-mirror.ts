/* The chains, read back from the file the ENGINE writes.
 *
 * With `engpersist` on, `chains.json` is the truth and this is the only reader
 * of it on the UI side. What it produces goes into `ui-state.json` as a MIRROR:
 * a build with the flag off looks for the chains there, so without this copy
 * flipping the flag back would cost the user their chains — and a flag you
 * cannot flip back is not an escape hatch.
 *
 * The engine GET this replaces (`readChainDoc`) is the one behind
 * docs/persistence-hazards.md §3 and §4: an answer that came back malformed was
 * read as an empty set, and an answer taken mid-drain reported chains that had
 * not loaded yet. A file read has neither problem — the engine writes what it
 * holds, and an unreadable file leaves the previous mirror alone.
 *
 * No `pendingPayloadFor` here, deliberately: that exists because the UI used to
 * read a chain back before its saved payload had reached it. The engine writes
 * from its own state, so there is no window in which it under-reports. */

import { busOfDocSlot, type SendState } from './send-persist.js';
import { decodeBulk } from './bulk.js';
import { lfoStateKeys } from './lfo-persist.js';
import { TRACK_COUNT } from './ref.js';
import type { ChainComponentState, ChainTrackState } from './chain-persist.js';

/** Fields per record, matching `FIELDS` in `engine/.../chain_state.rs`. */
const FIELDS = 6;

export interface Mirror {
    chains: ChainTrackState[];
    sends: SendState[];
}

/** Parse `chains.json`, or null when it is missing or malformed.
 *
 *  NEVER an empty mirror for an unreadable file: writing `[]` over a real chain
 *  set is the §3 failure, and it does not become safe by happening in a
 *  different file. */
export function parseMirror(raw: string | null): Mirror | null {
    const items = decodeBulk(raw);
    if (!items || items.length % FIELDS !== 0) return null;

    const byTrack = new Map<number, ChainTrackState>();
    const sends: SendState[] = [];
    const lfoLen = lfoStateKeys().length;

    for (let i = 0; i < items.length; i += FIELDS) {
        const slot = Number(items[i]);
        const [c, m, s, mix, lfo] = items.slice(i + 1, i + FIELDS);
        if (!Number.isInteger(slot) || m === '') continue;

        const bus = busOfDocSlot(slot);
        if (bus >= 0) {
            sends.push(s ? { b: bus, m, s } : { b: bus, m });
            continue;
        }
        if (slot < 0 || slot >= TRACK_COUNT) continue;

        const comp: ChainComponentState = s ? { c, m, s } : { c, m };
        const track = byTrack.get(slot) ?? { t: slot, comp: [] };
        track.comp.push(comp);
        /* Mix and LFO ride the chain's FIRST component, so a later record for
         * the same track carries empty ones — never overwrite with those. */
        if (mix) track.mix = mix;
        if (lfo) {
            const vals = decodeBulk(lfo);
            if (vals && vals.length === lfoLen) track.lfo = vals;
        }
        byTrack.set(slot, track);
    }

    return {
        chains: [...byTrack.keys()].sort((a, b) => a - b).map((t) => byTrack.get(t)!),
        sends,
    };
}
