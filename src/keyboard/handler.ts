import { PAD_MAP } from './notes.js';
import { keyboardState } from './state.js';
import { padLedColor } from './leds.js';

export function noteOn(padNote: number, padMin: number, padMax: number): void {
    const offset = PAD_MAP[padNote - padMin];
    if (offset === null || offset === undefined) return;
    const midiNote = keyboardState.rootNote + offset;
    if (midiNote < 0 || midiNote > 127) return;
    keyboardState.held[padNote] = midiNote;
    shadow_send_midi_to_dsp([MidiNoteOn, midiNote, 100]);
    setLED(padNote, BrightRed, true);
}

export function noteOff(padNote: number, padMin: number): void {
    const midiNote = keyboardState.held[padNote];
    if (midiNote === undefined) return;
    shadow_send_midi_to_dsp([MidiNoteOff, midiNote, 0]);
    delete keyboardState.held[padNote];
    setLED(padNote, padLedColor(padNote, padMin), true);
}

export function releaseAllNotes(): void {
    for (const padNote of Object.keys(keyboardState.held)) {
        shadow_send_midi_to_dsp([MidiNoteOff, keyboardState.held[+padNote], 0]);
    }
    for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];
}

export function changeRoot(semitones: number, padMin: number, padMax: number): void {
    releaseAllNotes();
    keyboardState.rootNote = Math.max(0, Math.min(103, keyboardState.rootNote + semitones));
    for (let pad = padMin; pad <= padMax; pad++) {
        setLED(pad, padLedColor(pad, padMin), true);
    }
}
