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
declare function shadow_get_ui_slot(): number;
declare function shadow_send_midi_to_dsp(data: number[]): void;
declare function host_exit_module(): void;
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
