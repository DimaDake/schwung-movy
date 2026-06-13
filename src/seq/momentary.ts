/* Generic momentary view-switch: a button-down switches the view immediately;
 * the tap-vs-hold decision is made on release by elapsed ticks. A quick tap
 * latches the switch; a hold (>= HOLD_TICKS) is a temporary peek and the
 * caller-supplied restore() returns the prior state. One active button at a
 * time. The *At variants take an explicit tick for testability; the plain
 * variants read uiTick(). */

import { uiTick } from './engine.js';

const HOLD_TICKS = 28; // ~300 ms at the ~94 Hz device tick rate

let active: { button: number; pressTick: number; restore: () => void } | null = null;

export function momentaryDownAt(button: number, now: number, restore: () => void): void {
    active = { button, pressTick: now, restore };
}

export function momentaryUpAt(button: number, now: number): void {
    if (!active || active.button !== button) return;
    const held = now - active.pressTick >= HOLD_TICKS;
    const restore = active.restore;
    active = null;
    if (held) restore();
}

export function momentaryDown(button: number, restore: () => void): void {
    momentaryDownAt(button, uiTick(), restore);
}

export function momentaryUp(button: number): void {
    momentaryUpAt(button, uiTick());
}

export function resetMomentary(): void {
    active = null;
}
