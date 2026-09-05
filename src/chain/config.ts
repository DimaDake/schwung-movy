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
    { componentKey: 'lfo',      label: 'LFO',     scanDir: '',                 expectedType: ''                },
    { componentKey: 'mix',      label: 'MIX',     scanDir: '',                 expectedType: ''                },
];

/* The two virtual chain slots (no module to scan or swap): the LFO page edits
 * the track's two schwung slot LFOs, and the MIX page edits movy's own summing
 * mixer — level, pan and the two send amounts.
 *
 * Both are addressed by an EXPLICIT index. `length - 1` was fine while the LFO
 * was last, but the moment a page was appended after it every `isLfoSlot()`
 * caller silently retargeted at the new page — including `persistableComponents`
 * and `buildTrackModels`, which is to say the two callers that decide which
 * slots hold a module at all. */
export const LFO_CHAIN_INDEX = 4;
export const MIX_CHAIN_INDEX = 5;
export function isLfoSlot(chainIndex: number): boolean { return chainIndex === LFO_CHAIN_INDEX; }
export function isMixSlot(chainIndex: number): boolean { return chainIndex === MIX_CHAIN_INDEX; }

export const MASTER_FX_SLOTS: ChainSlot[] = [
    { componentKey: 'master_fx:fx1', label: 'MFX 1', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'master_fx:fx2', label: 'MFX 2', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'master_fx:fx3', label: 'MFX 3', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    { componentKey: 'master_fx:fx4', label: 'MFX 4', scanDir: 'audio_fx', expectedType: 'audio_fx' },
    /* Virtual, exactly as the track chain's is: the shim's two master LFOs
     * (`master_fx:lfoN:*`), which can modulate any of the four FX above. */
    { componentKey: 'master_fx:lfo', label: 'LFO',   scanDir: '',         expectedType: ''         },
];

export const MASTER_LFO_INDEX = MASTER_FX_SLOTS.length - 1;
export function isMasterLfoSlot(i: number): boolean { return i === MASTER_LFO_INDEX; }

/* A slot with nothing to scan holds no module of its own — today that means the
 * LFO page, on either chain. Renderers ask this rather than comparing indices,
 * so one rule covers both chains. */
export function isVirtualSlot(slot: ChainSlot | undefined): boolean {
    return !!slot && slot.scanDir === '';
}

/* Whether a component belongs to the MASTER chain rather than to a track.
 *
 * A `master_fx:` key is schwung's own and global to the shim: it is not a
 * track's param and only rides on a slot number as a carrier. Anything that
 * turns a component key into a port has to ask this — see `componentPort`. */
export function isMasterComponent(componentKey: string): boolean {
    return componentKey.startsWith('master_fx');
}

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
