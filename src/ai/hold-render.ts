/* The generator hold bar in the bottom band: it fills as the hold
 * nears the point where the request goes. Drawn every tick it shows (the
 * value moves every tick); when it goes away the view repaints under it. */

import { appState } from '../app/state.js';
import { W, TOAST_Y, TOAST_H } from '../renderer/layout.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { holdLabel, holdProgress } from './hold.js';

let shown = false;

export function drawHoldProgress(frac: number, label = holdLabel()): void {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);
    fontPrint(2, TOAST_Y + 1, label, 0);
    const x0 = 6 + fontWidth(label);
    const w = W - x0 - 2;
    fill_rect(x0, TOAST_Y + 1, w, TOAST_H - 2, 0);
    fill_rect(x0 + 1, TOAST_Y + 2, Math.round((w - 2) * frac), TOAST_H - 4, 1);
}

export function holdProgressTick(now: number): void {
    const f = holdProgress(now);
    if (f < 0) {
        if (shown) { shown = false; appState.dirty = true; }
        return;
    }
    shown = true;
    drawHoldProgress(f);
}
