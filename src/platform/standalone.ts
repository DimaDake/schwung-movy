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
    engineSet: (k, v) => { host_module_set_param(k, v); },
    /* Only an explicit false is a refusal; a host that returns nothing has
     * given no grounds to claim a loss. */
    engineSetBlocking: (k, v, ms) => host_module_set_param_blocking(k, v, ms) !== false,
    engineGetBulk: (payload) => shadow_get_params(0, BULK_MARKER, payload) ?? null,
    /* The bulk write is the opposite: only an explicit true is delivered. */
    engineSetBulk: (payload) => shadow_set_params(0, BULK_MARKER, payload) === true,

    surfaceSend: (data) => { move_midi_internal_send(data); },
    loadUiModule: (p) => shadow_load_ui_module(p),
    exit: () => { host_exit_module(); },
    powerOff: () => { host_power_off(); },

    ipcCalls: [
        ['host_module_get_param', 'mget', 0],
        ['host_module_set_param', 'mset', 0],
        /* The engine's writes are all BLOCKING, which is exactly why leaving
         * this one unwrapped hid the most expensive calls movy makes. */
        ['host_module_set_param_blocking', 'msetb', 0],
        /* One round trip for many keys, which is why a page refresh uses it —
         * and why leaving it out would hide the call that replaced eight. */
        ['shadow_get_params', 'bget', 1],
        ['shadow_set_params', 'bset', 1],
    ],
};
