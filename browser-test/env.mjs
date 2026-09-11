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
const OVERRIDE_DIR = join(FIXTURE_DIR, '..', '..', 'src', 'module-configs');

/* schwung src/host/shadow_constants.h — the number of real shadow slots, and so
 * the highest track index the slot-addressed param API will accept. */
export const SHADOW_UI_SLOTS = 4;

/* Simulate a module shipping its own layout: on the device Forge carries
 * `sound_generators/forge/movy_config.json` (canonical: forge-move repo,
 * src/movy_config.json), 9W9 carries its own, and so on. Any module id with a
 * `<id>-movy-config.json` fixture is served here, so the loader's
 * self-describing path is exercised without each suite restubbing the host. */
function serveModuleLayout(path) {
    /* movy's own override configs, shipped beside ui.js on the device. Served
     * from the repo copy so the suites exercise the same files that deploy. */
    const o = /\/tools\/movy\/configs\/([^/]+)\.json$/.exec(path || '');
    if (o) {
        try { return readFileSync(join(OVERRIDE_DIR, `${o[1]}.json`), 'utf8'); }
        catch { return null; }
    }
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
    /* Slot-AWARE, for the same reason `shadow_set_param_timeout` below guards on
     * the slot: a stub that answers every slot alike cannot tell a per-slot read
     * from a global one. The migration reads four schwung slots and has to see
     * four different racks, and a suite running on the old stub would have
     * passed while every slot returned slot 0's answer.
     *
     * The bare-key fallback is what keeps every other suite working: they seed
     * `params[key]` and read it back through whichever slot they happen to use.
     * A write lands on both, because suites routinely set through one slot and
     * read back through another. */
    /* The baseline slot accessors, kept reachable under their own names.
     *
     * Suites routinely swap in a capturing `shadow_set_param` and several
     * DELETE it and never put it back — so the chain delegation below cannot
     * simply assume the global is there. It prefers the global (that is what
     * makes a capture stub see chain writes) and falls back to these. */
    const slotGet = (s, key) => params[s + '|' + key] ?? params[key] ?? null;
    const slotSet = (s, key, val) => { params[s + '|' + key] = val; params[key] = val; return true; };
    globalThis.__movyEnvSlotGet = slotGet;
    globalThis.__movyEnvSlotSet = slotSet;
    globalThis.shadow_get_param   = slotGet;
    globalThis.shadow_set_param   = slotSet;
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
    /* ── The engine's param namespace ────────────────────────────────────
     *
     * Every track is a movy chain now, so `portFor(0)` addresses `ch0:<key>` in
     * movy's own engine where it used to read schwung's slot 0.
     *
     * These DELEGATE to the shadow API rather than reading `params` directly,
     * and that is the whole point: a suite that swaps in a capturing
     * `shadow_set_param` to see what a knob wrote still sees it, and a suite
     * that seeds `params` still describes what track 0 holds. The port
     * underneath those fixtures changed; what they mean did not.
     *
     * Suites that want a real engine install `mock-engine.mjs`, which replaces
     * these wholesale. */
    const chainOf = (key) => {
        const m = /^ch([0-9]+):(.*)$/.exec(key);
        return m ? [Number(m[1]), m[2]] : [0, key];
    };
    const engineGet = (key) => {
        const [slot, k] = chainOf(key);
        return (globalThis.shadow_get_param ?? slotGet)(slot, k);
    };
    globalThis.host_module_get_param = engineGet;
    const engineSet = (key, val) => {
        const [slot, k] = chainOf(key);
        /* A chain's live note arrives as a param (`ch<N>:midi` = "status.d1.d2")
         * because the engine owns the chain, not the shim. Modelled as the send
         * it stands for, so a suite asserting on note delivery keeps asserting
         * on the same thing. */
        if (k === 'midi') {
            const [st, d1, d2] = String(val).split('.').map(Number);
            if (globalThis.shadow_send_midi_to_dsp) {
                globalThis.shadow_send_midi_to_dsp([(st | slot) & 0xff, d1, d2]);
            }
            return true;
        }
        return (globalThis.shadow_set_param ?? slotSet)(slot, k, val);
    };
    globalThis.host_module_set_param = engineSet;
    globalThis.host_module_set_param_blocking = engineSet;
    /* Kept reachable so `uninstallMockEngine()` can put these BACK rather than
     * deleting them: a suite that installs a mock engine and removes it again
     * would otherwise leave every later suite with no engine at all, and every
     * param page blank — which is only survivable while a track is a shadow
     * slot, and no track is. */
    globalThis.__movyEnvEngineGet = engineGet;
    globalThis.__movyEnvEngineSet = engineSet;
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
