import type { DrumConfig } from '../types/param.js';
import { PAD_MAP } from './notes.js';

export function drumPadOn(
    physPad:      number,
    padMin:       number,
    shiftHeld:    boolean,
    drumConfig:   DrumConfig,
    rootNote:     number,
    componentKey: string,
    slot:         number,
): number | null {
    let midiNote: number;
    if (drumConfig.rawMidi) {
        midiNote = physPad;
    } else {
        const offset = PAD_MAP[physPad - padMin];
        if (offset === null || offset === undefined) return null;
        midiNote = rootNote + offset;
    }
    const drumPad = midiNote - drumConfig.padNoteStart + 1;
    if (drumPad < 1 || drumPad > drumConfig.padCount) return null;

    // Shift without shiftSelectMidi: select pad visually but suppress MIDI
    const suppressMidi = shiftHeld && !drumConfig.shiftSelectMidi;
    if (!suppressMidi) {
        shadow_send_midi_to_dsp([MidiNoteOn, midiNote, shiftHeld ? 1 : 100]);
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
): void {
    let midiNote: number;
    if (drumConfig.rawMidi) {
        midiNote = physPad;
    } else {
        const offset = PAD_MAP[physPad - padMin];
        if (offset === null || offset === undefined) return;
        midiNote = rootNote + offset;
    }
    const drumPad = midiNote - drumConfig.padNoteStart + 1;
    if (drumPad < 1 || drumPad > drumConfig.padCount) return;
    shadow_send_midi_to_dsp([MidiNoteOff, midiNote, 0]);
}
