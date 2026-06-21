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

    /* Name-based enums (like the arp midi_fx): get/set speak the option NAME,
     * not the index. `division` has >6 options → opens the overlay. */
    name_enum: {
        "synth:name": "ArpLike",
        "synth:ui_hierarchy": hier([
            { key: "division", label: "Div",  type: "enum",
              options: ["1/4.", "1/4", "1/4T", "1/8.", "1/8", "1/8T", "1/16.", "1/16", "1/16T", "1/32"] },
            { key: "sync",     label: "Sync", type: "enum", options: ["internal", "clock"] },
        ]),
        "synth:division": "1/8",   // name string (index 4), not "4"
        "synth:sync":     "internal",
    },

    /* Index-based enum with >6 options (overlay) — the majority case; the value
     * is reported/accepted as a numeric index. Must keep working unchanged. */
    index_enum: {
        "synth:name": "IdxSynth",
        "synth:ui_hierarchy": hier([
            { key: "model", label: "Model", type: "enum",
              options: ["VA", "Phase", "Wave", "String", "VirtAn", "Shape", "FM", "Gran"] },
            { key: "cutoff", label: "Cut", type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:model":  "2",   // index string (→ "Wave"), not a name
        "synth:cutoff": "0.50",
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

    nav_levels: {
        "synth:name": "NavTest",
        "synth:ui_hierarchy": JSON.stringify({
            levels: {
                root: {
                    knobs: ["main_a", "main_b"],
                    params: [
                        { label: "Main", level: "main" },
                        { label: "Mod",  level: "mod"  },
                    ],
                },
                main: {
                    name: "Main",
                    knobs: ["main_a", "main_b", "main_c", "main_d"],
                },
                mod: {
                    name: "Mod",
                    params: [
                        { label: "Pitch", level: "pitch_mod" },
                        { label: "Filt",  level: "filt_mod"  },
                    ],
                },
                pitch_mod: {
                    name: "Pitch",
                    knobs: ["pm_lfo", "pm_env", "pm_vel"],
                },
                filt_mod: {
                    name: "Filter",
                    knobs: ["fm_lfo", "fm_env", "fm_vel"],
                },
            },
        }),
        "synth:chain_params": JSON.stringify([
            { key: "main_a", name: "Main A", type: "float", min: 0, max: 1 },
            { key: "main_b", name: "Main B", type: "float", min: 0, max: 1 },
            { key: "main_c", name: "Main C", type: "float", min: 0, max: 1 },
            { key: "main_d", name: "Main D", type: "float", min: 0, max: 1 },
            { key: "pm_lfo", name: "LFO",    type: "float", min: -1, max: 1 },
            { key: "pm_env", name: "Env",    type: "float", min: -1, max: 1 },
            { key: "pm_vel", name: "Vel",    type: "float", min: -1, max: 1 },
            { key: "fm_lfo", name: "LFO",    type: "float", min: -1, max: 1 },
            { key: "fm_env", name: "Env",    type: "float", min: -1, max: 1 },
            { key: "fm_vel", name: "Vel",    type: "float", min: -1, max: 1 },
        ]),
        "synth:main_a": "0.5", "synth:main_b": "0.5",
        "synth:main_c": "0.5", "synth:main_d": "0.5",
        "synth:pm_lfo": "0.0", "synth:pm_env": "0.0", "synth:pm_vel": "0.0",
        "synth:fm_lfo": "0.0", "synth:fm_env": "0.0", "synth:fm_vel": "0.0",
    },

    moog: {
        "synth:name":          "RaffoSynth",
        "synth:preset_count":  "14",
        "synth:ui_hierarchy":  JSON.stringify({ levels: {
            root: {
                children:    "main",
                list_param:  "preset",
                count_param: "preset_count",
                name_param:  "preset_name",
                knobs: ["cutoff","resonance","contour","key_follow","attack","decay","sustain","release"],
                params: [],
            },
            main: {
                params: [
                    { level: "osc1",        label: "Oscillator 1" },
                    { level: "osc2",        label: "Oscillator 2" },
                    { level: "osc3",        label: "Oscillator 3" },
                    { level: "osc4",        label: "Oscillator 4" },
                    { level: "mixer",       label: "Mixer"        },
                    { level: "filter",      label: "Filter"       },
                    { level: "filt_env",    label: "Filter Env"   },
                    { level: "amp_env",     label: "Amp Env"      },
                    { level: "lfo",         label: "LFO"          },
                    { level: "performance", label: "Performance"  },
                ],
            },
            osc1:        { knobs: ["osc1_wave","osc1_volume","osc1_range","noise"]       },
            osc2:        { knobs: ["osc2_wave","osc2_volume","osc2_range","osc2_detune"] },
            osc3:        { knobs: ["osc3_wave","osc3_volume","osc3_range","osc3_detune"] },
            osc4:        { knobs: ["osc4_wave","osc4_volume","osc4_range","osc4_detune"] },
            mixer:       { knobs: ["glide","volume"]                                     },
            filter:      { knobs: ["cutoff","resonance","contour","key_follow"]          },
            filt_env:    { knobs: ["f_attack","f_decay","f_sustain","f_release"]         },
            amp_env:     { knobs: ["attack","decay","sustain","release"]                 },
            lfo:         { knobs: ["lfo_rate","lfo_pitch","lfo_filter","mod_filter"]     },
            performance: { knobs: ["mod_pitch","bend_range","vel_sens"]                  },
        }}),
        "synth:chain_params": JSON.stringify([
            { key: "osc1_wave",   name: "Osc1 Wave",   type: "int",   min: 0,  max: 3  },
            { key: "osc1_volume", name: "Osc1 Volume", type: "float", min: 0,  max: 1  },
            { key: "osc1_range",  name: "Osc1 Range",  type: "int",   min: -2, max: 2  },
            { key: "osc2_wave",   name: "Osc2 Wave",   type: "int",   min: 0,  max: 3  },
            { key: "osc2_volume", name: "Osc2 Volume", type: "float", min: 0,  max: 1  },
            { key: "osc2_range",  name: "Osc2 Range",  type: "int",   min: -2, max: 2  },
            { key: "osc2_detune", name: "Osc2 Detune", type: "float", min: 0,  max: 1  },
            { key: "osc3_wave",   name: "Osc3 Wave",   type: "int",   min: 0,  max: 3  },
            { key: "osc3_volume", name: "Osc3 Volume", type: "float", min: 0,  max: 1  },
            { key: "osc3_range",  name: "Osc3 Range",  type: "int",   min: -2, max: 2  },
            { key: "osc3_detune", name: "Osc3 Detune", type: "float", min: 0,  max: 1  },
            { key: "osc4_wave",   name: "Osc4 Wave",   type: "int",   min: 0,  max: 3  },
            { key: "osc4_volume", name: "Osc4 Volume", type: "float", min: 0,  max: 1  },
            { key: "osc4_range",  name: "Osc4 Range",  type: "int",   min: -2, max: 2  },
            { key: "osc4_detune", name: "Osc4 Detune", type: "float", min: 0,  max: 1  },
            { key: "noise",       name: "Noise",       type: "float", min: 0,  max: 1  },
            { key: "cutoff",      name: "Cutoff",      type: "float", min: 0,  max: 1  },
            { key: "resonance",   name: "Resonance",   type: "float", min: 0,  max: 1  },
            { key: "contour",     name: "Contour",     type: "float", min: 0,  max: 1  },
            { key: "key_follow",  name: "Key Follow",  type: "float", min: 0,  max: 1  },
            { key: "attack",      name: "Attack",      type: "float", min: 0,  max: 1  },
            { key: "decay",       name: "Decay",       type: "float", min: 0,  max: 1  },
            { key: "sustain",     name: "Sustain",     type: "float", min: 0,  max: 1  },
            { key: "release",     name: "Release",     type: "float", min: 0,  max: 1  },
            { key: "f_attack",    name: "F Attack",    type: "float", min: 0,  max: 1  },
            { key: "f_decay",     name: "F Decay",     type: "float", min: 0,  max: 1  },
            { key: "f_sustain",   name: "F Sustain",   type: "float", min: 0,  max: 1  },
            { key: "f_release",   name: "F Release",   type: "float", min: 0,  max: 1  },
            { key: "glide",       name: "Glide",       type: "float", min: 0,  max: 1  },
            { key: "volume",      name: "Volume",      type: "float", min: 0,  max: 1  },
            { key: "lfo_rate",    name: "LFO Rate",    type: "float", min: 0,  max: 1  },
            { key: "lfo_pitch",   name: "LFO>Pitch",   type: "float", min: 0,  max: 1  },
            { key: "lfo_filter",  name: "LFO>Filter",  type: "float", min: 0,  max: 1  },
            { key: "mod_filter",  name: "Mod>Filter",  type: "float", min: 0,  max: 1  },
            { key: "mod_pitch",   name: "Mod>Pitch",   type: "float", min: 0,  max: 1  },
            { key: "bend_range",  name: "Bend Range",  type: "float", min: 0,  max: 1  },
            { key: "vel_sens",    name: "Vel Sens",    type: "float", min: 0,  max: 1  },
        ]),
        ...Object.fromEntries([
            "osc1_wave","osc1_volume","osc1_range","osc2_wave","osc2_volume","osc2_range",
            "osc2_detune","osc3_wave","osc3_volume","osc3_range","osc3_detune","osc4_wave",
            "osc4_volume","osc4_range","osc4_detune","noise","cutoff","resonance","contour",
            "key_follow","attack","decay","sustain","release","f_attack","f_decay","f_sustain",
            "f_release","glide","volume","lfo_rate","lfo_pitch","lfo_filter","mod_filter",
            "mod_pitch","bend_range","vel_sens",
        ].map(k => [`synth:${k}`, "0.5"])),
    },

    /* Granny-style: filepath in chain_params but NOT in any level's knobs array */
    granny_like: {
        "synth:name": "GrannyTest",
        "synth:chain_params": JSON.stringify([
            { key: "sample_path", name: "Sample File", type: "filepath",
              root: "/data/UserData/UserLibrary/Samples", filter: ".wav" },
            { key: "position", name: "Position", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "size_ms",  name: "Size",     type: "float", min: 5, max: 500, step: 0.5  },
        ]),
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            knobs: ["position", "size_ms"],
        }}}),
        "synth:sample_path": "/data/UserData/UserLibrary/Samples/loop.wav",
        "synth:position":    "0.2",
        "synth:size_ms":     "100",
    },

    file_param: {
        "synth:name": "SamplerTest",
        "synth:chain_params": JSON.stringify([
            { key: "sample", name: "Sample", type: "filepath",
              root: "/data/UserData/Samples", filter: [".wav"],
              start_path: "/data/UserData/Samples" },
            { key: "vol", name: "Volume", type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            knobs: ["sample", "vol"],
        }}}),
        "synth:sample": "/data/UserData/Samples/kick.wav",
        "synth:vol":    "0.8",
    },

    mrdrums: {
        "synth:name":             "MrDrums",
        "synth_module":           "mrdrums",
        "synth:ui_current_pad":   "5",
        "synth:pad_vol":          "0.80",
        "synth:pad_pan":          "0.00",
        "synth:pad_tune":         "0.00",
        "synth:pad_start":        "0.00",
        "synth:pad_attack_ms":    "0.00",
        "synth:pad_decay_ms":     "250.0",
        "synth:pad_mode":         "0",
        "synth:g_master_vol":     "1.0",
        "synth:g_polyphony":      "16",
        /* Concrete per-pad keys movy addresses directly (focused-pad scoping). */
        "synth:p01_vol":          "0.10",
        "synth:p02_vol":          "0.20",
        "synth:p05_vol":          "0.50",
    },

    /* Weird Dreams: 8-voice machine. cv_* is the "current voice" alias; every
     * voice param has a concrete v<N>_* key (1-indexed, no padding). */
    weird_dreams: {
        "synth:name":        "Weird Dreams",
        "synth_module":      "weird-dreams",
        "synth:cv_vol":      "0.90",
        "synth:cv_pan":      "0.00",
        "synth:cv_freq":     "440",
        "synth:cv_decay":    "0.50",
        "synth:v1_vol":      "0.11",
        "synth:v1_pan":      "0.00",
        "synth:v3_vol":      "0.33",
        "synth:v3_pan":      "-0.50",
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
