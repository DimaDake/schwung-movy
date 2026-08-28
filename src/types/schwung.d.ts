/* Ambient declarations for Schwung host APIs and QuickJS globals.
 * All of these are injected into the global scope on the device.
 * In browser tests they are mocked on globalThis. */

declare function fill_rect(x: number, y: number, w: number, h: number, color: number): void;
declare function clear_screen(): void;
declare function shadow_get_param(slot: number, key: string): string | null;
declare function shadow_set_param(slot: number, key: string, value: string): boolean;
/* Blocking variant: waits (up to timeoutMs) for the write to be consumed. The
 * overtake param SHM is a single slot, so consecutive non-blocking writes
 * overwrite each other — multi-field commits (e.g. LFO target+param+enabled)
 * must use this. May be absent in older shims / test env → guard with typeof. */
declare function shadow_set_param_timeout(slot: number, key: string, value: string, timeoutMs: number): boolean;
/* Bulk param channel (shadow_ui.c request types 3/4): collapses N round trips
 * into one and routes to the loaded overtake DSP — for movy, its own engine.
 * `key` is the routing marker ("overtake_dsp:"); the payload is length-prefixed
 * (see src/track/bulk.ts). Absent on older shims → guard with typeof. */
declare function shadow_get_params(slot: number, key: string, payload: string): string | null;
declare function shadow_set_params(slot: number, key: string, payload: string): boolean;
declare function shadow_get_ui_slot(): number;
declare function shadow_send_midi_to_dsp(data: number[]): void;
declare function host_exit_module(): void;
/* Strip Move's cable-0 RGB LED sysex during full overtake. Absent on hosts
 * older than the flag; the framework clears it on overtake exit. */
declare function shadow_set_overtake_suppress_sysex(flag: number): void;
/* Suppress CC 79 (master volume) / master-touch note 8's hardcoded overtake
 * passthrough to Move firmware, and the matching plain-volume-touch OLED
 * handoff, for the duration a tool sets. Absent on hosts older than the flag
 * (2026-08-24 fork PR) — always guard with `typeof ... === 'function'`. */
declare function shadow_set_overtake_suppress_master_volume(flag: number): void;
/* Capability sentinel (schwung #293, 2026-08-27): returns 1 when an overtake
 * DSP's `midi_inject_to_move` goes out on a dedicated queue that reaches Move
 * while the takeover is live. ABSENT on older hosts, where the shared ring is
 * instead drained back onto the overtaking tool's own surface — see
 * seq/engine.ts (the play link) for what that costs. */
declare function shadow_overtake_move_inject_active(): number;
/* Background mode (Phase 2). host_suspend_overtake() parks movy under Move's
 * native UI; it is ABSENT on hosts that predate the capability, so always
 * guard with `typeof host_suspend_overtake === 'function'`. overtakeParked is
 * set true by the host only while a parked module's tick() runs — read it as
 * `globalThis.overtakeParked` (a bare unset global identifier throws). */
declare function host_suspend_overtake(): void;
declare var overtakeParked: boolean | undefined;
declare function host_read_file(path: string): string | null;
declare function host_write_file(path: string, content: string): boolean;
declare function host_file_exists(path: string): boolean;
declare function host_ensure_dir(path: string): boolean;
/* rm -rf, permitted only under modules/ — which is where movy's per-set state
 * lives. There is no host_remove_file, so a directory is the unit of deletion. */
declare function host_remove_dir(path: string): boolean;
/* Tool-DSP param bridge — installed by shadow_ui before ui.js loads when the
 * tool ships a dsp.so (routes to shadow_set/get_param(0, "overtake_dsp:"+key)).
 * Guard with typeof checks: absent in browser tests and DSP-less installs. */
declare function host_module_set_param(key: string, value: string): boolean;
declare function host_module_set_param_blocking(key: string, value: string, timeoutMs: number): boolean;
declare function host_module_get_param(key: string): string | null;
declare function setLED(note: number, color: number, immediate: boolean): void;
declare function setButtonLED(cc: number, color: number, immediate: boolean): void;
declare function decodeDelta(d2: number): number;
/* Native LED / surface MIDI: [cin, status, data1, data2]. A shadow_ui global
 * available to overtake modules; used to drive Push-2-style LED animation
 * channels. Absent in browser tests (guard with typeof). */
declare function move_midi_internal_send(data: number[]): void;

/* Inject USB-MIDI packets ([cin, status, d1, d2], cable 0 = control surface)
 * into Move firmware's MIDI_IN. The shim drains these after all overtake
 * filtering, so they reach Move even while it is blocked from the hardware.
 * Absent in browser tests (guard with typeof). */
declare function move_midi_inject_to_move(data: number[]): void;
/* 0 = normal (Move owns the surface), 1 = menu, 2 = module. Lowering it is the
 * only way a packet injected by a module can reach Move — see seq/set-commit.ts. */
declare function shadow_set_overtake_mode(mode: number): void;

/* LED color constants */
declare const Black: number;
declare const DarkGrey: number;
declare const White: number;
declare const NeonGreen: number;
declare const BrightRed: number;

/* Control surface constants */
declare const MovePads: number[];
declare const MoveKnob1: number;
/* Knob touch notes 0-7 — also used as LED note positions under each knob */
declare const MoveKnob1Touch: number;
declare const MoveKnob2Touch: number;
declare const MoveKnob3Touch: number;
declare const MoveKnob4Touch: number;
declare const MoveKnob5Touch: number;
declare const MoveKnob6Touch: number;
declare const MoveKnob7Touch: number;
declare const MoveKnob8Touch: number;
declare const MoveShift: number;
declare const MoveBack: number;
declare const MoveMainButton: number;
declare const MoveMainKnob: number;
declare const MoveLeft: number;
declare const MoveRight: number;
declare const MoveUp: number;
declare const MoveDown: number;

/* MIDI status bytes */
declare const MidiNoteOn: number;
declare const MidiNoteOff: number;

/* QuickJS std module — available as a global on device via banner import.
 * Only the handful of file operations wav-peaks.ts needs are declared. */
declare namespace std {
    interface FILE {
        read(buffer: ArrayBuffer, position: number, length: number): number;
        seek(offset: number, whence: number): number;
        close(): void;
    }
    function open(path: string, mode: string): FILE | null;
}

/* QuickJS os module — available as a global on device via banner import */
declare namespace os {
    function readdir(path: string): [string[], number];
    function stat(path: string): [{ mode: number }, number];
}

/* App globals assigned at startup */
declare global {
    var init:                  (() => void)            | undefined;
    var tick:                  (() => void)            | undefined;
    var onMidiMessageInternal: ((data: number[]) => void) | undefined;
}

/** Substituted by esbuild (`define`), never by the runtime — so a `false` here
 *  removes the debug-only branches from the bundle rather than skipping them.
 *  See build/device.mjs and src/app/debug.ts. */
declare const __MOVY_DEBUG__: boolean;
