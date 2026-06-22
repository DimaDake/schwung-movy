/* Shared detent accumulator for knob pages that step enum-style values.
 * One detent = DETENT_DIV raw delta units; partial turns accumulate across
 * calls so the caller reliably gets ±1 per physical click. */

export const DETENT_DIV = 8;

/** Accumulate raw delta for knob `k` into `accum`; return the number of whole
 *  ±1 detents consumed, keeping the remainder in `accum[k]`. */
export function countDetents(accum: number[], k: number, delta: number): number {
    accum[k] += delta;
    let n = 0;
    while (accum[k] >= DETENT_DIV)  { accum[k] -= DETENT_DIV; n++; }
    while (accum[k] <= -DETENT_DIV) { accum[k] += DETENT_DIV; n--; }
    return n;
}
