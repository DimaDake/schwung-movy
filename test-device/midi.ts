/* USB-MIDI packets. Both the schwung-testd `INJECT_MIDI` wire format and the
 * movy agent's `UI` command take one 4-byte packet as 8 hex chars.
 * Byte 0 is (cable << 4) | CIN; cable 0 is the device's own input. */
export type Packet = [number, number, number, number];

export const cc      = (n: number, v: number): Packet => [0x0b, 0xb0, n, v];
export const noteOn  = (n: number, v = 100):   Packet => [0x09, 0x90, n, v];
export const noteOff = (n: number):            Packet => [0x08, 0x80, n, 0];

export const hex = (p: Packet): string =>
    p.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/* Schwung re-encodes accumulated knob deltas before handing them to a module:
 * 1..63 clockwise, 65..127 counter-clockwise. Sending a raw signed delta makes
 * a counter-clockwise turn read as a large clockwise one. */
export const knobDelta = (d: number): number =>
    d > 0 ? Math.min(d, 63) : Math.max(128 + d, 65);

/* Movy CC/note map (shared/constants.mjs + scripts/grab-screen.mjs). */
export const CC_JOG_CLICK = 3;
export const CC_JOG_TURN  = 14;
export const CC_BACK      = 51;
export const CC_PLAY      = 85;
export const CC_REC       = 86;
export const CC_DELETE    = 119;
export const CC_UNDO      = 56;   // seq/leds.ts CC_UNDO — fires on press
export const CC_KNOB_BASE = 71;   // knobs 1..8 -> 71..78
export const CC_TRACK_BASE = 40;  // 43 = track 1, 40 = track 4
export const STEP_NOTE_BASE = 16; // step buttons 16..31
export const PAD_NOTE_BASE  = 68; // pads 68..99
