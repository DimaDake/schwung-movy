/* Minimal sequencer screen overlay: short toasts and the header announcement
 * band drawn over the param view, plus the Loop Overview strip.
 *
 * Ownership: app/tick.ts decides redraws. seqToastActive/seqHeaderActive let
 * it keep the frame alive while content is showing; *Tick() ages them. */

import { drawJogToast } from '../renderer/overlay.js';
import { W } from '../renderer/layout.js';
import { fontPrint } from '../font/index.js';
import { clipBars, seqState } from './state.js';

const TICKS_PER_STEP = 24; // mirror of seq-core

/* Continuous playhead x within the strip: fraction of the clip elapsed. */
export function playheadX(posTick: number, lenSteps: number, stripW: number): number {
    const lenTicks = Math.max(lenSteps, 16) * TICKS_PER_STEP;
    if (lenTicks <= 0) return 0;
    const x = Math.round((posTick / lenTicks) * stripW);
    return Math.max(0, Math.min(x, stripW - 1));
}

const DEFAULT_TTL = 60; // ticks (~0.3s at the ~196 Hz device rate)

/* Header announcement: a short inverted band at the top of the screen for
 * view-switch notifications (Note/Session/Loop). Placed at the top so it
 * never covers the bottom loop/bar strip. */
let headerText = '';
let headerTtl = 0;

export function seqHeaderAnnounce(msg: string, ttlTicks: number = DEFAULT_TTL): void {
    headerText = msg;
    headerTtl = ttlTicks;
}

export function seqHeaderActive(): boolean { return headerTtl > 0; }

export function seqHeaderTick(): void {
    if (headerTtl > 0) headerTtl--;
}

export function drawSeqHeader(): void {
    if (headerTtl <= 0) return;
    fill_rect(0, 0, W, 9, 1);              // inverted header band
    fontPrint(2, 1, headerText, 0);
}

export function resetSeqHeader(): void { headerText = ''; headerTtl = 0; }

/* Loop Overview strip (manual §12.1): one segment per bar at the very bottom
 * of the display — thick = selected bar (thin if the loop is a single bar),
 * thin = in-loop bar, a small "+" = a bar outside the loop (the navigable
 * empty bar), and a vertical line sweeps across at the play position. Drawn
 * over the param view; a toast temporarily covers it. */
const STRIP_Y = 62; // baseline row (display is 64 tall)

export function drawLoopStrip(): void {
    // Clear the strip band so the sweep doesn't leave trails.
    fill_rect(0, STRIP_Y - 2, W, 4, 0);
    // No clip in the current slot → no bar line at all (clipBars() floors to 1,
    // so guard on the real emptiness signal).
    if (seqState.lenSteps === 0) return;
    const bars = clipBars();
    // Include the empty bar the user has navigated into, if any.
    const view = Math.max(bars, seqState.barOffset + 1, 1);
    const segW = Math.max(3, Math.floor(W / view));
    const single = bars <= 1;

    for (let i = 0; i < view; i++) {
        const x0 = i * segW;
        const cx = x0 + Math.floor(segW / 2);
        if (i < bars) {
            const selected = i === seqState.barOffset;
            const thick = selected && !single;
            fill_rect(x0 + 1, thick ? STRIP_Y - 1 : STRIP_Y, segW - 2, thick ? 2 : 1, 1);
        } else {
            // "+" marker for an out-of-loop bar.
            fill_rect(cx - 1, STRIP_Y, 3, 1, 1);
            fill_rect(cx, STRIP_Y - 1, 1, 3, 1);
        }
    }

    // Playhead sweep: smooth continuous tick position across the full strip.
    if (seqState.playing) {
        const px = playheadX(seqState.posTick, seqState.lenSteps, W);
        fill_rect(px, STRIP_Y - 2, 1, 4, 1);
    }
}

let text = '';
let ttl = 0;

/* Flat toast duration: ~1.5s at the device's ~196 ticks/s. Toasts were too
 * brief to read; every toast now shows for this fixed time regardless of any
 * value a caller passes. */
const TOAST_TTL = 294;

export function seqToast(msg: string): void {
    text = msg;
    ttl = TOAST_TTL;
}

export function seqToastActive(): boolean {
    return ttl > 0;
}

/* Age the toast one tick. Returns true on the tick it expires, so the caller
 * can force one repaint of the underlying view to erase it. */
export function seqToastTick(): boolean {
    if (ttl > 0) {
        ttl--;
        return ttl === 0;
    }
    return false;
}

export function drawSeqToast(): void {
    if (ttl > 0) drawJogToast(text);
}

export function resetSeqToast(): void {
    text = '';
    ttl = 0;
}
