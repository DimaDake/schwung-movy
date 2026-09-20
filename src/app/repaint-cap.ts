/* repaint-cap.ts — once "is anything still animating?" has said yes for
 * longer than any real transition can run, stop asking every tick and ask
 * on a bounded schedule instead.
 *
 * SP-48. `page.animating()` (schwung-page-anim.ts) answers true for the
 * whole 100-300ms a real enum/waveform/trigger transition draws itself out —
 * that is SP-38, working as designed. But the same predicate also answers
 * true, FOREVER, for a modulated/`live`/automated key: `anim_state.settled()`
 * re-stamps every time the driven value differs from its last observation
 * (page_controller.mjs:2344/4148, render_page_movy.mjs:2441), and anything
 * moving faster than ~8Hz never lets 120ms of quiet accumulate. Patching
 * that is an upstream fix (SU-11, per-key duration aging in
 * `anim_state.mjs`) that rule 1 forbids touching from here, so this is the
 * movy-side fallback: bound the cost instead of eliminating the cause.
 *
 * A FLAT cap on every `animating()`-true tick would also throttle the three
 * real one-shot transitions SP-38 exists to make smooth — reintroducing the
 * regression SP-38 fixed. So this escalates instead of capping outright:
 * unthrottled for `graceMs` (comfortably longer than any real transition),
 * then bounded to one ask per `capMs` for as long as `animating()` keeps
 * saying true past that point. `graceMs` > `BTN_FLASH_MS` (300ms, the
 * longest of the four known transition constants) is what makes "provably
 * never entered by a legitimate animation" true rather than assumed.
 *
 * Pure given `now` — no clock, no page, no anim store — so it is tested as
 * a plain state machine in `browser-test/logic/page-freshness.mjs`.
 */
export const ANIM_GRACE_MS = 500;   // > BTN_FLASH_MS (300, the longest known transition)
export const REPAINT_CAP_MS = 200;  // degrades to 5Hz once past the grace window

export function createRepaintCap(graceMs = ANIM_GRACE_MS, capMs = REPAINT_CAP_MS) {
    let since = -1;      // when the CURRENT animating streak started, or -1
    let lastFrame = -1;  // last tick this cap itself allowed through

    /** `animating`: page.animating(now)'s answer this tick. `now`: the same
     *  clock the caller already has (movy's Date.now(), or a synthetic one
     *  in tests). Returns whether THIS predicate alone should ask for a frame. */
    return function repaintCap(animating: boolean, now: number): boolean {
        if (!animating) { since = -1; return false; }
        if (since < 0) since = now;
        if (now - since <= graceMs) return true;          // unthrottled: SP-38's behaviour
        if (now - lastFrame < capMs) return false;         // capped: bounded, not zero
        lastFrame = now;
        return true;
    };
}
