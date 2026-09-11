/* What a track IS.
 *
 * Movy's tracks used to be schwung shadow slots, so "track" and "slot" were the
 * same number everywhere. They are not any more: every track is a chain movy
 * hosts itself, and the one-time migration in `track/migrate.ts` is what carried
 * the last schwung-hosted ones across.
 *
 * A track's kind used to be a SETTING (`chtracks`), which meant nothing here
 * could be cached and every reader had to ask. That is gone — there is one kind. */

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

export interface TrackRef {
    index: number;
}

export function trackRef(index: number): TrackRef {
    return { index };
}

export function trackGroup(index: number): number {
    return Math.floor(index / GROUP_SIZE);
}

export function trackIndexInGroup(index: number): number {
    return index % GROUP_SIZE;
}

/** Movy-side chain instance for a track.
 *
 *  **A track's chain IS its index.** Track 0 is chain 0, track 15 is chain 15.
 *
 *  This used to be `index - HOST_TRACKS`, so track 4 was chain 0, and later it
 *  returned -1 for a track schwung was hosting. Nothing persisted survives
 *  either change, because nothing persisted holds a chain index: the saved blob
 *  records a TRACK (`chain-persist.ts`, field `t`), and automation lanes and LFO
 *  targets are all written through a port. */
export function chainInstance(index: number): number {
    return index;
}
