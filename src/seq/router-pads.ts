/* Pad input for the sequencer: the held chord that step entry places, and the
 * note-on/off forwarding that lets the engine record what you play.
 *
 * Split out of router.ts, which is the dispatcher; this is the pad half of what
 * it dispatches to. */

import { deleteActive, deletePad } from './edit-ops.js';
import { engineReady, seqCmd } from './engine.js';
import { setHeldSet } from './held.js';
import { seqState } from './state.js';
import { anyStepHeld, editPad } from './step-edit.js';
import { stepRecPad, stepRecPadRelease } from './step-rec.js';

/* Pads currently held, padNote → midiNote, for chord step entry. Mirrors the
 * pads physically down so a step press can place the whole chord. */
const heldChord = new Map<number, number>();

/** The held chord's pitches, in press order — what a step press places. */
export function heldChordPitches(): number[] {
    return [...heldChord.values()];
}

/* Forget the held chord. A pad release that never arrives (Session mode
 * swallows pad note-offs by design; a modal swallows everything) would
 * otherwise leave that pitch in every step entered from then on. */
export function resetSeqChord(): void { heldChord.clear(); }

/* Pad note-on: remember the active track's last-played note (step-entry
 * value). If a step is held, the pad edits that step's notes (hold-step +
 * pad gesture) instead of joining the held chord. */
export function seqNotePadPlayed(track: number, padNote: number, midiNote: number, vel: number): void {
    if (track >= 0 && track < 4) {
        seqState.lastPitch[track] = midiNote;
        seqState.lastVel[track] = vel;
    }
    if (stepRecPad(padNote, midiNote, vel)) return;
    if (deleteActive()) {
        deletePad(midiNote); // hold Delete + pad clears that pitch
        return;
    }
    if (anyStepHeld()) {
        editPad(midiNote, vel);
        return;
    }
    heldChord.set(padNote, midiNote);
    setHeldSet(track, heldChordPitches());
    /* Forward to the engine for recording capture. The UI already sounded the
     * note directly (zero latency); the engine only records (no double note),
     * and ignores it unless armed. */
    if (engineReady()) seqCmd(`non ${track} ${midiNote} ${vel}`);
}

/* Pad note-off: drop it from the held chord and end any recording capture. The
 * track comes from the caller's ledger lookup, not seqState.watchTrack — a
 * track switch mid-hold used to send the capture-off to the wrong track and
 * leave a dangling rec_pending in the engine. */
export function seqNotePadReleased(padNote: number, track: number): void {
    if (stepRecPadRelease(padNote)) return;
    const midiNote = heldChord.get(padNote);
    heldChord.delete(padNote);
    if (midiNote !== undefined && engineReady()) {
        seqCmd(`nof ${track} ${midiNote}`);
    }
}
