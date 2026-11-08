/* The big toast a frozen track answers an edit with (seq/freeze.ts
 * `freezeGuard`, the engine's `frzr`, a knob touch or a jog press): which track
 * is frozen and how to bring it back. The frozen screen itself carries no
 * instruction text, so this is the one place the way out is said. */

const TOAST_MS = 1500;

let track = -1;
let until = 0;

export function showFreezeToast(t: number, nowMs = Date.now()): void {
    track = t;
    until = nowMs + TOAST_MS;
}

/** The track the toast names while it is up, else -1. */
export function freezeToastTrack(nowMs = Date.now()): number {
    return nowMs < until ? track : -1;
}

export function resetFreezeToast(): void {
    track = -1;
    until = 0;
}
