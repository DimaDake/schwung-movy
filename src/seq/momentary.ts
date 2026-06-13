/* Generic momentary view-switch. A button-down shows the target view
 * immediately; the release decides what sticks:
 *   - HOLD (>= HOLD_TICKS) or a modifier-gesture happened while held  → revert
 *     to the prior state (temporary peek / modifier use); restore() runs.
 *   - clean quick TAP, nothing done while held                       → 'tap';
 *     the caller latches (or toggles off if it was already in the view).
 * One active button at a time. The *At variants take an explicit tick for
 * testability; the plain variants read uiTick(). */

import { uiTick } from './engine.js';

const HOLD_TICKS = 28; // ~300 ms at the ~94 Hz device tick rate

let active: { button: number; pressTick: number; restore: () => void; gestured: boolean } | null = null;

export function momentaryDownAt(button: number, now: number, restore: () => void): void {
    active = { button, pressTick: now, restore, gestured: false };
}

/* Mark the in-progress momentary as a modifier use (wheel resize, clip launch,
 * bar select while held) so its release reverts instead of latching. No-op when
 * no momentary is active. */
export function momentaryGesture(): void {
    if (active) active.gestured = true;
}

export function momentaryUpAt(button: number, now: number): 'revert' | 'tap' | 'none' {
    if (!active || active.button !== button) return 'none';
    const revert = active.gestured || now - active.pressTick >= HOLD_TICKS;
    const restore = active.restore;
    active = null;
    if (revert) {
        restore();
        return 'revert';
    }
    return 'tap';
}

export function momentaryDown(button: number, restore: () => void): void {
    momentaryDownAt(button, uiTick(), restore);
}

export function momentaryUp(button: number): 'revert' | 'tap' | 'none' {
    return momentaryUpAt(button, uiTick());
}

export function resetMomentary(): void {
    active = null;
}
