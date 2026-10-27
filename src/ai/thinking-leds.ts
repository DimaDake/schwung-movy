/* LEDs while the AI works (design §5.1): everything dark but Back, and a
 * scanner band sweeping the pads — the Power-off rainbow's pace and hardware
 * fade (host/poweroff_show.c: a 240-frame step, fade channel 4), in a colour
 * and shape it can never be mistaken for. */

import { WHITE_BRIGHT } from '../seq/colors.js';
import { ledBudgetTake } from '../seq/led-cache.js';
import { platform } from '../platform/index.js';

export const THINK_STEP_MS = 700;
const FADE_CH = 0x04;
const PAD_FIRST = 68;
const PADS = 32;
const WHITE = 120;
const VIOLET = 21;   // Move palette 1-26 is one turn of the hue wheel

/** One column wide, white head with a violet trail, one column per step. */
export function thinkingPadColour(pad: number, step: number): number {
    const col = pad % 8;
    const head = ((step % 8) + 8) % 8;
    if (col === head) return WHITE;
    if (col === (head + 7) % 8) return VIOLET;
    return 0;
}

let queue: number[][] = [];
let lastStep = -1;

function note(ch: number, n: number, c: number): number[] { return [0x09, 0x90 | ch, n, c]; }

/** Blank every LED except Back, then let the sweep take the pads. */
export function thinkingLedsStart(): void {
    queue = [];
    lastStep = -1;
    for (let n = 0; n < 128; n++) if (n < PAD_FIRST || n >= PAD_FIRST + PADS) queue.push(note(0, n, 0));
    for (let cc = 0; cc < 128; cc++) queue.push([0x0B, 0xB0, cc, cc === MoveBack ? WHITE_BRIGHT : 0]);
}

export function thinkingLedsTick(elapsedMs: number): void {
    const step = Math.floor(elapsedMs / THINK_STEP_MS);
    if (step !== lastStep) {
        /* The fade's start colour first, then its target on the fade channel. */
        for (let p = 0; p < PADS; p++) queue.push(note(0, PAD_FIRST + p, thinkingPadColour(p, step - 1)));
        for (let p = 0; p < PADS; p++) queue.push(note(FADE_CH, PAD_FIRST + p, thinkingPadColour(p, step)));
        lastStep = step;
    }
    while (queue.length && ledBudgetTake()) platform.surfaceSend(queue.shift()!);
}
