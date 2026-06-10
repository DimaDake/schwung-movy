/* Ambient declarations for Schwung host APIs and QuickJS globals.
 * All of these are injected into the global scope on the device.
 * In browser tests they are mocked on globalThis. */

declare function fill_rect(x: number, y: number, w: number, h: number, color: number): void;
declare function clear_screen(): void;
declare function shadow_get_param(slot: number, key: string): string | null;
declare function shadow_set_param(slot: number, key: string, value: string): boolean;
declare function shadow_get_ui_slot(): number;
declare function shadow_send_midi_to_dsp(data: number[]): void;
declare function host_exit_module(): void;
declare function host_read_file(path: string): string | null;
declare function setLED(note: number, color: number, immediate: boolean): void;
declare function setButtonLED(cc: number, color: number, immediate: boolean): void;
declare function decodeDelta(d2: number): number;

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
    function open(path: string, flags: number): number;
    function read(fd: number, buf: ArrayBuffer, offset: number, len: number): number;
    function seek(fd: number, offset: number, whence: number): number;
    function close(fd: number): number;
    const O_RDONLY: number;
}

/* App globals assigned at startup */
declare global {
    var init:                  (() => void)            | undefined;
    var tick:                  (() => void)            | undefined;
    var onMidiMessageInternal: ((data: number[]) => void) | undefined;
}
