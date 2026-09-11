/* Mirrors each track's drum/melodic identity into the engine (`tdrum`).
 *
 * The engine sequences all sixteen tracks but has no idea what module a chain
 * slot holds; only the UI does. It needs the answer because a drum module's
 * pitches are pad addresses, not notes — clip transpose must not shift them, or
 * the step plays a different voice (or none, when it lands off the pad range). */

import { TRACK_COUNT } from '../track/ref.js';
import { appState, trackIsDrum } from '../app/state.js';
import { seqCmd } from './engine.js';

/* Was a local 4 while the state arrays had already moved to TRACK_COUNT, so drum
 * identity was only ever reported for the first four tracks — a track holding a
 * drum module never reported, and the engine went on transposing a drum clip it
 * was already playing. */
const NUM_TRACKS = TRACK_COUNT;

/* Last value sent per track; -1 = unknown, so the first answer always sends. */
const sent = new Array(TRACK_COUNT).fill(-1) as number[];

/* Cheap per-tick check: nothing is sent while the answer is unchanged. A track
 * with no answer at all is skipped rather than reported melodic — a transient
 * "not loaded" must not clear a drum flag mid-playback.
 *
 * There used to be a second path here: a direct param probe for tracks whose
 * model had not loaded, because a SCHWUNG SLOT's module could change from
 * outside movy and an unvisited track would otherwise never report. No track is
 * a schwung slot any more — a chain can only change from inside movy — so the
 * model is the only authority, and the probe is gone with it. Its retry budget
 * went too: that existed because an empty slot never answers, and four of them
 * probing every tick cost ~11 ms of a tick period that is also how often knob
 * MIDI is sampled. */
export function drumSyncTick(): void {
    for (let t = 0; t < NUM_TRACKS; t++) {
        const model = appState.trackModels[t]?.[1];
        if (!model || !model.hasLoadedParams()) continue;
        const drum = trackIsDrum(t) ? 1 : 0;
        if (sent[t] === drum) continue;
        sent[t] = drum;
        seqCmd('tdrum ' + t + ' ' + drum);
    }
}

/* Forget what the engine was told — on tool open and after an engine reload,
 * where `track_drum` is back to its default (all melodic) and must be re-sent. */
export function resetDrumSync(): void {
    sent.fill(-1);
}
