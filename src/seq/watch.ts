/* Which track the sequencer edits, and keeping the engine's view of it current.
 *
 * There is ONE track — `appState.activeTrack` — and this file is the reason it
 * stays one. It used to be two: a UI-side mirror that every edit read as "the
 * track I am editing", written at each gesture, and the same field written by
 * the status poll as "the track the engine is reporting about". They were kept
 * equal by remembering to update both at four call sites, which is exactly the
 * kind of list that rots — one of the four never sent its command at all, and
 * opening movy on track 2 recorded the take into track 1's clip.
 *
 * So `watch` is PUSHED BY COMPARISON, NOT BY EVENT — the same rule pad-route.ts
 * follows for the pad map, and for the same reason: the things that change the
 * watched track (a track button, a Session launch, a peek revert, the open
 * itself) are a list, and comparing the actual value cannot forget an entry.
 *
 * `watch` is a view subscription, not state. Every edit op names its track
 * explicitly (`tog 2 0 72 100`), so what the engine watches decides only which
 * track's `occ`/`len`/`pos`/`hold` come back in the status — which is why the
 * engine reporting a DIFFERENT track is meaningful: it is the acknowledgement.
 * A re-dlopened engine is a brand new one watching track 0, and says so on its
 * next poll; that disagreement is what re-sends the command. */

import { appState } from '../app/state.js';
import { seqState } from './state.js';

/** The track every step edit belongs to. The one definition. */
export function watchedTrack(): number {
    return appState.activeTrack.index;
}

/* What the engine was last told, or -1 for "does not know". Kept here rather
 * than read back off seqState so a send is decided by what WE sent, not by a
 * mirror the engine can overwrite — that overwrite was the original bug. */
let pushedTrack = -1;
let pushedLane = -2;   // -1 is a real lane value (melodic), so start outside it

/** Push `watch`/`wlane` if the engine's copy is out of date. Called once per
 *  tick from the engine tick, next to the pad map; cheap when nothing moved. */
export function syncWatch(send: (op: string) => void): void {
    const track = watchedTrack();
    if (track !== pushedTrack) {
        pushedTrack = track;
        send('watch ' + track);
    }
    if (seqState.watchLane !== pushedLane) {
        pushedLane = seqState.watchLane;
        send('wlane ' + (pushedLane < 0 ? -1 : pushedLane));
    }
}

/* The engine's answer, from the status poll. Disagreement means the command
 * was lost or the engine was replaced under us, so drop what we believe it
 * knows and let the next tick say it again. Only ever called with a value the
 * engine actually reported — an optimistic write here would defeat the point. */
export function noteReportedTrack(track: number): void {
    if (pushedTrack >= 0 && track !== pushedTrack) pushedTrack = -1;
}

/** Forget what the engine knows. A re-dlopened engine has no watch and no lane;
 *  believing otherwise leaves the step row showing track 1's clip (and a drum
 *  track's steps merged across every lane) until something else happens to
 *  change them. */
export function resetWatchPush(): void {
    pushedTrack = -1;
    pushedLane = -2;
}
