/* movy-host (host/): the only host, and the only file that names its globals.
 *
 * Every global is read at CALL time, never captured: the browser suites swap
 * them per test. movy-host registers all of them before ui.js evaluates and
 * ships in the same payload, so none is ever absent — which is why there is no
 * `typeof` gate here (source-rules.mjs ratchets their count). */

import type { Platform } from './platform.js';

/* movy-host's bulk channel ignores its slot and marker arguments; they are the
 * shape the call kept from schwung's shim. */
const BULK_MARKER = 'overtake_dsp:';

export const standalonePlatform: Platform = {
    readFile: (p) => host_read_file(p),
    writeFile: (p, c) => host_write_file(p, c),
    fileExists: (p) => host_file_exists(p),
    ensureDir: (p) => host_ensure_dir(p),
    removeDir: (p) => host_remove_dir(p),

    engineGet: (k) => host_module_get_param(k) ?? null,
    engineSet: (k, v) => host_module_set_param(k, v) !== false,
    engineGetBulk: (payload) => shadow_get_params(0, BULK_MARKER, payload) ?? null,
    engineSetBulk: (payload) => shadow_set_params(0, BULK_MARKER, payload) !== false,
    engineSnapshotSeq: () => movy_engine_snapshot_seq(),
    engineSnapshot: () => movy_engine_snapshot() ?? null,
    engineSubmitted: () => movy_engine_submitted(),

    surfaceSend: (data) => { move_midi_internal_send(data); },
    loadUiModule: (p) => shadow_load_ui_module(p),
    exit: () => { host_exit_module(); },
    powerOff: () => { host_power_off(); },

    ipcCalls: [
        ['host_module_get_param', 'mget', 0],
        ['host_module_set_param', 'mset', 0],
        /* A copy, not a round trip, but still a host call per tick: counted so
         * the probe shows what replaced the `status` poll (WP10). */
        ['movy_engine_snapshot', 'snap', -1],
        /* One round trip for many keys, which is why a page refresh uses it —
         * and why leaving it out would hide the call that replaced eight. */
        ['shadow_get_params', 'bget', 1],
        ['shadow_set_params', 'bset', 1],
    ],
};
