/* What a track IS, independent of how you talk to it.
 *
 * Movy's tracks used to be schwung shadow slots, so "track" and "slot" were the
 * same number everywhere. They stop being the same thing once movy hosts chains
 * of its own, and this file is where that distinction is defined once. */

/** Tracks backed by a schwung shadow slot. Their index IS their slot number. */
export const HOST_TRACKS = 4;

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

export function trackKind(index: number): TrackKind {
    return index < HOST_TRACKS ? 'host' : 'movy';
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

/** Movy-side chain instance for a track, or -1 for a host track. 0-based: the
 *  first movy track (index 4) is chain instance 0. */
export function chainInstance(index: number): number {
    return index < HOST_TRACKS ? -1 : index - HOST_TRACKS;
}
