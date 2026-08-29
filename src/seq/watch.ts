/* Which track the sequencer edits — the one number every step edit is keyed on.
 *
 * The engine owns it. `trk=` comes back in every status poll and overwrites the
 * UI's mirror ~24 times a second, so a retarget that only assigns the mirror is
 * undone within a couple of ticks and the next step press lands on the track
 * the engine still thinks is watched. That has to go out as a command, and it
 * is one line too easy to forget: three call sites retargeted the watch, and
 * two of them sent it.
 *
 * The watched track and `appState.activeTrack` (screen, pads, knobs) are set by
 * different gestures but must name the same track, or you record into a clip
 * you cannot hear — see track/switch.ts, which pairs them. */

import { seqCmd } from './engine.js';
import { requestLoopWindowAdopt, seqState } from './state.js';

/** Point the step view and the engine at `track`. No-op when already there:
 *  `watch` is a blocking IPC, and the track buttons re-assert it on every
 *  press. */
export function setWatchTrack(track: number): void {
    if (track === seqState.watchTrack) return;
    seqState.watchTrack = track;
    seqState.barOffset = 0;
    requestLoopWindowAdopt();   // the new track's window may start past bar 1
    seqCmd('watch ' + track);
}

/* Assert the watch even when the mirror already agrees. The engine outlives the
 * tool — closing movy leaves the DSP loaded and still watching whatever it was
 * told last — so an OPEN cannot trust the mirror's default to match it. */
export function forceWatchTrack(track: number): void {
    seqState.watchTrack = track;
    seqState.barOffset = 0;
    requestLoopWindowAdopt();
    seqCmd('watch ' + track);
}
