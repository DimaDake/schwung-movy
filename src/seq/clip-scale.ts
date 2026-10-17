/* Clip SCALE enum: index 0..7 over playback-speed multipliers (higher = faster).
 * The cell shows whole multiples as 'NX' on one line and fractions as a stacked
 * 'n/d' (via the length-square renderer); toasts and the overlay always carry X.
 * Mirrors the engine's rational scale_num/scale_den (8X dropped: too fast). */

export const SCALE_RATIONALS: [number, number][] = [
    [1, 8], [1, 4], [1, 2], [3, 4], [1, 1], [3, 2], [2, 1], [4, 1],
];
export const SCALE_DEFAULT_IDX = 4; // 1X

export const SCALE_LABELS: string[] =
    SCALE_RATIONALS.map(([n, d]) => (d === 1 ? `${n}X` : `${n}/${d}X`));



/** Map an engine rational back to its enum index (defaults if unknown). */
export function rationalToIdx(num: number, den: number): number {
    const i = SCALE_RATIONALS.findIndex(([n, d]) => n === num && d === den);
    return i < 0 ? SCALE_DEFAULT_IDX : i;
}
