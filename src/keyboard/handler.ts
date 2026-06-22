import { keyboardState } from './state.js';
import { chromaticPadColor, chromaticPitch } from '../seq/pads.js';
import { C_GREEN } from '../seq/colors.js';
import { markUiStateDirty } from '../seq/persist.js';

/* Live pad note on the chromatic layout. Emits on the track's MIDI channel
 * (0x9n) so it reaches that track's chain slot, carrying real velocity. The
 * caller supplies the final velocity (Full Velocity is applied there). */
export function noteOn(padNote: number, padMin: number, track: number, vel: number): void {
    const midiNote = chromaticPitch(padNote, padMin, keyboardState.rootNote);
    if (midiNote < 0 || midiNote > 127) return;
    keyboardState.held[padNote] = midiNote;
    keyboardState.lastPlayedNote = midiNote;
    shadow_send_midi_to_dsp([MidiNoteOn | track, midiNote, vel]);
    setLED(padNote, C_GREEN, true); // immediate green feedback before the next poll
}

export function noteOff(padNote: number, padMin: number, track: number): void {
    const midiNote = keyboardState.held[padNote];
    if (midiNote === undefined) return;
    shadow_send_midi_to_dsp([MidiNoteOff | track, midiNote, 0]);
    delete keyboardState.held[padNote];
    setLED(padNote, chromaticPadColor(padNote, padMin, keyboardState.rootNote, track, false, null, keyboardState.scale), true);
}

export function releaseAllNotes(track: number): void {
    for (const padNote of Object.keys(keyboardState.held)) {
        shadow_send_midi_to_dsp([MidiNoteOff | track, keyboardState.held[+padNote], 0]);
    }
    for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];
}

/* Shift the chromatic layout's base note. +/- move by an octave. */
export function changeRoot(semitones: number, track: number, padMin: number, padMax: number): void {
    releaseAllNotes(track);
    keyboardState.rootNote = Math.max(0, Math.min(103, keyboardState.rootNote + semitones));
    for (let pad = padMin; pad <= padMax; pad++) {
        setLED(pad, chromaticPadColor(pad, padMin, keyboardState.rootNote, track, false, null, keyboardState.scale), true);
    }
    markUiStateDirty();
}
