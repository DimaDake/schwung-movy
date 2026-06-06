/* modules/index.mjs — per-synth knob layout configs
 *
 * loadModuleConfig(moduleId) returns a config object or null.
 * Priority:
 *   1. <sound_generators_dir>/<moduleId>/movy_config.json  (synth ships its own)
 *   2. Bundled CONFIGS[moduleId]                           (movy built-in)
 *   3. null → model falls back to auto-layout from ui_hierarchy
 */

const MOVY_SG_ROOT = '/data/UserData/schwung/modules/sound_generators';

function tryFile(path) {
    if (typeof host_read_file !== 'function') return null;
    try {
        const s = host_read_file(path);
        if (s) return JSON.parse(s);
    } catch {}
    return null;
}

/* ── Bundled configs ────────────────────────────────────────────────────── */

const CONFIGS = {

    plaits: {
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
                        { key: 'decay',     short: 'DCAY', full: 'Decay',     type: 'float' },
                        { key: 'lpg_colour',short: 'LPGC', full: 'LPG Color', type: 'float' },
                        { key: 'fm_amount', short: 'FM',   full: 'FM Amount', type: 'float' },
                        { key: 'aux_mix',   short: 'MIX',  full: 'Aux Mix',   type: 'float' },
                    ],
                ],
            },
            {
                name: 'MOD',
                rows: [
                    [
                        { key: 'attack',               short: 'ATK',  full: 'Attack',     type: 'float' },
                        { key: 'timbre_mod',           short: 'TMOD', full: 'Timbre Mod', type: 'float' },
                        { key: 'morph_mod',            short: 'MMOD', full: 'Morph Mod',  type: 'float' },
                        { key: 'velocity_sensitivity', short: 'VEL',  full: 'Vel Sens',   type: 'float' },
                    ],
                    [
                        { key: 'legato',           short: 'LGTO', full: 'Legato', type: 'enum' },
                        { key: 'octave_transpose', short: 'OCT',  full: 'Octave', type: 'int'  },
                        null,
                        null,
                    ],
                ],
            },
        ],
    },

    wurl: {
        id: 'wurl', name: 'Wurl',
        banks: [
            {
                name: 'WURL',
                rows: [
                    [
                        { key: 'volume',     short: 'VOL',  full: 'Volume',     type: 'float' },
                        { key: 'tremolo',    short: 'TREM', full: 'Tremolo',    type: 'float' },
                        { key: 'attack',     short: 'ATK',  full: 'Attack',     type: 'float' },
                        { key: 'decay',      short: 'DCY',  full: 'Decay',      type: 'float' },
                    ],
                    [
                        { key: 'brightness', short: 'BGHT', full: 'Brightness', type: 'float' },
                        { key: 'darken',     short: 'DARK', full: 'Darken',     type: 'float' },
                        { key: 'bark',       short: 'BARK', full: 'Bark',       type: 'float' },
                        { key: 'reverb',     short: 'REVB', full: 'Reverb',     type: 'float' },
                    ],
                ],
            },
            {
                name: 'FX',
                rows: [
                    [
                        { key: 'speaker', short: 'SPKR', full: 'Speaker', type: 'float' },
                        { key: 'tune',    short: 'TUNE', full: 'Tune',    type: 'float' },
                        null,
                        null,
                    ],
                    [null, null, null, null],
                ],
            },
        ],
    },

};

/* ── Public API ─────────────────────────────────────────────────────────── */

export function loadModuleConfig(moduleId) {
    if (!moduleId) return null;
    return tryFile(`${MOVY_SG_ROOT}/${moduleId}/movy_config.json`)
        ?? CONFIGS[moduleId]
        ?? null;
}
