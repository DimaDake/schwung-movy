import type { DrumConfig } from '../types/param.js';
import { keyboardState } from './state.js';

export function drumPadOn(
    physPad:      number,
    padMin:       number,
    shiftHeld:    boolean,
    drumConfig:   DrumConfig,
    rootNote:     number,
    componentKey: string,
    slot:         number,
    vel:          number,
): number | null {
    let midiNote: number;
    let drumPad:  number;
    if (drumConfig.rawMidi) {
        midiNote = physPad;
        drumPad  = midiNote - drumConfig.padNoteStart + 1;
    } else {
        const padIdx = physPad - padMin;
        const col    = padIdx % 8;
        const row    = Math.floor(padIdx / 8);
        if (col >= 4) return null;
        drumPad  = row * 4 + col + 1;
        midiNote = drumConfig.padNoteStart + drumPad - 1;
    }
    if (drumPad < 1 || drumPad > drumConfig.padCount) return null;

    const suppressMidi = shiftHeld && !drumConfig.shiftSelectMidi;
    if (!suppressMidi) {
        keyboardState.lastPlayedNote = midiNote;
        // Track the sounding pad so the drum grid lights it green while held
        // (a shift-select makes no sound, so it must not register as playing).
        keyboardState.held[physPad] = midiNote;
        shadow_send_midi_to_dsp([MidiNoteOn | slot, midiNote, shiftHeld ? 1 : vel]);
    }
    if (drumConfig.currentPadParam) {
        shadow_set_param(slot, componentKey + ':' + drumConfig.currentPadParam, String(drumPad));
    }
    return drumPad;
}

export function drumPadOff(
    physPad:    number,
    padMin:     number,
    drumConfig: DrumConfig,
    rootNote:   number,
    slot:       number,
): void {
    let midiNote: number;
    let drumPad:  number;
    if (drumConfig.rawMidi) {
        midiNote = physPad;
        drumPad  = midiNote - drumConfig.padNoteStart + 1;
    } else {
        const padIdx = physPad - padMin;
        const col    = padIdx % 8;
        const row    = Math.floor(padIdx / 8);
        if (col >= 4) return;
        drumPad  = row * 4 + col + 1;
        midiNote = drumConfig.padNoteStart + drumPad - 1;
    }
    if (drumPad < 1 || drumPad > drumConfig.padCount) return;
    delete keyboardState.held[physPad];
    shadow_send_midi_to_dsp([MidiNoteOff | slot, midiNote, 0]);
}
