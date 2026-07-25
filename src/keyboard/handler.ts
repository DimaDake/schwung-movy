import { keyboardState } from './state.js';
import { noteSounded, noteReleased } from './held-notes.js';
import { emitNoteOff, releaseAllLive } from './release.js';
import { chromaticPadColor, chromaticPitch } from '../seq/pads.js';
import { C_GREEN } from '../seq/colors.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';

/* Live pad note on the chromatic layout. Emits on the track's MIDI channel
 * (0x9n) so it reaches that track's chain slot, carrying real velocity. The
 * caller supplies the final velocity (Full Velocity is applied there). */
export function noteOn(padNote: number, padMin: number, track: number, vel: number): void {
    const midiNote = chromaticPitch(padNote, padMin, keyboardState.rootNote);
    if (midiNote < 0 || midiNote > 127) return;
    noteSounded(padNote, track, midiNote);
    keyboardState.lastPlayedNote = midiNote;
    shadow_send_midi_to_dsp([MidiNoteOn | track, midiNote, vel]);
    setLED(padNote, C_GREEN, true); // immediate green feedback before the next poll
}

/* The ledger — not the caller and not the currently active track — decides
 * which channel this off goes to. A track switch, module change, or view change
 * between press and release must not be able to redirect it. */
export function noteOff(padNote: number, padMin: number): void {
    const n = noteReleased(padNote);
    if (n === undefined) return;
    emitNoteOff(n.track, n.pitch);
    setLED(padNote, chromaticPadColor(padNote, padMin, keyboardState.rootNote, n.track, false, null, keyboardState.scale), true);
}

/* Set the chromatic layout's base note to an absolute MIDI note (clamped),
 * releasing held notes. Pads are deliberately NOT painted here: app/tick.ts owns
 * pad LEDs and is track-aware (chromatic vs drum vs Session clip grid), so a root
 * change repaints chromatic pads on the next tick without ever overwriting a drum
 * rack or clip grid. */
export function setRoot(absNote: number): void {
    releaseAllLive();
    keyboardState.rootNote = Math.max(0, Math.min(103, absNote));
    markUiStateDirty();
}

/* Shift the chromatic layout's base note. +/- move by an octave. */
export function changeRoot(semitones: number): void {
    setRoot(keyboardState.rootNote + semitones);
}
