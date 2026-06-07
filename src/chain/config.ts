export interface ChainSlot {
    componentKey: string;
    label:        string;
    scanDir:      string;
    expectedType: string;
}

export const CHAIN_SLOTS: ChainSlot[] = [
    { componentKey: 'midi_fx1', label: 'MIDI FX', scanDir: 'midi_fx',         expectedType: 'midi_fx'         },
    { componentKey: 'synth',    label: 'SYNTH',   scanDir: 'sound_generators', expectedType: 'sound_generator' },
    { componentKey: 'fx1',      label: 'FX 1',    scanDir: 'audio_fx',         expectedType: 'audio_fx'        },
    { componentKey: 'fx2',      label: 'FX 2',    scanDir: 'audio_fx',         expectedType: 'audio_fx'        },
];
