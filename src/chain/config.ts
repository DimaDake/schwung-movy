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

/* Read-back param key for a component's loaded module id. The device sets a
 * module with the colon key (`fx1:module`) but track-chain components expose
 * the loaded id under an underscore alias (`fx1_module`) — while a master FX
 * component (already colon-namespaced, e.g. `master_fx:fx1`) has no underscore
 * alias and is read with the same colon key it was set with
 * (`master_fx:fx1:module`). Without this distinction a freshly added master FX
 * module reads back as empty and the slot keeps showing "click jog to add". */
export function moduleReadKey(componentKey: string): string {
    return componentKey.includes(':')
        ? componentKey + ':module'
        : componentKey + '_module';
}
