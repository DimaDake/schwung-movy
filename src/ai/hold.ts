/* Shift + HOLD Step 16 = Smart Quantize, Shift + HOLD Step 14 = Variation
 * (design §2, §3), Shift + HOLD Step 15 = Smart Double. The hold is the protection against accidents: a generator
 * only ever starts from a deliberate hold. Nothing shows for 300 ms (so a
 * plain tap never blinks: on Step 16 it still cycles quantize on release,
 * on Step 15 it still doubles the loop),
 * then a bar fills for a second and the request goes when it is full.
 * Letting go of the step or Shift before that cancels without a trace. A
 * press that cannot become a generator (recording, Session view, a Set
 * loading, no clip to vary from) is armed=false: no bar, no request, and its
 * release is a plain tap. */

export type HoldKind = 'quantize' | 'variation' | 'double';

export const HOLD_SHOW_MS = 300;
export const HOLD_FULL_MS = 1300;

const LABELS: Record<HoldKind, string> = { quantize: 'SMART QUANTIZE', variation: 'VARIATION', double: 'SMART DOUBLE' };

let downAt = -1;
let fired = false;
let armed = true;
let kind: HoldKind = 'quantize';

export function holdPress(now: number, k: HoldKind, canHold = true): void {
    downAt = now; fired = false; armed = canHold; kind = k;
}
/** A press whose release still belongs to this gesture (fired or not). */
export function holdPending(): boolean { return downAt >= 0; }
export function holdKind(): HoldKind { return kind; }
export function holdLabel(): string { return LABELS[kind]; }

/** What the release means: a tap, a cancelled hold, or nothing left to do. */
export function holdRelease(now: number): 'tap' | 'cancel' | 'none' {
    if (downAt < 0) return 'none';
    const held = now - downAt;
    downAt = -1;
    if (fired) return 'none';
    return !armed || held < HOLD_SHOW_MS ? 'tap' : 'cancel';
}

/** Per tick while held. Shift lifted AFTER the hold became visible cancels;
 *  lifted before, the press is still a tap and its release decides. */
export function holdTick(now: number, shiftHeld: boolean, start: (k: HoldKind) => void): void {
    if (downAt < 0 || fired || !armed) return;
    const held = now - downAt;
    if (!shiftHeld && held >= HOLD_SHOW_MS) { downAt = -1; return; }
    if (held >= HOLD_FULL_MS) { fired = true; start(kind); }
}

/** 0..1 while the bar shows, -1 while it must not. */
export function holdProgress(now: number): number {
    if (downAt < 0 || fired || !armed) return -1;
    const held = now - downAt;
    if (held < HOLD_SHOW_MS) return -1;
    return Math.min(1, (held - HOLD_SHOW_MS) / (HOLD_FULL_MS - HOLD_SHOW_MS));
}

export function resetHold(): void { downAt = -1; fired = false; }
