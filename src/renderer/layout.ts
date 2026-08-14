export const W        = 128;
export const HEADER_H = 7;
export const BAR_Y    = 8;
export const BAR_H    = 2;
export const ROW0_Y   = 11;
export const LBL0_Y   = 27;
export const ROW1_Y   = 35;
export const LBL1_Y   = 51;
export const CELL_W   = 32;
export const LBL_H    = 7;
export const KW       = 16;
export const TOAST_Y  = 58;
export const TOAST_H  = 6;

/* Horizontal extent for a graphic spanning `cellCount` cells from `startCol`.
 *
 * A graphic is inset one pixel wherever it meets ANOTHER cell, so two drawings
 * on the same line are separated by two pixels and never read as one shape —
 * but NOT at the screen edges, where there is nothing to separate from and the
 * inset only throws away resolution. Returns [x0, xEnd) — xEnd exclusive. */
export function spanX(startCol: number, cellCount: number): [number, number] {
    const first = startCol === 0;
    const last  = startCol + cellCount >= 4;
    return [
        first ? 0 : startCol * CELL_W + 1,
        last ? W : (startCol + cellCount) * CELL_W - 1,
    ];
}
