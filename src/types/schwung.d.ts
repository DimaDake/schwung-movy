/* Ambient declarations for Schwung host APIs and QuickJS globals.
 * All of these are injected into the global scope on the device.
 * In browser tests they are mocked on globalThis. */

declare function fill_rect(x: number, y: number, w: number, h: number, color: number): void;
declare function clear_screen(): void;
/* Set true by the host only while a parked module's tick() runs. Read it as
 * `globalThis.overtakeParked`: a bare unset global identifier throws. */
declare var overtakeParked: boolean | undefined;
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
