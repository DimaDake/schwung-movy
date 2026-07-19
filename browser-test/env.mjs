/* browser-test/env.mjs — shared Schwung global stubs for node tests.
 *
 * installEnv() assigns the globals the bundled modules read at call time and
 * returns an `env` whose param store backs shadow_get/set_param. Color globals
 * mirror the real hardware palette indices (src/seq/colors.ts) so LED
 * assertions compare against the same values the device uses. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/* Simulate a module shipping its own layout: on the device Forge carries
 * `sound_generators/forge/movy_config.json` (canonical: forge-move repo,
 * src/movy_config.json); here we serve the fixture snapshot so the loader's
 * self-describing path is exercised. */
function serveModuleLayout(path) {
    const m = /\/sound_generators\/([^/]+)\/movy_config\.json$/.exec(path || '');
    if (m && m[1] === 'forge') {
        try { return readFileSync(join(FIXTURE_DIR, 'forge-movy-config.json'), 'utf8'); } catch { return null; }
    }
    return null;
}

export function installEnv() {
    let params = {};
    const env = {
        setParams(preset) { params = { ...preset }; },
        get params() { return params; },
    };

    globalThis.fill_rect          = () => {};
    globalThis.clear_screen       = () => {};
    globalThis.shadow_get_param   = (_s, key) => params[key] ?? null;
    globalThis.shadow_set_param   = (_s, key, val) => { params[key] = val; return true; };
    globalThis.shadow_get_ui_slot = () => 0;
    globalThis.shadow_send_midi_to_dsp = () => {};
    globalThis.host_read_file     = (path) => serveModuleLayout(path);
    globalThis.host_write_file    = () => true;
    globalThis.host_exit_module   = () => {};
    globalThis.setLED             = () => {};
    globalThis.setButtonLED       = () => {};
    globalThis.MoveKnob1          = 71;
    globalThis.MidiNoteOn         = 0x90;
    globalThis.MidiNoteOff        = 0x80;
    /* shadow_ui re-encodes wheel deltas (1-63 = +, 65-127 = -). */
    globalThis.decodeDelta        = (d2) => (d2 < 64 ? d2 : d2 - 128);
    globalThis.move_midi_internal_send = () => {};
    /* RGB palette indices used by keyboard/leds.ts (mirror of seq/colors.ts). */
    globalThis.NeonGreen          = 11;   // C_GREEN
    globalThis.White              = 120;  // C_WHITE
    globalThis.Black              = 0;    // C_BLACK
    globalThis.DarkGrey           = 124;
    globalThis.BrightRed          = 127;
    /* Pad note range: MovePads[0]=68 .. 99 (32 pads). */
    globalThis.MovePads           = Array.from({ length: 32 }, (_, i) => 68 + i);
    /* Knob touch notes 0-7 (also LED note positions under each knob). */
    globalThis.MoveKnob1Touch     = 0;
    globalThis.MoveKnob2Touch     = 1;
    globalThis.MoveKnob3Touch     = 2;
    globalThis.MoveKnob4Touch     = 3;
    globalThis.MoveKnob5Touch     = 4;
    globalThis.MoveKnob6Touch     = 5;
    globalThis.MoveKnob7Touch     = 6;
    globalThis.MoveKnob8Touch     = 7;    // JOG_TOUCH = +1 → note 8
    /* Control-surface CCs. Values matter only for paths the harness drives via
     * MIDI; the harness sends pad/step notes only, so these are defined purely
     * to satisfy module-eval and runtime comparisons. */
    globalThis.MoveShift          = 49;
    globalThis.MoveBack           = 51;
    globalThis.MoveMainButton     = 3;    // jog-click CC; 50 is taken by Note/Session
    globalThis.MoveMainKnob       = 14;
    globalThis.MoveLeft           = 62;
    globalThis.MoveRight          = 63;
    globalThis.MoveUp             = 55;
    globalThis.MoveDown           = 54;

    return env;
}
