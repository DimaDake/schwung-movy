/* browser-test/mock-synth.mjs — mock synth state for the browser harness
 * Each entry is a flat map keyed the same way shadow_get_param uses:
 *   "synth:name"          → display name
 *   "synth:ui_hierarchy"  → JSON string (parsed by model.mjs)
 *   "synth:<key>"         → current param value as string
 */

function hier(knobs) {
    return JSON.stringify({ levels: { root: { knobs } } });
}

function hierFull(knobs, params) {
    return JSON.stringify({ levels: { root: { knobs, params } } });
}

export const MOCK_SYNTHS = {

    test8: {
        "synth:name": "Test 8",
        "synth:ui_hierarchy": hier([
            { key: "freq",   label: "Freq",   type: "float", min: 0,   max: 1,   step: 0.01 },
            { key: "res",    label: "Reso",   type: "float", min: 0,   max: 1,   step: 0.01 },
            { key: "drive",  label: "Drive",  type: "float", min: 0,   max: 1,   step: 0.01 },
            { key: "vol",    label: "Vol",    type: "float", min: 0,   max: 1,   step: 0.01 },
            { key: "attack", label: "Atk",    type: "float", min: 0,   max: 1,   step: 0.01 },
            { key: "decay",  label: "Dcy",    type: "float", min: 0,   max: 1,   step: 0.01 },
            { key: "sustain","label": "Sus",  type: "float", min: 0,   max: 1,   step: 0.01 },
            { key: "release","label": "Rel",  type: "float", min: 0,   max: 1,   step: 0.01 },
        ]),
        "synth:freq":   "0.50",
        "synth:res":    "0.30",
        "synth:drive":  "0.10",
        "synth:vol":    "0.80",
        "synth:attack": "0.05",
        "synth:decay":  "0.40",
        "synth:sustain":"0.60",
        "synth:release":"0.30",
    },

    test16: {
        "synth:name": "Test 16",
        "synth:ui_hierarchy": hier([
            { key: "p1",  label: "P1",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p2",  label: "P2",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p3",  label: "P3",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p4",  label: "P4",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p5",  label: "P5",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p6",  label: "P6",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p7",  label: "P7",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p8",  label: "P8",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p9",  label: "P9",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p10", label: "P10",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p11", label: "P11",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p12", label: "P12",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p13", label: "P13",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p14", label: "P14",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p15", label: "P15",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "p16", label: "P16",  type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        ...Object.fromEntries(
            Array.from({ length: 16 }, (_, i) => [`synth:p${i + 1}`, `${(i / 15).toFixed(2)}`])
        ),
    },

    test_enum: {
        "synth:name": "Enums",
        "synth:ui_hierarchy": hier([
            { key: "mode",   label: "Mode",   type: "enum",  options: ["LP", "BP", "HP", "Notch"] },
            { key: "octave", label: "Oct",    type: "int",   min: -3, max: 3, step: 1 },
            { key: "wave",   label: "Wave",   type: "enum",  options: ["Sine", "Saw", "Sq", "Tri", "Nse"] },
            { key: "bits",   label: "Bits",   type: "int",   min: 1,  max: 16, step: 1 },
            { key: "cutoff", label: "Cut",    type: "float", min: 0,  max: 1,  step: 0.01 },
            { key: "res",    label: "Res",    type: "float", min: 0,  max: 1,  step: 0.01 },
            { key: "env",    label: "Env",    type: "float", min: -1, max: 1,  step: 0.01 },
            { key: "vel",    label: "Vel",    type: "float", min: 0,  max: 1,  step: 0.01 },
        ]),
        "synth:mode":   "0",
        "synth:octave": "0",
        "synth:wave":   "1",
        "synth:bits":   "16",
        "synth:cutoff": "0.70",
        "synth:res":    "0.20",
        "synth:env":    "0.30",
        "synth:vel":    "0.50",
    },

    plaits: {
        "synth:name":   "Plaits",
        "synth:module": "plaits",
        "synth:ui_hierarchy": hierFull(
            ["engine","harmonics","timbre","morph","decay","lpg_colour","fm_amount","aux_mix"],
            [
                { key: "engine",               label: "Engine",    type: "enum" },
                { key: "harmonics",            label: "Harmonics" },
                { key: "timbre",               label: "Timbre" },
                { key: "morph",                label: "Morph" },
                { key: "decay",                label: "Decay" },
                { key: "lpg_colour",           label: "LPG Color" },
                { key: "fm_amount",            label: "FM Amount" },
                { key: "aux_mix",              label: "Aux Mix" },
                { key: "attack",               label: "Attack" },
                { key: "timbre_mod",           label: "Timbre Mod" },
                { key: "morph_mod",            label: "Morph Mod" },
                { key: "legato",               label: "Legato",    type: "enum" },
                { key: "velocity_sensitivity", label: "Vel Sens" },
                { key: "octave_transpose",     label: "Octave" },
            ]
        ),
        "synth:chain_params": JSON.stringify([
            { key: "engine",    name: "Engine",    type: "enum",
              options: ["VA VCF","Phase Dist","6-Op I","6-Op II","6-Op III",
                        "Wave Terr","Str Mach","Chiptune","V. Analog","Waveshape",
                        "FM","Grain","Additive","Wavetable","Chord","Speech",
                        "Swarm","Noise","Particle","String","Modal",
                        "Bass Drum","Snare Drum","Hi-Hat"],
              default: "VA VCF", refreshes_labels: true },
            { key: "harmonics", name: "Harmonics", type: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
            { key: "timbre",    name: "Timbre",    type: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
            { key: "morph",     name: "Morph",     type: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
            { key: "decay",     name: "Decay",     type: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
            { key: "lpg_colour",name: "LPG Color", type: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
            { key: "fm_amount", name: "FM",        type: "float", min: 0, max: 1, step: 0.01, default: 0   },
            { key: "aux_mix",   name: "Mix",       type: "float", min: 0, max: 1, step: 0.01, default: 0   },
            { key: "attack",    name: "Attack",    type: "float", min: 0, max: 1, step: 0.01, default: 0   },
            { key: "timbre_mod",name: "Timbre Mod",type: "float", min: 0, max: 1, step: 0.01, default: 0   },
            { key: "morph_mod", name: "Morph Mod", type: "float", min: 0, max: 1, step: 0.01, default: 0   },
            { key: "legato",    name: "Legato",    type: "enum",  options: ["off","on"],        default: "off" },
            { key: "velocity_sensitivity", name: "Vel Sens", type: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
            { key: "octave_transpose",     name: "Octave",   type: "int",   min: -3, max: 3,             default: 0   },
        ]),
        "synth:engine":               "0",
        "synth:harmonics":            "0.5",
        "synth:timbre":               "0.5",
        "synth:morph":                "0.5",
        "synth:decay":                "0.5",
        "synth:lpg_colour":           "0.5",
        "synth:fm_amount":            "0.0",
        "synth:aux_mix":              "0.0",
        "synth:attack":               "0.0",
        "synth:timbre_mod":           "0.0",
        "synth:morph_mod":            "0.0",
        "synth:legato":               "0",
        "synth:velocity_sensitivity": "0.5",
        "synth:octave_transpose":     "0",
    },

    wurl: {
        "synth:name":   "Wurl",
        "synth:module": "wurl",
        "synth:ui_hierarchy": hierFull(
            ["volume","tremolo","attack","decay","brightness","darken","bark","reverb"],
            [
                { key: "volume",     label: "Volume" },
                { key: "tremolo",    label: "Tremolo" },
                { key: "attack",     label: "Attack" },
                { key: "decay",      label: "Decay" },
                { key: "brightness", label: "Brightness" },
                { key: "darken",     label: "Darken" },
                { key: "bark",       label: "Bark" },
                { key: "reverb",     label: "Reverb" },
                { key: "speaker",    label: "Speaker" },
                { key: "tune",       label: "Tune" },
            ]
        ),
        "synth:chain_params": JSON.stringify([
            { key: "volume",     name: "Volume",     type: "float", min: 0, max: 1, step: 0.01 },
            { key: "tremolo",    name: "Tremolo",    type: "float", min: 0, max: 1, step: 0.01 },
            { key: "attack",     name: "Attack",     type: "float", min: 0, max: 1, step: 0.01 },
            { key: "decay",      name: "Decay",      type: "float", min: 0, max: 1, step: 0.01 },
            { key: "brightness", name: "Bright",     type: "float", min: 0, max: 1, step: 0.01 },
            { key: "darken",     name: "Darken",     type: "float", min: 0, max: 1, step: 0.01 },
            { key: "bark",       name: "Bark",       type: "float", min: 0, max: 1, step: 0.01 },
            { key: "reverb",     name: "Reverb",     type: "float", min: 0, max: 1, step: 0.01 },
            { key: "speaker",    name: "Speaker",    type: "float", min: 0, max: 1, step: 0.01 },
            { key: "tune",       name: "Tune",       type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:volume":     "0.8",
        "synth:tremolo":    "0.0",
        "synth:attack":     "0.05",
        "synth:decay":      "0.6",
        "synth:brightness": "0.5",
        "synth:darken":     "0.3",
        "synth:bark":       "0.4",
        "synth:reverb":     "0.3",
        "synth:speaker":    "0.5",
        "synth:tune":       "0.5",
    },

    /* No synth loaded — model falls back to fallback test params */
    no_params: {
        "synth:name": null,
        "synth:ui_hierarchy": null,
        "synth:chain_params": null,
    },

    lfo_prefix: {
        "synth:name": "LFO Test",
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            knobs: ["lfo_rate","lfo_shape","lfo_offset","lfo_amount","osc_wave","osc_level","osc_tune","osc_pan"],
        }}}),
        "synth:chain_params": JSON.stringify([
            { key: "lfo_rate",   name: "LFO Rate",   type: "float", min: 0, max: 1 },
            { key: "lfo_shape",  name: "LFO Shape",  type: "float", min: 0, max: 1 },
            { key: "lfo_offset", name: "LFO Offset", type: "float", min: 0, max: 1 },
            { key: "lfo_amount", name: "LFO Amount", type: "float", min: 0, max: 1 },
            { key: "osc_wave",   name: "OSC Wave",   type: "float", min: 0, max: 1 },
            { key: "osc_level",  name: "OSC Level",  type: "float", min: 0, max: 1 },
            { key: "osc_tune",   name: "OSC Tune",   type: "float", min: 0, max: 1 },
            { key: "osc_pan",    name: "OSC Pan",    type: "float", min: 0, max: 1 },
        ]),
        "synth:lfo_rate":   "0.50",
        "synth:lfo_shape":  "0.30",
        "synth:lfo_offset": "0.70",
        "synth:lfo_amount": "0.40",
        "synth:osc_wave":   "0.60",
        "synth:osc_level":  "0.80",
        "synth:osc_tune":   "0.50",
        "synth:osc_pan":    "0.50",
    },

    obxd_like: {
        "synth:name":   "OB-Xd",
        "synth:ui_hierarchy": JSON.stringify({
            modes: null,
            levels: {
                root: {
                    list_param:  "preset",
                    count_param: "preset_count",
                    name_param:  "preset_name",
                    knobs: ["cutoff","resonance","filter_env","attack","decay","sustain","release","octave_transpose"],
                    params: [
                        { level: "global", label: "Global" },
                        { level: "filter", label: "Filter" },
                    ],
                },
                global: {
                    knobs:  ["volume","tune","portamento","unison"],
                    params: ["volume","tune","portamento","unison"],
                },
                filter: {
                    knobs:  ["cutoff","resonance","filter_env","key_follow"],
                    params: ["cutoff","resonance","filter_env","key_follow"],
                },
            },
        }),
        "synth:chain_params": JSON.stringify([
            { key: "preset",           name: "Preset",     type: "int",   min: 0,  max: 9999 },
            { key: "cutoff",           name: "Cutoff",     type: "float", min: 0,  max: 1 },
            { key: "resonance",        name: "Resonance",  type: "float", min: 0,  max: 1 },
            { key: "filter_env",       name: "Filter Env", type: "float", min: 0,  max: 1 },
            { key: "attack",           name: "Attack",     type: "float", min: 0,  max: 1 },
            { key: "decay",            name: "Decay",      type: "float", min: 0,  max: 1 },
            { key: "sustain",          name: "Sustain",    type: "float", min: 0,  max: 1 },
            { key: "release",          name: "Release",    type: "float", min: 0,  max: 1 },
            { key: "octave_transpose", name: "Octave",     type: "int",   min: -3, max: 3 },
            { key: "volume",           name: "Volume",     type: "float", min: 0,  max: 1 },
            { key: "tune",             name: "Tune",       type: "float", min: 0,  max: 1 },
            { key: "portamento",       name: "Portamento", type: "float", min: 0,  max: 1 },
            { key: "unison",           name: "Unison",     type: "int",   min: 0,  max: 1 },
            { key: "key_follow",       name: "Key Follow", type: "float", min: 0,  max: 1 },
        ]),
        "synth:preset_count":     "5",
        "synth:preset_name":      "Init",
        "synth:preset":           "0",
        "synth:cutoff":           "0.70",
        "synth:resonance":        "0.30",
        "synth:filter_env":       "0.50",
        "synth:attack":           "0.10",
        "synth:decay":            "0.50",
        "synth:sustain":          "0.70",
        "synth:release":          "0.30",
        "synth:octave_transpose": "0",
        "synth:volume":           "0.80",
        "synth:tune":             "0.50",
        "synth:portamento":       "0.00",
        "synth:unison":           "0",
        "synth:key_follow":       "0.50",
    },
};
