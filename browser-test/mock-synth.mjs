/* browser-test/mock-synth.mjs — mock synth state for the browser harness
 * Each entry is a flat map keyed the same way shadow_get_param uses:
 *   "synth:name"          → display name
 *   "synth:ui_hierarchy"  → JSON string (parsed by model.mjs)
 *   "synth:<key>"         → current param value as string
 */

function hier(knobs) {
    return JSON.stringify({ levels: { root: { knobs } } });
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
};
