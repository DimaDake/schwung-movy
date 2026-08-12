/* Shared detent accumulator for knob pages that step enum-style values.
 * One detent = DETENT_DIV raw delta units; partial turns accumulate across
 * calls so the caller reliably gets ±1 per physical click. */

export const DETENT_DIV = 8;

/** Accumulate raw delta for knob `k` into `accum`; return the number of whole
 *  ±1 detents consumed, keeping the remainder in `accum[k]`. `div` is how many
 *  raw units make one detent. A missing slot counts as 0, so a caller may pass a
 *  sparse array keyed by param index rather than pre-sizing one per knob. */
export function countDetents(accum: number[], k: number, delta: number, div = DETENT_DIV): number {
    let rem = (accum[k] ?? 0) + delta;
    let n = 0;
    while (rem >= div)  { rem -= div; n++; }
    while (rem <= -div) { rem += div; n--; }
    accum[k] = rem;
    return n;
}
