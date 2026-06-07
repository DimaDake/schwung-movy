import type { ModuleConfig } from '../types/param.js';

export const plaitsConfig: ModuleConfig = {
    id: 'plaits', name: 'Plaits',
    banks: [
        {
            name: 'OSC',
            rows: [
                [
                    { key: 'engine',    short: 'ENGI', full: 'Engine',    type: 'enum'  },
                    { key: 'harmonics', short: 'HARM', full: 'Harmonics', type: 'float' },
                    { key: 'timbre',    short: 'TIMB', full: 'Timbre',    type: 'float' },
                    { key: 'morph',     short: 'MRPH', full: 'Morph',     type: 'float' },
                ],
                [
                    { key: 'decay',      short: 'DCAY', full: 'Decay',     type: 'float' },
                    { key: 'lpg_colour', short: 'LPGC', full: 'LPG Color', type: 'float' },
                    { key: 'fm_amount',  short: 'FM',   full: 'FM Amount', type: 'float' },
                    { key: 'aux_mix',    short: 'MIX',  full: 'Aux Mix',   type: 'float' },
                ],
            ],
        },
        {
            name: 'MOD',
            rows: [
                [
                    { key: 'attack',               short: 'ATK',  full: 'Attack',     type: 'float' },
                    { key: 'timbre_mod',            short: 'TMOD', full: 'Timbre Mod', type: 'float' },
                    { key: 'morph_mod',             short: 'MMOD', full: 'Morph Mod',  type: 'float' },
                    { key: 'velocity_sensitivity',  short: 'VEL',  full: 'Vel Sens',   type: 'float' },
                ],
                [
                    { key: 'legato',           short: 'LGTO', full: 'Legato', type: 'enum' },
                    { key: 'octave_transpose',  short: 'OCT',  full: 'Octave', type: 'int'  },
                    null,
                    null,
                ],
            ],
        },
    ],
};
