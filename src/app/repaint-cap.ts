/* repaint-cap.ts — a page whose picture never rests is redrawn on a bounded
 * schedule, not every tick.
 *
 * SP-48. A modulated/`live`/automated key moving faster than its transition
 * duration never lets the page settle, and before Schwung 1.5.0 movy could not
 * tell that from a real 100-300 ms transition: `settled()` measures every key
 * against one duration and cannot see a stream. So this used to INFER one — a
 * 500 ms grace window, then a cap.
 *
 * SU-11 (Schwung #543) made it a question the store answers: `activity()`
 * judges each key by the duration it was observed with and reports
 * `{ moving, streaming }`. A transition is `moving` and always draws; only a
 * stream is capped. The cap is still a cap and not a stop: a stream is
 * reported rather than aged out upstream precisely so the host keeps drawing
 * the value as it moves.
 *
 * Pure given `now` — no clock, no page, no anim store — so it is tested as a
 * plain state machine in `browser-test/logic/page-freshness.mjs`.
 */
import type { AnimActivity } from '../renderer/schwung-page-anim.js';

export const REPAINT_CAP_MS = 200;  // a stream redraws at 5Hz

export function createRepaintCap(capMs = REPAINT_CAP_MS) {
    let lastFrame = -Infinity;   // last tick this cap let a STREAM through

    /** Returns whether THIS predicate alone should ask for a frame. `now` is
     *  the caller's clock (movy's Date.now(), or a synthetic one in tests). */
    return function repaintCap(a: AnimActivity, now: number): boolean {
        if (a.moving) return true;
        if (!a.streaming) return false;
        if (now - lastFrame < capMs) return false;
        lastFrame = now;
        return true;
    };
}
