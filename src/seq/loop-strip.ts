/* Loop Overview strip and its playhead — the bar indicator at the bottom of
 * the screen, which the loop-mode note view (note-view.ts) lines up with. */

import { W } from '../renderer/layout.js';
import { loopBarCount, loopEndBar, loopStartBar, seqState } from './state.js';
import { NUM_STEP_BUTTONS } from './constants.js';

const TICKS_PER_STEP = 24; // mirror of seq-core

/* Continuous playhead x within the active window: fraction of the LOOP elapsed.
 * `loopStartTick` is required, not optional — posTick is absolute (seq-core seeds
 * it from loop_start_ticks), and the caller that forgot to subtract the window
 * origin pinned the sweep to the right edge for a whole mid-clip loop. */
export function playheadX(posTick: number, loopStartTick: number, lenSteps: number, stripW: number): number {
    const lenTicks = Math.max(lenSteps, 16) * TICKS_PER_STEP;
    if (lenTicks <= 0) return 0;
    const x = Math.round(((posTick - loopStartTick) / lenTicks) * stripW);
    return Math.max(0, Math.min(x, stripW - 1));
}

/* Loop Overview strip: one segment per bar at the very bottom of the display —
 * thick = selected bar (thin if the loop is a single bar), thin = in-loop bar, a
 * small "+" = a bar outside the loop (the navigable empty bar), and a vertical
 * line sweeps across at the play position. Drawn over the param view; a toast
 * temporarily covers it. */
const STRIP_Y = 62; // baseline row (display is 64 tall)

/* The bars the strip shows: the ACTIVE window, extended to reach the selected
 * bar when the user has navigated outside it. Shared with the loop-mode note
 * view so its bars sit exactly over the strip's segments. */
export function stripWindow(): { fromBar: number; bars: number; segW: number } {
    const from = Math.min(loopStartBar(), seqState.barOffset);
    const to = Math.max(loopEndBar(), seqState.barOffset);
    const bars = to - from + 1;
    return { fromBar: from, bars, segW: Math.max(3, Math.floor(W / bars)) };
}

export function drawLoopStrip(): void {
    // Clear the strip band so the sweep doesn't leave trails.
    fill_rect(0, STRIP_Y - 2, W, 4, 0);
    // No clip in the current slot → no bar line at all (clipBars() floors to 1,
    // so guard on the real emptiness signal).
    if (seqState.lenSteps === 0) return;
    /* Absolute bar indices throughout — the loop can start anywhere, and
     * reading lenSteps as a bar count drew the segments at bars 1..N while the
     * loop played somewhere else entirely. */
    const first = loopStartBar();
    const last = loopEndBar();
    const { fromBar: from, bars: view, segW } = stripWindow();
    const to = from + view - 1;
    const single = first === last;

    for (let bar = from; bar <= to; bar++) {
        const x0 = (bar - from) * segW;
        const cx = x0 + Math.floor(segW / 2);
        if (bar >= first && bar <= last) {
            const selected = bar === seqState.barOffset;
            const thick = selected && !single;
            fill_rect(x0 + 1, thick ? STRIP_Y - 1 : STRIP_Y, segW - 2, thick ? 2 : 1, 1);
        } else {
            // "+" marker for a bar outside the loop (navigated into).
            fill_rect(cx - 1, STRIP_Y, 3, 1, 1);
            fill_rect(cx, STRIP_Y - 1, 1, 3, 1);
        }
    }

    const px = stripPlayheadX();
    if (px >= 0) fill_rect(px, STRIP_Y - 2, 1, 4, 1);
}

/* Playhead sweep x on screen: continuous, confined to the active window's
 * segments; -1 when stopped. The note view draws its playhead at the same x. */
export function stripPlayheadX(): number {
    if (!seqState.playing || seqState.lenSteps === 0) return -1;
    const first = loopStartBar();
    const { fromBar, segW } = stripWindow();
    return (first - fromBar) * segW + playheadX(seqState.posTick,
        first * NUM_STEP_BUTTONS * TICKS_PER_STEP, seqState.lenSteps, loopBarCount() * segW);
}

