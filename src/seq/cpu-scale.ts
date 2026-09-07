/* The CPU page's vertical scale: how many microseconds a full-height column is
 * worth, and how that number is labelled.
 *
 * Its own file because it is the page's one piece of policy — every rule here is
 * about what makes a column comparable across sessions, not about what the
 * engine reported. Pure, so all of it is assertable without a view model.
 */

import type { CpuColumn } from './cpu-page-vm.js';

/** The column scale's FLOOR, microseconds per block.
 *
 *  Free auto-ranging would make a column legible on any set and comparable on
 *  none — not between sessions, and not across the CPU Optimize flag, which is
 *  the one comparison the page exists to make. So the scale does not follow the
 *  set downward: it sits at 1 ms, which is round and fits almost every chain the
 *  fleet has measured, and only ever grows. */
export const FULL_SCALE_US = 1000;

/** Steps the scale may take, once 1 ms is not enough.
 *
 *  A ladder rather than "round up to the next 100 us" so the number under the
 *  plot stays a number you can hold in your head, and so the plot does not
 *  re-scale by a hair every time a peak creeps up. */
const SCALE_LADDER = [FULL_SCALE_US, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 9000];

/** The scale this set needs, driven by the BARS — the settled means.
 *
 *  Explicitly NOT the held peaks, which was the first thing tried and is wrong:
 *  a peak is a single worst block, and loading a chain costs several
 *  milliseconds in `dlopen` and first-block allocation. On device that one
 *  transient took the scale to 5 ms and squashed every real column to nothing
 *  for the rest of the viewing — the same failure a fixed scale had, in reverse.
 *  The bar is what you read continuously, so the bar is what the plot fits.
 *
 *  A peak past the top is not lost: it clamps and its column says so with the
 *  detached cap. That is the ordinary bargain of a level meter — the scale
 *  follows the sustained level and the peak indicator clips.
 *
 *  Rises only, so it needs no hysteresis and no state of its own: a settled
 *  mean does not oscillate across a ladder step the way a peak does, and the
 *  ladder's gaps absorb what drift there is. */
export function scaleFor(columns: CpuColumn[], sends: CpuColumn[] = []): number {
    let worst = 0;
    for (const c of columns) {
        if (c.totalUs > worst) worst = c.totalUs;
    }
    /* The sends are on the same scale as the tracks, so they have to be allowed
     * to set it. A reverb is routinely the most expensive thing in a set, and
     * left out of this it would sit clamped at full scale for the whole viewing
     * — reading as "at the limit" when it IS the limit. */
    for (const c of sends) {
        if (c.totalUs > worst) worst = c.totalUs;
    }
    for (const step of SCALE_LADDER) {
        if (worst <= step) return step;
    }
    return SCALE_LADDER[SCALE_LADDER.length - 1];
}

/** The scale as the label under the plot draws it: `1MS`, `1.5MS`, `2MS`. */
export function scaleLabel(scaleUs: number): string {
    const ms = scaleUs / 1000;
    return (Number.isInteger(ms) ? String(ms) : ms.toFixed(1)) + 'MS';
}
