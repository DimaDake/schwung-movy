/* Shift + HOLD Step 16 = Smart Quantize (design §2). The hold is the
 * protection against accidents: nothing shows for 300 ms (so a plain tap,
 * which still cycles quantize on release, never blinks), then a bar fills
 * for a second and the request goes when it is full. Letting go of Step 16
 * or Shift before that cancels without a trace. */

export const HOLD_SHOW_MS = 300;
export const HOLD_FULL_MS = 1300;

let downAt = -1;
let fired = false;

export function hold16Press(now: number): void { downAt = now; fired = false; }
/** A press whose release still belongs to this gesture (fired or not). */
export function hold16Pending(): boolean { return downAt >= 0; }

/** What the release means: a tap, a cancelled hold, or nothing left to do. */
export function hold16Release(now: number): 'quantize' | 'cancel' | 'none' {
    if (downAt < 0) return 'none';
    const held = now - downAt;
    downAt = -1;
    if (fired) return 'none';
    return held < HOLD_SHOW_MS ? 'quantize' : 'cancel';
}

/** Per tick while held. Shift lifted AFTER the hold became visible cancels;
 *  lifted before, the press is still a tap and its release decides. */
export function hold16Tick(now: number, shiftHeld: boolean, start: () => void): void {
    if (downAt < 0 || fired) return;
    const held = now - downAt;
    if (!shiftHeld && held >= HOLD_SHOW_MS) { downAt = -1; return; }
    if (held >= HOLD_FULL_MS) { fired = true; start(); }
}

/** 0..1 while the bar shows, -1 while it must not. */
export function hold16Progress(now: number): number {
    if (downAt < 0 || fired) return -1;
    const held = now - downAt;
    if (held < HOLD_SHOW_MS) return -1;
    return Math.min(1, (held - HOLD_SHOW_MS) / (HOLD_FULL_MS - HOLD_SHOW_MS));
}

export function resetHold16(): void { downAt = -1; fired = false; }
