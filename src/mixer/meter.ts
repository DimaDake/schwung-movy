/* meter.ts — the engine's `mtr` status field, decoded for the mixer page.
 *
 * Per track three bytes (`track_meter.rs`): fader gain, left peak, right peak,
 * each 0 = silence else half-dB steps up from -60 dB. Decoded straight to
 * POSITIONS on the fader's own travel (`volumeFracOfDb`), so the meter and the
 * fader share one axis and a block at full scale through a unity fader reaches
 * exactly the fader's line.
 *
 * Decoded only while the page draws, and only when the text changed: the
 * field arrives every tick, the page is closed almost all the time. */

import { volumeFracOfDb } from './db-ladder.js';

export const METER_TRACKS = 16;
/** Per track: [fader, left, right] positions, 0..1. */
export const METER_STRIDE = 3;

const BYTE_FLOOR_DB = -60;
const BYTE_STEPS_PER_DB = 2;

const out = new Float32Array(METER_TRACKS * METER_STRIDE);
let decodedFrom: string | null = null;

export function byteToFrac(b: number): number {
    return b <= 0 ? 0 : volumeFracOfDb(BYTE_FLOOR_DB + (b - 1) / BYTE_STEPS_PER_DB);
}

/** The positions for `raw`. The array is reused: read it, do not keep it. A
 *  field that is missing or short reads as silence at a closed fader rather
 *  than as last tick's numbers. */
export function decodeMeter(raw: string): Float32Array {
    if (raw === decodedFrom) return out;
    decodedFrom = raw;
    for (let i = 0; i < out.length; i++) {
        const b = parseInt(raw.substr(i * 2, 2), 16);
        out[i] = Number.isFinite(b) ? byteToFrac(b) : 0;
    }
    return out;
}
