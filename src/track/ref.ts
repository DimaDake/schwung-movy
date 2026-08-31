/* What a track IS, independent of how you talk to it.
 *
 * Movy's tracks used to be schwung shadow slots, so "track" and "slot" were the
 * same number everywhere. They stop being the same thing once movy hosts chains
 * of its own, and this file is where that distinction is defined once.
 *
 * Since `chtracks`, a track's kind is a SETTING rather than a property of its
 * index. Read it, never cache it — `registry.ts` caches ports and
 * `host-mode.ts` is what drops that cache when the setting moves. */

import { flagValue } from '../seq/flags.js';
import { resolveHost } from '../seq/flags-def.js';

/** Tracks backed by a schwung shadow slot. Their index IS their slot number.
 *
 *  A ceiling, not a count: with `chtracks` on there are none, and these four
 *  tracks are movy chains like the rest. */
export const HOST_TRACKS = 4;

/** Chains movy hosts, one per track. Must equal `MOVY_CHAINS`
 *  (`chain_slots.rs`) — asserted in `browser-test/logic/tracks-refs.mjs`. */
export const MOVY_CHAINS = 16;

/* Must stay in lockstep with the engine's NUM_TRACKS (seq-core/src/track.rs):
 * a UI that expects more tracks than the engine reports parses garbage out of
 * the status string, and one that expects fewer silently hides three quarters
 * of the song. */
export const TRACK_COUNT = 16;

/** Tracks per group: the 4 track buttons, and one row of the session grid. */
export const GROUP_SIZE = 4;

export type TrackKind = 'host' | 'movy';

export interface TrackRef {
    index: number;
    kind:  TrackKind;
}

/** Whether tracks 1-4 are movy chains right now: the global mode, plus — when
 *  the mode defers to it — the value the current set carries. */
export function movyTracksOn(): boolean {
    return resolveHost(flagValue('chtracks'), flagValue('chtrackset'));
}

export function trackKind(index: number): TrackKind {
    if (index >= HOST_TRACKS) return 'movy';
    return movyTracksOn() ? 'movy' : 'host';
}

export function trackRef(index: number): TrackRef {
    return { index, kind: trackKind(index) };
}

export function trackGroup(index: number): number {
    return Math.floor(index / GROUP_SIZE);
}

export function trackIndexInGroup(index: number): number {
    return index % GROUP_SIZE;
}

/** Movy-side chain instance for a track, or -1 for a host track.
 *
 *  **A track's chain IS its index.** Track 4 is chain 4, track 15 is chain 15,
 *  and tracks 0-3 are chains 0-3 once `chtracks` gives them one — chains 0-3 sit
 *  unused until then.
 *
 *  This used to be `index - HOST_TRACKS`, so track 4 was chain 0. Nothing
 *  persisted survives the renumbering, because nothing persisted holds a chain
 *  index: the saved blob records a TRACK (`chain-persist.ts`, field `t`), and
 *  automation lanes and LFO targets are all written through a port. An old set
 *  therefore restores into chain 4 where it used to restore into chain 0, with
 *  the same module on the same track. */
export function chainInstance(index: number): number {
    return trackKind(index) === 'movy' ? index : -1;
}
