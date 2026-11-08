/* The pads while a freeze records (seq/freeze-busy.ts). */

import { C_WHITE, TRACK_COLOR } from './colors.js';

/* Nothing can be played while it records, so instead of a keyboard they say
 * so: "FROZEN" scrolling right to left, white on ice blue. 3x4 letters, a
 * blank column between them; one column every STEP_MS. The grid is diffed
 * against the LED cache and paced by the LED budget like any pad repaint, so
 * a scroll step costs at most the pads that actually change. */
const ICE = TRACK_COLOR[2];   // Azure Blue dim: the palette's one cool hue that reads as blue
const STEP_MS = 220;
const TEXT = 'FROZEN ';
/* Rows top to bottom; bit 2 = left column. */
const GLYPHS: Record<string, number[]> = {
    F: [0b111, 0b100, 0b110, 0b100],
    R: [0b110, 0b101, 0b110, 0b101],
    O: [0b111, 0b101, 0b101, 0b111],
    Z: [0b111, 0b001, 0b100, 0b111],
    E: [0b111, 0b110, 0b100, 0b111],
    N: [0b101, 0b111, 0b111, 0b101],
};
const SPAN = TEXT.length * 4;

/** Colour of pad `idx` (0 = bottom-left, 31 = top-right) at `nowMs`. */
export function frozenPadColor(idx: number, nowMs: number): number {
    const row = 3 - Math.floor(idx / 8);          // 0 = top row
    const col = idx % 8;
    const x = (col + Math.floor(nowMs / STEP_MS)) % SPAN;
    const glyph = GLYPHS[TEXT[Math.floor(x / 4)]];
    const cx = x % 4;
    if (!glyph || cx === 3) return ICE;
    return (glyph[row] >> (2 - cx)) & 1 ? C_WHITE : ICE;
}

