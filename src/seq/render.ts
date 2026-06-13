/* Minimal sequencer screen overlay: short toasts ("Bar 2", confirmations)
 * drawn over the param view, where native firmware shows them. The full
 * Loop Overview strip lands in Step 10; this is just the toast plumbing the
 * earlier steps need.
 *
 * Ownership: app/tick.ts decides redraws. seqToastActive() lets it keep the
 * frame alive while a toast shows; seqToastTick() ages it and reports when
 * the toast just expired so tick.ts can repaint the clean view once. */

import { drawJogToast } from '../renderer/overlay.js';

const DEFAULT_TTL = 60; // ticks (~0.3s at the ~196 Hz device rate)

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
