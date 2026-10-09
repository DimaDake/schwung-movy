/* The overtake host: schwung's shadow_ui, with Move running beside movy.
 *
 * Every global is read at CALL time, never captured: shadow_ui installs some of
 * them after ui.js evaluates, older hosts lack some entirely, and the browser
 * suites swap them per test. Each fallback is the one its call site used before
 * the seam existed, so routing through here changed no behaviour. */

import type { Platform } from './platform.js';


/* The routing marker for the bulk channel: the shim dispatches on this prefix
 * and hands the payload to whichever DSP is loaded as overtake — movy's engine. */
const BULK_MARKER = 'overtake_dsp:';

export const overtakePlatform: Platform = {
    name: 'overtake',
    caps: {
        coexistsWithMove: true,
        /* Absent on hosts that predate self-managed suspend. */
        get canSuspend() { return typeof host_suspend_overtake === 'function'; },
        ownsMasterVolume: false,
    },

    filesAvailable: () => typeof host_read_file === 'function'
        && typeof host_write_file === 'function',
    readFile: (p) => (typeof host_read_file === 'function' ? host_read_file(p) : null),
    writeFile: (p, c) => (typeof host_write_file === 'function' ? host_write_file(p, c) : false),
    fileExists: (p) => (typeof host_file_exists === 'function' ? host_file_exists(p) : undefined),
    ensureDir: (p) => (typeof host_ensure_dir === 'function' ? host_ensure_dir(p) : false),
    removeDir: (p) => (typeof host_remove_dir === 'function' ? host_remove_dir(p) : false),

    engineAvailable: () => typeof host_module_set_param === 'function'
        && typeof host_module_get_param === 'function',
    /* A present call never yields `undefined` — that value means "absent", and
     * a host (or a mock) that answers nothing must not read as one. */
    engineGet: (k) => (typeof host_module_get_param === 'function'
        ? host_module_get_param(k) ?? null : undefined),
    engineSet: (k, v) => {
        if (typeof host_module_set_param !== 'function') return undefined;
        host_module_set_param(k, v);
        return true;
    },
    /* Only an explicit false is a refusal; a host that returns nothing has
     * given no grounds to claim a loss. */
    engineSetBlocking: (k, v, ms) => (typeof host_module_set_param_blocking === 'function'
        ? host_module_set_param_blocking(k, v, ms) !== false : undefined),
    engineGetBulk: (payload) => (typeof shadow_get_params === 'function'
        ? shadow_get_params(0, BULK_MARKER, payload) ?? null : undefined),
    /* The bulk write is the opposite: only an explicit true is delivered. */
    engineSetBulk: (payload) => (typeof shadow_set_params === 'function'
        ? shadow_set_params(0, BULK_MARKER, payload) === true : undefined),

    slotParamsAvailable: () => typeof shadow_get_param === 'function',
    slotGet: (s, k) => (typeof shadow_get_param === 'function' ? shadow_get_param(s, k) : null),
    slotSet: (s, k, v) => (typeof shadow_set_param === 'function' ? shadow_set_param(s, k, v) : false),
    slotSetTimeout: (s, k, v, ms) => (typeof shadow_set_param_timeout === 'function'
        ? shadow_set_param_timeout(s, k, v, ms) ?? false : undefined),
    slotSendMidi: (data) => { if (typeof shadow_send_midi_to_dsp === 'function') shadow_send_midi_to_dsp(data); },
    uiSlot: () => (typeof shadow_get_ui_slot === 'function' ? shadow_get_ui_slot() : 0),

    surfaceSend: (data) => {
        if (typeof move_midi_internal_send !== 'function') return false;
        move_midi_internal_send(data);
        return true;
    },
    canLoadUiModule: () => typeof shadow_load_ui_module === 'function',
    loadUiModule: (p) => (typeof shadow_load_ui_module === 'function'
        ? shadow_load_ui_module(p) : false),
    exit: () => { if (typeof host_exit_module === 'function') host_exit_module(); },
    suspend: () => { if (typeof host_suspend_overtake === 'function') host_suspend_overtake(); },

    claimLeds: () => {
        if (typeof shadow_set_overtake_suppress_sysex !== 'function') return false;
        shadow_set_overtake_suppress_sysex(1);
        return true;
    },
    /* 0 = Move owns the surface, 2 = the module does (1 is the menu). */
    lendSurfaceToMove: (toMove) => {
        if (typeof shadow_set_overtake_mode !== 'function') return false;
        shadow_set_overtake_mode(toMove ? 0 : 2);
        return true;
    },
    excludeMoveFromVolume: (excluded) => {
        if (typeof shadow_set_overtake_suppress_master_volume !== 'function') return false;
        shadow_set_overtake_suppress_master_volume(excluded ? 1 : 0);
        return true;
    },
    canExcludeMoveFromVolume: () => typeof shadow_set_overtake_suppress_master_volume === 'function',
    canInjectToMove: () => typeof move_midi_inject_to_move === 'function',
    injectToMove: (data) => { if (typeof move_midi_inject_to_move === 'function') move_midi_inject_to_move(data); },
    engineInjectReachesMove: () => typeof shadow_overtake_move_inject_active === 'function'
        && shadow_overtake_move_inject_active() === 1,

    ipcCalls: [
        ['shadow_get_param', 'get', 1],
        ['shadow_set_param', 'set', 1],
        ['host_module_get_param', 'mget', 0],
        ['host_module_set_param', 'mset', 0],
        /* The engine's writes are all BLOCKING (the overtake param SHM is a
         * single slot, so non-blocking writes are lost) — which is exactly why
         * leaving this one unwrapped hid the most expensive calls movy makes. */
        ['host_module_set_param_blocking', 'msetb', 0],
        /* One round trip for many keys, which is why a page refresh uses it —
         * and why leaving it out would hide the call that replaced eight. */
        ['shadow_get_params', 'bget', 1],
        ['shadow_set_params', 'bset', 1],
    ],
};
