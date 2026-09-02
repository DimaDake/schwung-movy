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

/* schwung src/host/shadow_constants.h — the number of real shadow slots, and so
 * the highest track index the slot-addressed param API will accept. */
export const SHADOW_UI_SLOTS = 4;

/* Simulate a module shipping its own layout: on the device Forge carries
 * `sound_generators/forge/movy_config.json` (canonical: forge-move repo,
 * src/movy_config.json), 9W9 carries its own, and so on. Any module id with a
 * `<id>-movy-config.json` fixture is served here, so the loader's
 * self-describing path is exercised without each suite restubbing the host. */
function serveModuleLayout(path) {
    const m = /\/(?:sound_generators|audio_fx|midi_fx)\/([^/]+)\/movy_config\.json$/.exec(path || '');
    if (!m) return null;
    try { return readFileSync(join(FIXTURE_DIR, `${m[1]}-movy-config.json`), 'utf8'); }
    catch { return null; }
}

export function installEnv() {
    let params = {};
    /* USB-MIDI packets a module pushed into Move's MIDI_IN, so tests can assert
     * the track-hold divert (see src/mixer/track-volume.ts). */
    const injected = [];
    const env = {
        setParams(preset) { params = { ...preset }; },
        get params() { return params; },
        get injected() { return injected; },
        clearInjected() { injected.length = 0; },
    };

    /* QuickJS std/os file access, used by wav-peaks.ts. Tests install their own
     * fake WAV via env.setFiles(); by default nothing is readable. */
    let files = {};
    env.setFiles = (map) => { files = { ...map }; };
    globalThis.std = {
        open(path, mode) {
            const data = files[path];
            if (!data || String(mode).indexOf('r') < 0) return null;
            let pos = 0;
            return {
                read(buffer, offset, length) {
                    const n = Math.max(0, Math.min(length, data.length - pos));
                    new Uint8Array(buffer, offset, n).set(data.subarray(pos, pos + n));
                    pos += n;
                    return n;
                },
                seek(off) { pos = off; return 0; },
                close() {},
            };
        },
    };
    globalThis.os = globalThis.os ?? {};
    const baseStat = globalThis.os.stat;
    globalThis.os.stat = (path) => (files[path]
        ? [{ size: files[path].length, mtime: 1 }, 0]
        : (baseStat ? baseStat(path) : [null, -1]));

    globalThis.fill_rect          = () => {};
    globalThis.clear_screen       = () => {};
    globalThis.shadow_get_param   = (_s, key) => params[key] ?? null;
    globalThis.shadow_set_param   = (_s, key, val) => { params[key] = val; return true; };
    /* The slot guard is the point, not the write. `js_shadow_set_param_timeout`
     * (schwung shadow_ui.c) refuses `slot >= SHADOW_UI_SLOTS` and returns false
     * having written nothing — a movy track (5-16) is not a schwung slot. A stub
     * that ignored the slot is what let two slot-addressed writes to movy tracks
     * pass every test while doing nothing at all on device. */
    const setParamTimeout = (slot, key, val) => {
        if (!(slot >= 0 && slot < SHADOW_UI_SLOTS)) return false;
        params[key] = val;
        return true;
    };
    globalThis.shadow_set_param_timeout = setParamTimeout;
    /* Tests that swap in their own capturing stub put this one back rather than
     * deleting it — dropping it entirely would quietly send every later blocking
     * write down the non-blocking fallback. */
    env.restoreSetParamTimeout = () => { globalThis.shadow_set_param_timeout = setParamTimeout; };
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
    globalThis.move_midi_inject_to_move = (data) => { injected.push([...data]); };
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
