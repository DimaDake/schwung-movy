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

    env_dual: {
        "synth:name": "Dual Env",
        "synth:ui_hierarchy": hier([
            { key: "attack",   label: "Attack",   type: "float", min: 0, max: 1, step: 0.01 },
            { key: "decay",    label: "Decay",    type: "float", min: 0, max: 1, step: 0.01 },
            { key: "sustain","label": "Sustain",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "release","label": "Release",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_attack", label: "F Attack", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_decay",  label: "F Decay",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_sustain","label": "F Sustain", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "f_release","label": "F Release", type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:attack": "0.10",  "synth:decay": "0.35", "synth:sustain": "0.70", "synth:release": "0.45",
        "synth:f_attack": "0.40","synth:f_decay": "0.25","synth:f_sustain": "0.30","synth:f_release": "0.20",
    },

    // A2 partial envelopes: 2-stage AD (attack+decay) beside two plain knobs.
    env_ad: {
        "synth:name": "AD Env",
        "synth:ui_hierarchy": hier([
            { key: "attack", label: "Attack", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "decay",  label: "Decay",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "cutoff", label: "Cutoff", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "reso",   label: "Reso",   type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:attack": "0.20", "synth:decay": "0.50", "synth:cutoff": "0.60", "synth:reso": "0.30",
    },
    // A3 module-LFO viz: name-inferred, no explicit lfo: tags. No phase, so the
    // partner is Rate — the layout reorders Shape+Rate onto one line and the
    // rate value drives the cycle count (~1.5 here); Deform skews the shape.
    lfo_mod: {
        "synth:name": "Mod LFO",
        "synth:ui_hierarchy": hier([
            { key: "lfo_shape", label: "LFO Shape", type: "enum",
              options: ["Sine", "Triangle", "Saw", "Square", "Ramp Down", "Noise", "Step Sequencer", "Wavetable 1"] },
            { key: "lfo_rate",   label: "LFO Rate",   type: "float", min: 0,  max: 1, step: 0.01 },
            { key: "lfo_deform", label: "LFO Deform", type: "float", min: -1, max: 1, step: 0.01 },
            { key: "lfo_depth",  label: "LFO Depth",  type: "float", min: 0,  max: 1, step: 0.01 },
            { key: "cutoff",     label: "Cutoff",     type: "float", min: 0,  max: 1, step: 0.01 },
            { key: "reso",       label: "Reso",       type: "float", min: 0,  max: 1, step: 0.01 },
        ]),
        "synth:lfo_shape": "4",   // Ramp Down → shape id 6 (saw down)
        "synth:lfo_rate": "0.50", "synth:lfo_deform": "0.70", "synth:lfo_depth": "0.80",
        "synth:cutoff": "0.60", "synth:reso": "0.30",
    },

    // A1 filter-response viz: cutoff+resonance drawn as a curve; a same-page MODE
    // enum morphs the shape and SLOPE picks 12/24 dB. The scene overrides
    // synth:mode / synth:resonance / synth:slope per shot before rendering.
    filter_demo: {
        "synth:name": "Filter",
        "synth:ui_hierarchy": hier([
            { key: "cutoff",    label: "Cutoff",    type: "float", min: 0, max: 1, step: 0.01 },
            { key: "resonance", label: "Resonance", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "drive",     label: "Drive",     type: "float", min: 0, max: 1, step: 0.01 },
            { key: "mix",       label: "Mix",       type: "float", min: 0, max: 1, step: 0.01 },
            { key: "mode",      label: "Mode",      type: "enum",  options: ["LP", "HP", "BP", "Notch", "Peak", "AP"] },
            { key: "slope",     label: "Slope",     type: "enum",  options: ["12 dB", "24 dB"] },
        ]),
        "synth:cutoff": "0.55", "synth:resonance": "0.30", "synth:drive": "0.20",
        "synth:mix": "1.00", "synth:mode": "0", "synth:slope": "0",
    },
    // A1 two curves on one page (aphex-like): lpf_cut/lpf_reso → LP on one line,
    // hpf_cut/hpf_reso → HP on the other, both inferred from name tokens.
    filter_dual: {
        "synth:name": "Aphex",
        "synth:ui_hierarchy": hier([
            { key: "lpf_cut",  label: "LPF Cut",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "lpf_reso", label: "LPF Peak", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "hpf_cut",  label: "HPF Cut",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "hpf_reso", label: "HPF Peak", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "mg_freq",  label: "MG Freq",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "depth",    label: "Depth",    type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:lpf_cut": "0.65", "synth:lpf_reso": "0.55", "synth:hpf_cut": "0.35",
        "synth:hpf_reso": "0.45", "synth:mg_freq": "0.50", "synth:depth": "0.40",
    },

    // A2 partial envelopes: 3-stage ASR (attack + sustain plateau + release).
    env_asr: {
        "synth:name": "ASR Env",
        "synth:ui_hierarchy": hier([
            { key: "attack",  label: "Attack",  type: "float", min: 0, max: 1, step: 0.01 },
            { key: "sustain", label: "Sustain", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "release", label: "Release", type: "float", min: 0, max: 1, step: 0.01 },
            { key: "tone",    label: "Tone",    type: "float", min: 0, max: 1, step: 0.01 },
        ]),
        "synth:attack": "0.25", "synth:sustain": "0.65", "synth:release": "0.40", "synth:tone": "0.50",
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
        "synth:eq_lo":       "3.0",
        "synth:master":      "0.80",
    },

    // Chunk 7 B2: 4-voice pad-scoped synth (cv_ alias → v{pad}_ concrete).
    signal: {
        "synth:name":        "Signal",
        "synth_module":      "signal",
        "synth:v1_vol":      "0.11", "synth:v1_attack": "0.02",
        "synth:v3_vol":      "0.33", "synth:v3_attack": "0.04",
        "synth:patch":       "2",
    },

    // Chunk 7 B2: 16-pad Kit A/B synth. Per-voice editing is playback-safe via
    // padScoping cv_* → pv{pad}_ concrete keys (patched Forge DSP): pv1-8 = Kit A
    // voices, pv9-16 = Kit B. Mix bank uses concrete v<N>_lvl.
    forge: {
        "synth:name":        "Forge",
        "synth_module":      "forge",
        "synth:pv1_wave":    "1",   "synth:pv1_f1_cut": "0.30",
        "synth:pv3_wave":    "2",   "synth:pv11_wave":  "3",
        "synth:v1_lvl":      "0.70", "synth:v5_lvl":    "0.50",
        "synth:kit":         "4",
    },

    /* libpo32: 16-voice PO-32/Microtonic drum synth. Per-voice editing is
     * PLAYBACK-SAFE via padScoping v_ → v{pad}_ (padDigits 2 for voices 1-16),
     * addressing the patched DSP's direct per-index keys. Layout loads from the
     * module's movy_config.json (served by the test). */
    libpo32: {
        "synth:name":        "Libpo32",
        "synth_module":      "po32-drum",
        "synth:v01_wave":    "1",    "synth:v01_freq":  "0.25",
        "synth:v03_freq":    "0.33", "synth:v16_freq":  "0.50",
        "synth:v01_nfmode":  "1",    "synth:v01_nffrq": "0.60",
        "synth:kit":         "2",    "synth:level":     "1.0",  "synth:decay": "1.0",
    },

    /* C1: root has ≥8 knobs AND the preset key is also listed inside root.knobs.
     * loadHierarchy adds a dedicated "Preset" page (presetSeparate) — the preset
     * key must NOT also render on "Main - 1". Mirrors impressive-chords/breakbeat. */
    preset_dup: {
        "synth:name":         "PresetDup",
        "synth:preset_count": "4",
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            list_param:  "preset",
            count_param: "preset_count",
            name_param:  "preset_name",
            knobs: ["preset","base_note","transpose","invert","strum","tilt","length","choke"],
        }}}),
        "synth:chain_params": JSON.stringify([
            { key: "base_note", name: "Base",   type: "int", min: 0, max: 127 },
            { key: "transpose", name: "Trans",  type: "int", min: -24, max: 24 },
            { key: "invert",    name: "Invert", type: "int", min: 0, max: 4 },
            { key: "strum",     name: "Strum",  type: "float", min: 0, max: 1 },
            { key: "tilt",      name: "Tilt",   type: "float", min: 0, max: 1 },
            { key: "length",    name: "Length", type: "float", min: 0, max: 1 },
            { key: "choke",     name: "Choke",  type: "int", min: 0, max: 1 },
        ]),
        "synth:preset":     "0",
        "synth:base_note":  "60",
        "synth:transpose":  "0",
        "synth:invert":     "0",
        "synth:strum":      "0.0",
        "synth:tilt":       "0.5",
        "synth:length":     "0.5",
        "synth:choke":      "0",
    },

    /* B1: publishes chain_params but NO ui_hierarchy. Generic path must build
     * pages straight from chain_params order. Mirrors branchage/smack-in/belt-in.
     * Mixed float/enum/filepath + a ui_* internal key that must be skipped. */
    chainparams_only: {
        "synth:name": "ChainOnly",
        "synth:chain_params": JSON.stringify([
            { key: "map_x",   name: "Map X",  type: "float", min: 0, max: 1 },
            { key: "map_y",   name: "Map Y",  type: "float", min: 0, max: 1 },
            { key: "density", name: "Dens",   type: "float", min: 0, max: 1 },
            { key: "mode",    name: "Mode",   type: "enum",  options: ["A","B","C"] },
            { key: "sample",  name: "Sample", type: "filepath",
              root: "/data/UserData/Samples", filter: [".wav"], start_path: "/data/UserData/Samples" },
            { key: "gain",    name: "Gain",   type: "float", min: 0, max: 2 },
            { key: "spread",  name: "Spread", type: "int",   min: -12, max: 12 },
            { key: "chaos",   name: "Chaos",  type: "float", min: 0, max: 1 },
            { key: "swing",   name: "Swing",  type: "float", min: 0, max: 1 },
            { key: "ui_page", name: "UIPage", type: "int",   min: 0, max: 3 },
        ]),
        "synth:map_x":   "0.5",
        "synth:map_y":   "0.5",
        "synth:density": "0.5",
        "synth:mode":    "1",
        "synth:sample":  "/data/UserData/Samples/kick.wav",
        "synth:gain":    "1.0",
        "synth:spread":  "0",
        "synth:chaos":   "0.0",
        "synth:swing":   "0.0",
        "synth:ui_page": "0",
    },

    /* C4: params with NO chain_params entry and NO hierarchy metadata → movy
     * guesses float 0..1. An integer-valued read (base_note=60, transpose=-24)
     * should infer int type + widened range on first read. */
    guessed_meta: {
        "synth:name": "GuessedMeta",
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            knobs: ["base_note","transpose","depth","plugin_index"],
        }}}),
        "synth:base_note":    "60",
        "synth:transpose":    "-24",
        "synth:depth":        "0.5",
        "synth:plugin_index": "3",
    },

    /* C2: a page whose knob labels collide after 5-char shortening. "Wave 1..4"
     * and "Shape 1..4" both used to render as bare digits (1 2 3 4 twice). */
    collide_osc: {
        "synth:name": "CollideOsc",
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            knobs: ["wave1","wave2","wave3","wave4","shape1","shape2","shape3","shape4"],
        }}}),
        "synth:chain_params": JSON.stringify([
            { key: "wave1",  name: "Wave 1",  type: "float", min: 0, max: 1 },
            { key: "wave2",  name: "Wave 2",  type: "float", min: 0, max: 1 },
            { key: "wave3",  name: "Wave 3",  type: "float", min: 0, max: 1 },
            { key: "wave4",  name: "Wave 4",  type: "float", min: 0, max: 1 },
            { key: "shape1", name: "Shape 1", type: "float", min: 0, max: 1 },
            { key: "shape2", name: "Shape 2", type: "float", min: 0, max: 1 },
            { key: "shape3", name: "Shape 3", type: "float", min: 0, max: 1 },
            { key: "shape4", name: "Shape 4", type: "float", min: 0, max: 1 },
        ]),
        ...Object.fromEntries(["wave1","wave2","wave3","wave4","shape1","shape2","shape3","shape4"]
            .map(k => [`synth:${k}`, "0.50"])),
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
    "chordism": {
        "synth:name":       "Chordism",
        "synth_module":     "chordism",
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            list_param: "preset", count_param: "preset_count", name_param: "preset_name", knobs: [], params: [],
        } } }),
        "synth:preset_count": "57",
        "synth:preset_names": JSON.stringify(["P0", "P1", "P2", "P3", "..."]),
        "synth:chain_params": JSON.stringify([{"key": "chord_type", "name": "Chord", "type": "enum", "options": ["Octaves", "Fifth", "Minor", "Min 7", "Min 9", "Min 11", "Major", "Maj 7", "Maj 9", "Sus 4", "6/9", "Min 6", "10th", "Dom 7", "Dom 7 b9", "Half Dim"]}, {"key": "detune", "name": "Detune", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "width", "name": "Width", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_cutoff", "name": "Cutoff", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_resonance", "name": "Reso", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_mode", "name": "Mode", "type": "enum", "options": ["LP", "HP", "BP"]}, {"key": "filter_slope", "name": "Slope", "type": "enum", "options": ["12 dB", "24 dB"]}, {"key": "filter_lfo_rate", "name": "Flt LFO Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_lfo_depth", "name": "Flt LFO Depth", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_lfo_spread", "name": "Flt LFO Spread", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_lfo_shape", "name": "Flt LFO Wave", "type": "enum", "options": ["Triangle", "Ramp Up", "Ramp Down", "Square"]}, {"key": "filter_env_attack", "name": "Env A", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_env_decay", "name": "Env D", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "filter_env_depth", "name": "Env Amt", "type": "float", "min": -1, "max": 1, "step": 0.02}, {"key": "drive", "name": "Drive", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "volume", "name": "Volume", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "wave_1", "name": "Wave 1", "type": "enum", "options": ["Off", "Sine", "Triangle", "Saw", "Square", "Pulse Tr", "Wavetable"]}, {"key": "wave_2", "name": "Wave 2", "type": "enum", "options": ["Off", "Sine", "Triangle", "Saw", "Square", "Pulse Tr", "Wavetable"]}, {"key": "wave_3", "name": "Wave 3", "type": "enum", "options": ["Off", "Sine", "Triangle", "Saw", "Square", "Pulse Tr", "Wavetable"]}, {"key": "wave_4", "name": "Wave 4", "type": "enum", "options": ["Off", "Sine", "Triangle", "Saw", "Square", "Pulse Tr", "Wavetable"]}, {"key": "shape", "name": "Shape", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "shape_1", "name": "Shape 1", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "shape_2", "name": "Shape 2", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "shape_3", "name": "Shape 3", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "shape_4", "name": "Shape 4", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "morph_index", "name": "Morph", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "morph_intensity", "name": "Morph Int", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "pan_morph_index", "name": "Pan Morph", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "pan_morph_intensity", "name": "Pan Int", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "chord_spread", "name": "Spread", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "chord_rotation", "name": "Rotation", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "fm_modulator", "name": "FM Modulator", "type": "int", "min": 0, "max": 3, "step": 1}, {"key": "fm_amount", "name": "FM Amt", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lfo_shape", "name": "LFO Wave", "type": "enum", "options": ["Triangle", "Ramp Up", "Ramp Down", "Square"]}, {"key": "lfo_rate", "name": "LFO Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lfo_depth", "name": "LFO Dpt", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "vib_depth", "name": "Vib Depth", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "vib_speed", "name": "Vib Speed", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "vib_delay", "name": "Vib Delay", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "sweep_amount", "name": "Sweep", "type": "float", "min": -1, "max": 1, "step": 0.02}, {"key": "sweep_rate", "name": "Sweep Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "attack", "name": "Attack", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "release", "name": "Release", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_mix", "name": "Reverb Mix", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_decay", "name": "Reverb Decay", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_damp", "name": "Reverb Damp", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "grind", "name": "Grind", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "bit_shift", "name": "Shift", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "decimator", "name": "Decim", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "delay_mix", "name": "Delay Mix", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "delay_time", "name": "Delay Time", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "delay_feedback", "name": "Delay Feedback", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "delay_tone", "name": "Delay Tone", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "glide_rate", "name": "Glide", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "glide_legato", "name": "Glide Legato", "type": "enum", "options": ["Always", "Legato"]}, {"key": "vib_stray", "name": "Vibrato Stray", "type": "enum", "options": ["LFO", "Random"]}, {"key": "delay_mode", "name": "Delay Mode", "type": "enum", "options": ["Stereo", "Ping-Pong", "Flip-Flop", "Long", "Zenith", "Interval"]}, {"key": "delay_tone_hi", "name": "Delay Tone Hi", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "delay_tone_lo", "name": "Delay Tone Lo", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "delay_mod_rate", "name": "Delay Mod Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "delay_mod_depth", "name": "Delay Mod Depth", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_shimmer", "name": "Reverb Shimmer", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_lowcut", "name": "Reverb Low Cut", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_size", "name": "Reverb Size", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_mod_rate", "name": "Reverb Mod Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "reverb_mod_depth", "name": "Reverb Mod Depth", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lm_lfo_rate", "name": "Lvl Morph LFO Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lm_lfo_depth", "name": "Lvl Morph LFO Depth", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lm_lfo_shape", "name": "Lvl Morph LFO Wave", "type": "enum", "options": ["Triangle", "Ramp Up", "Ramp Down", "Square"]}, {"key": "pm_lfo_rate", "name": "Pan Morph LFO Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "pm_lfo_depth", "name": "Pan Morph LFO Depth", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "pm_lfo_shape", "name": "Pan Morph LFO Wave", "type": "enum", "options": ["Triangle", "Ramp Up", "Ramp Down", "Square"]}, {"key": "amp_lfo_rate", "name": "Tremolo Rate", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "amp_lfo_depth", "name": "Tremolo Depth", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "amp_lfo_shape", "name": "Tremolo Wave", "type": "enum", "options": ["Triangle", "Ramp Up", "Ramp Down", "Square"]}, {"key": "vca_mode", "name": "VCA Mode", "type": "enum", "options": ["AD", "ASR", "Looping"]}, {"key": "vca_hard_reset", "name": "VCA Hard Reset", "type": "enum", "options": ["Off", "On"]}, {"key": "vca_drone", "name": "Drone", "type": "enum", "options": ["Off", "On"]}, {"key": "fenv_mode", "name": "Flt Env Mode", "type": "enum", "options": ["AD", "ASR", "Looping"]}, {"key": "fenv_hard_reset", "name": "Flt Env Hard Reset", "type": "enum", "options": ["Off", "On"]}, {"key": "quality_position", "name": "LoFi Position", "type": "enum", "options": ["Post-Flt", "Pre-Flt"]}, {"key": "fm_amount_1", "name": "FM Amount 1", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "fm_amount_2", "name": "FM Amount 2", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "fm_amount_3", "name": "FM Amount 3", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "fm_amount_4", "name": "FM Amount 4", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "mix_1", "name": "Mix 1", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "mix_2", "name": "Mix 2", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "mix_3", "name": "Mix 3", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "mix_4", "name": "Mix 4", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "vib_osc_enable", "name": "Vib Osc Enable", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "sweep_osc_enable", "name": "Sweep Osc Enable", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "shape_lfo_mode", "name": "LFO Mode", "type": "enum", "options": ["Free", "Note Reset", "One Shot"]}, {"key": "filter_lfo_mode", "name": "Flt LFO Mode", "type": "enum", "options": ["Free", "Note Reset", "One Shot"]}, {"key": "lm_lfo_mode", "name": "Lvl Morph LFO Mode", "type": "enum", "options": ["Free", "Note Reset", "One Shot"]}, {"key": "pm_lfo_mode", "name": "Pan Morph LFO Mode", "type": "enum", "options": ["Free", "Note Reset", "One Shot"]}, {"key": "fm_position", "name": "FM Position", "type": "enum", "options": ["Pre-Morph", "Post-Morph"]}, {"key": "arp_hold", "name": "Arp Hold", "type": "enum", "options": ["Off", "On"]}, {"key": "arp_euclid_steps", "name": "Euclid Steps", "type": "int", "min": 1, "max": 16, "step": 1}, {"key": "arp_euclid_beats", "name": "Euclid Beats", "type": "int", "min": 0, "max": 16, "step": 1}, {"key": "arp_variation_interval", "name": "Var Interval", "type": "int", "min": -12, "max": 12, "step": 1}, {"key": "arp_variations", "name": "Var Count", "type": "int", "min": 1, "max": 8, "step": 1}, {"key": "arp_clock_sync", "name": "Clock Sync", "type": "enum", "options": ["Internal", "MIDI Clk"]}, {"key": "arp_clock_division", "name": "Clock Division", "type": "enum", "options": ["1/4", "1/4T", "1/8", "1/8T", "1/16", "1/32"]}, {"key": "scale_index", "name": "Scale", "type": "enum", "options": ["Chromatic", "Major", "Minor", "Harm Min", "Pent Maj", "Pent Min", "Diminished", "Dorian", "Phrygian", "Lydian", "Mixolyd", "Locrian", "Blues Maj", "Blues Min", "Arabic", "Arabic2", "Hijaz", "Iwato", "Pelog", "Slendro", "Folk", "Japanese", "Gypsy", "Flamenco", "Whole Tone"]}, {"key": "scale_root", "name": "Scale Root", "type": "enum", "options": ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]}, {"key": "tuning_mode", "name": "Tuning", "type": "enum", "options": ["Chord", "Interval", "Chord Multi"]}, {"key": "chord_pc_0", "name": "C", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_1", "name": "C#", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_2", "name": "D", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_3", "name": "D#", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_4", "name": "E", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_5", "name": "F", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_6", "name": "F#", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_7", "name": "G", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_8", "name": "G#", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_9", "name": "A", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_10", "name": "A#", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "chord_pc_11", "name": "B", "type": "enum", "options": ["Oct", "5th", "Min", "Min7", "Min9", "Min11", "Maj", "Maj7", "Maj9", "Sus4", "6/9", "Min6", "10", "Dom7", "Dom7b9", "HalfDim"]}, {"key": "interval_1", "name": "Interval 1", "type": "int", "min": -24, "max": 24, "step": 1}, {"key": "interval_2", "name": "Interval 2", "type": "int", "min": -24, "max": 24, "step": 1}, {"key": "interval_3", "name": "Interval 3", "type": "int", "min": -24, "max": 24, "step": 1}, {"key": "lfo_phase_1", "name": "Shape LFO Phase 1", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lfo_phase_2", "name": "Shape LFO Phase 2", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lfo_phase_3", "name": "Shape LFO Phase 3", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "lfo_phase_4", "name": "Shape LFO Phase 4", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "ctrl_source", "name": "Ctrl Src", "type": "enum", "options": ["Aftertouch", "Random", "Coin Toss", "MIDI CC", "Velocity"]}, {"key": "ctrl_cc", "name": "Ctrl CC", "type": "int", "min": 0, "max": 127, "step": 1}, {"key": "ctrl_to_cutoff", "name": "Ctrl to Cutoff", "type": "float", "min": -1, "max": 1, "step": 0.02}, {"key": "ctrl_to_morph", "name": "Ctrl to Morph", "type": "float", "min": -1, "max": 1, "step": 0.02}, {"key": "ctrl_to_vib", "name": "Ctrl to Vibrato", "type": "float", "min": -1, "max": 1, "step": 0.02}, {"key": "ctrl_to_shape", "name": "Ctrl to Shape", "type": "float", "min": -1, "max": 1, "step": 0.02}, {"key": "ctrl_to_fm", "name": "Ctrl to FM", "type": "float", "min": -1, "max": 1, "step": 0.02}, {"key": "arp_enabled", "name": "Arp", "type": "enum", "options": ["Off", "On"]}, {"key": "arp_tempo", "name": "Arp Tempo", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "arp_direction", "name": "Arp Direction", "type": "enum", "options": ["Up", "Down", "Up/Down", "Random"]}]),
    },
    "sfz": {
        "synth:name":       "SFZ",
        "synth_module":     "sfz",
        "synth:chain_params": JSON.stringify([{"key": "preset", "name": "Instrument", "type": "int", "min": 0}, {"key": "octave_transpose", "name": "Octave", "type": "int", "min": -4, "max": 4}, {"key": "gain", "name": "Gain", "type": "float", "min": 0, "max": 2, "step": 0.02}, {"key": "voices", "name": "Polyphony", "type": "int", "min": 1, "max": 128}, {"key": "attack", "name": "Atk +/-", "type": "float", "min": -50, "max": 50, "step": 1}, {"key": "decay", "name": "Dec +/-", "type": "float", "min": -50, "max": 50, "step": 1}, {"key": "sustain", "name": "Sus +/-", "type": "float", "min": -50, "max": 50, "step": 1}, {"key": "release", "name": "Rel +/-", "type": "float", "min": -50, "max": 50, "step": 1}, {"key": "tune", "name": "Tune +/-", "type": "float", "min": -100, "max": 100, "step": 1}, {"key": "cutoff", "name": "Cutoff +/-", "type": "float", "min": -50, "max": 50, "step": 1}, {"key": "reso", "name": "Reso +/-", "type": "float", "min": -50, "max": 50, "step": 1}, {"key": "knob_preset", "name": "Knob Preset", "type": "int", "min": 0, "max": 0}]),
    },
    "303": {
        "synth:name":       "303",
        "synth_module":     "303",
        "synth:chain_params": JSON.stringify([{"key": "cutoff", "name": "Cutoff", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "resonance", "name": "Resonance", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "env_mod", "name": "Env Mod", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "decay", "name": "Decay", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "accent", "name": "Accent", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "volume", "name": "Volume", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "waveform", "name": "Waveform", "type": "enum", "options": ["Saw", "Square"]}, {"key": "tuning", "name": "Tuning", "type": "float", "min": 0, "max": 1, "step": 0.01}, {"key": "devil_mod_switch", "name": "Devilfish", "type": "enum", "options": ["Off", "On"]}, {"key": "normal_decay", "name": "Normal Decay", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "accent_decay", "name": "Accent Decay", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "feedback_hpf", "name": "Feedback HPF", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "soft_attack", "name": "Soft Attack", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "slide_time", "name": "Slide Time", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "tanh_shaper_drive", "name": "Shaper Drive", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "drive_model", "name": "Model", "type": "enum", "options": ["Soft", "RAT"]}, {"key": "drive", "name": "Drive", "type": "float", "min": 0, "max": 1, "step": 0.02}, {"key": "drive_mix", "name": "Mix", "type": "float", "min": 0, "max": 1, "step": 0.02}]),
    },
    "chiptune": {
        "synth:name":       "Chiptune",
        "synth_module":     "chiptune",
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            list_param: "preset", count_param: "preset_count", name_param: "preset_name", knobs: [], params: [],
        } } }),
        "synth:preset_count": "32",
        "synth:preset_names": JSON.stringify(["P0", "P1", "P2", "P3", "..."]),
        "synth:chain_params": JSON.stringify([{"key": "chip", "name": "Chip", "type": "enum", "options": ["NES", "GB"]}, {"key": "alloc_mode", "name": "Voice Mode", "type": "enum", "options": ["Auto", "Lead", "Locked"]}, {"key": "noise_mode", "name": "Noise Mode", "type": "enum", "options": ["Long", "Short"]}, {"key": "duty", "name": "Duty Cycle", "type": "int", "min": 0, "max": 3, "step": 1}, {"key": "env_attack", "name": "Attack", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "env_decay", "name": "Decay", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "env_sustain", "name": "Sustain", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "env_release", "name": "Release", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "sweep", "name": "Sweep", "type": "int", "min": 0, "max": 7, "step": 1}, {"key": "vibrato_depth", "name": "Vibrato Depth", "type": "int", "min": 0, "max": 12, "step": 1}, {"key": "vibrato_rate", "name": "Vibrato Rate", "type": "int", "min": 0, "max": 10, "step": 1}, {"key": "wavetable", "name": "Wavetable (GB)", "type": "int", "min": 0, "max": 7, "step": 1}, {"key": "channel_mask", "name": "Channel Mask", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "detune", "name": "Detune", "type": "int", "min": 0, "max": 50, "step": 1}, {"key": "volume", "name": "Volume", "type": "int", "min": 0, "max": 15, "step": 1}, {"key": "octave_transpose", "name": "Octave", "type": "int", "min": -3, "max": 3, "step": 1}, {"key": "pitch_env_depth", "name": "PEnv Depth", "type": "int", "min": 0, "max": 24, "step": 1}, {"key": "pitch_env_speed", "name": "PEnv Speed", "type": "int", "min": 0, "max": 15, "step": 1}]),
    },
    "hush1": {
        "synth:name":       "Hush1",
        "synth_module":     "hush1",
        "synth:ui_hierarchy": JSON.stringify({ levels: { root: {
            list_param: "preset", count_param: "preset_count", name_param: "preset_name", knobs: [], params: [],
        } } }),
        "synth:preset_count": "11",
        "synth:preset_names": JSON.stringify(["P0", "P1", "P2", "P3", "..."]),
        "synth:chain_params": JSON.stringify([{"key": "preset", "name": "Preset", "type": "int", "min": 0, "max": -1}, {"key": "volume", "name": "Volume", "type": "float", "min": 0, "max": 1}, {"key": "bend_range", "name": "Bend", "type": "float", "min": 0, "max": 12}, {"key": "saw", "name": "Saw", "type": "float", "min": 0, "max": 1}, {"key": "pulse", "name": "Pulse", "type": "float", "min": 0, "max": 1}, {"key": "sub", "name": "Sub", "type": "float", "min": 0, "max": 1}, {"key": "noise", "name": "Noise", "type": "float", "min": 0, "max": 1}, {"key": "sub_mode", "name": "Sub Mode", "type": "enum", "min": 0, "max": 2, "options": ["-2 Oct 50% PW", "-2 Oct", "-1 Oct"]}, {"key": "white_noise", "name": "White Noise", "type": "enum", "min": 0, "max": 1, "options": ["Off", "On"]}, {"key": "pulse_width", "name": "Pulse Width", "type": "float", "min": 0.05, "max": 0.95}, {"key": "pwm_mode", "name": "PWM Mode", "type": "enum", "min": 0, "max": 2, "options": ["Env", "Manual", "LFO"]}, {"key": "pwm_depth", "name": "PWM Depth", "type": "float", "min": 0, "max": 1}, {"key": "pwm_env_depth", "name": "PWM Env", "type": "float", "min": 0, "max": 1}, {"key": "cutoff", "name": "Cutoff", "type": "float", "min": 0, "max": 1}, {"key": "resonance", "name": "Res", "type": "float", "min": 0, "max": 1.2}, {"key": "env_amt", "name": "Env Amt", "type": "float", "min": 0, "max": 1}, {"key": "key_follow", "name": "Key Follow", "type": "float", "min": 0, "max": 1}, {"key": "filter_velocity_sens", "name": "Vel Filt", "type": "float", "min": 0, "max": 1}, {"key": "attack", "name": "Attack", "type": "float", "min": 0.001, "max": 4}, {"key": "decay", "name": "Decay", "type": "float", "min": 0.001, "max": 6}, {"key": "sustain", "name": "Sustain", "type": "float", "min": 0, "max": 1}, {"key": "release", "name": "Release", "type": "float", "min": 0.001, "max": 8}, {"key": "velocity_sens", "name": "Vel Amp", "type": "float", "min": 0, "max": 1}, {"key": "f_attack", "name": "F Attack", "type": "float", "min": 0.001, "max": 4}, {"key": "f_decay", "name": "F Decay", "type": "float", "min": 0.001, "max": 6}, {"key": "f_sustain", "name": "F Sustain", "type": "float", "min": 0, "max": 1}, {"key": "f_release", "name": "F Release", "type": "float", "min": 0.001, "max": 8}, {"key": "lfo_rate", "name": "LFO Rate", "type": "float", "min": 0.02, "max": 40}, {"key": "lfo_waveform", "name": "LFO Wave", "type": "enum", "min": 0, "max": 3, "options": ["Tri", "Rect", "Random", "Noise"]}, {"key": "lfo_trigger", "name": "LFO Trig", "type": "enum", "min": 0, "max": 1, "options": ["Free", "Retrig"]}, {"key": "lfo_sync", "name": "LFO Sync", "type": "enum", "min": 0, "max": 1, "options": ["Free", "Sync"]}, {"key": "lfo_invert", "name": "LFO Inv", "type": "enum", "min": 0, "max": 1, "options": ["Off", "On"]}, {"key": "lfo_pitch_snap", "name": "Pitch Snap", "type": "enum", "min": 0, "max": 1, "options": ["Off", "On"]}, {"key": "lfo_pitch", "name": "LFO Pitch", "type": "float", "min": 0, "max": 1}, {"key": "lfo_filter", "name": "LFO Filter", "type": "float", "min": 0, "max": 1}, {"key": "lfo_pwm", "name": "LFO PWM", "type": "float", "min": 0, "max": 1}, {"key": "glide", "name": "Glide", "type": "float", "min": 0, "max": 500}, {"key": "portamento_mode", "name": "Porta Mode", "type": "enum", "min": 0, "max": 2, "options": ["Off", "On", "Auto"]}, {"key": "portamento_linear", "name": "Porta Curve", "type": "enum", "min": 0, "max": 1, "options": ["Expo", "Linear"]}, {"key": "retrigger", "name": "Retrigger", "type": "enum", "min": 0, "max": 1, "options": ["Legato", "Trig"]}, {"key": "hold", "name": "Hold", "type": "enum", "min": 0, "max": 1, "options": ["Off", "On"]}, {"key": "transpose", "name": "Transpose", "type": "int", "min": -24, "max": 24}, {"key": "octave_transpose", "name": "Octave", "type": "int", "min": -2, "max": 2}, {"key": "fine_tune", "name": "Fine Tune", "type": "float", "min": -100, "max": 100}, {"key": "gate_trig_mode", "name": "Gate Mode", "type": "enum", "min": 0, "max": 2, "options": ["Gate", "Gate+Trig", "LFO"]}, {"key": "vca_mode", "name": "VCA Mode", "type": "enum", "min": 0, "max": 1, "options": ["Gate", "Envelope"]}, {"key": "adsr_declick", "name": "ADSR DeClick", "type": "float", "min": 0, "max": 1}, {"key": "priority", "name": "Priority", "type": "enum", "min": 0, "max": 1, "options": ["Last", "Low"]}, {"key": "velocity_mode", "name": "Vel Mode", "type": "enum", "min": 0, "max": 2, "options": ["Off", "Trigger", "Active"]}, {"key": "same_note_quirk", "name": "Same-Note", "type": "enum", "min": 0, "max": 1, "options": ["Off", "On"]}, {"key": "filter_env_full_range", "name": "Env Full Range", "type": "enum", "min": 0, "max": 1, "options": ["Off", "On"]}, {"key": "filter_env_polarity", "name": "Env Polarity", "type": "enum", "min": 0, "max": 1, "options": ["Positive", "Negative"]}, {"key": "filter_volume_correction", "name": "Vol Correction", "type": "float", "min": 0, "max": 1}]),
    },
};
