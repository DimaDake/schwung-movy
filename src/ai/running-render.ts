/* The screen while the AI works (design §5.1): what it is doing, an
 * indeterminate progress bar, the seconds so far, and the one way out. */

import { fontPrint, fontWidth } from '../font/index.js';
import { W } from '../renderer/layout.js';

const BAR_Y = 34;
const BAR_W = 24;

let drawnKey = '';

function centre(y: number, s: string): void { fontPrint(Math.floor((W - fontWidth(s)) / 2), y, s, 1); }

/** Repaints only when a visible value moves (every ~100 ms). */
export function drawAiRunning(label: string, elapsedMs: number, force = false): void {
    const frame = Math.floor(elapsedMs / 100);
    const key = label + ':' + frame;
    if (!force && key === drawnKey) return;
    drawnKey = key;
    clear_screen();
    centre(18, label);
    fill_rect(4, BAR_Y, W - 8, 1, 1);
    const x = 4 + (frame * 4) % (W - 8 - BAR_W);
    fill_rect(x, BAR_Y - 2, BAR_W, 5, 1);
    centre(44, Math.floor(elapsedMs / 1000) + ' S');
    centre(56, 'BACK TO CANCEL');
}

export function resetAiRunningDraw(): void { drawnKey = ''; }
