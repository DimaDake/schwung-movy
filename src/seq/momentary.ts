/* Generic momentary view-switch. A button-down shows the target view
 * immediately; the release decides what sticks:
 *   - HOLD (>= HOLD_MS) or a modifier-gesture happened while held  → revert
 *     to the prior state (temporary peek / modifier use); restore() runs.
 *   - clean quick TAP, nothing done while held                     → 'tap';
 *     the caller latches (or toggles off if it was already in the view).
 * One active button at a time. The *At variants take an explicit timestamp
 * (ms) for testability; the plain variants read Date.now().
 *
 * The threshold is wall-clock, not tick-counted: the device tick rate is not a
 * stable constant (it has run ~94 Hz and ~205 Hz across schwung builds), so a
 * tick-based hold window silently changes length when the rate moves. A track
 * switch is a sub-second tap; a hold-to-peek is a deliberate ~1 s press. */

const HOLD_MS = 500;

let active: { button: number; pressMs: number; restore: () => void; gestured: boolean } | null = null;

export function momentaryDownAt(button: number, nowMs: number, restore: () => void): void {
    active = { button, pressMs: nowMs, restore, gestured: false };
}

/* Mark the in-progress momentary as a modifier use (wheel resize, clip launch,
 * bar select while held) so its release reverts instead of latching. No-op when
 * no momentary is active. */
export function momentaryGesture(): void {
    if (active) active.gestured = true;
}

export function momentaryUpAt(button: number, nowMs: number): 'revert' | 'tap' | 'none' {
    if (!active || active.button !== button) return 'none';
    const revert = active.gestured || nowMs - active.pressMs >= HOLD_MS;
    const restore = active.restore;
    active = null;
    if (revert) {
        restore();
        return 'revert';
    }
    return 'tap';
}

export function momentaryDown(button: number, restore: () => void): void {
    momentaryDownAt(button, Date.now(), restore);
}

export function momentaryUp(button: number): 'revert' | 'tap' | 'none' {
    return momentaryUpAt(button, Date.now());
}

export function resetMomentary(): void {
    active = null;
}
