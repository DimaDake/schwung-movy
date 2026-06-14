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

export const MASTER_FX_SLOTS: ChainSlot[] = [
    { componentKey: 'master_fx:fx1', label: 'MFX 1', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'master_fx:fx2', label: 'MFX 2', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'master_fx:fx3', label: 'MFX 3', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'master_fx:fx4', label: 'MFX 4', scanDir: 'audio_fx', expectedType: 'audio_fx' },
];
