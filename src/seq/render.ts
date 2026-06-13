/* Minimal sequencer screen overlay: short toasts ("Bar 2", confirmations)
 * drawn over the param view, where native firmware shows them. The full
 * Loop Overview strip lands in Step 10; this is just the toast plumbing the
 * earlier steps need.
 *
 * Ownership: app/tick.ts decides redraws. seqToastActive() lets it keep the
 * frame alive while a toast shows; seqToastTick() ages it and reports when
 * the toast just expired so tick.ts can repaint the clean view once. */

import { drawJogToast } from '../renderer/overlay.js';
import { W } from '../renderer/layout.js';
import { clipBars, seqState } from './state.js';

const DEFAULT_TTL = 60; // ticks (~0.3s at the ~196 Hz device rate)

/* Loop Overview strip (manual §12.1): one segment per bar at the very bottom
 * of the display — thick = selected bar (thin if the loop is a single bar),
 * thin = in-loop bar, a small "+" = a bar outside the loop (the navigable
 * empty bar), and a vertical line sweeps across at the play position. Drawn
 * over the param view; a toast temporarily covers it. */
const STRIP_Y = 62; // baseline row (display is 64 tall)

export function drawLoopStrip(): void {
    // Clear the strip band so the sweep doesn't leave trails.
    fill_rect(0, STRIP_Y - 2, W, 4, 0);
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

    // Playhead sweep: a vertical mark in the currently-playing bar.
    if (seqState.playing) {
        const playBar = Math.floor(seqState.curStep / 16);
        if (playBar < view) {
            const px = playBar * segW + Math.floor(segW / 2);
            fill_rect(px, STRIP_Y - 2, 1, 4, 1);
        }
    }
}

let text = '';
let ttl = 0;

export function seqToast(msg: string, ttlTicks: number = DEFAULT_TTL): void {
    text = msg;
    ttl = ttlTicks;
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
