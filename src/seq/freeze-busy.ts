/* A freeze being recorded owns the device (seq/freeze.ts `freezeBusy`).
 *
 * From the confirm until the capture ends, a press of anything but Back is
 * swallowed: Play or Stop cancels the capture in the engine (it needs the
 * clip playing), and on the device three attempts in a row ended that way,
 * looking like a broken freeze. Releases always pass, so nothing held down
 * at the confirm sticks. Every LED but Back goes dark, so the device shows
 * there is one thing left to press; the toast stays up with the progress.
 * The normal painters take the LEDs back on the first tick after
 * (`freezeBusyEnd`). */

import { WHITE_BRIGHT } from './colors.js';
import { cachedSetButtonLED, cachedSetLED, ledCachedButtons, seqLedsInvalidate } from './led-cache.js';
import { NUM_STEP_BUTTONS, PAD_MAX, PAD_MIN, STEP_NOTE_BASE } from './constants.js';

/** `true` = drop this message: a capture is running and it is a press. */
export function freezeSwallows(data: number[]): boolean {
    const type = data[0] & 0xF0, d1 = data[1], d2 = data[2];
    if (type === 0x80 || (type === 0x90 && d2 === 0)) return false;   // releases
    if (type === 0xB0) return !(d2 === 0 || d1 === MoveBack);        // a button up, or Back
    return true;                                                       // presses, aftertouch, bends
}

/** One busy tick's LEDs: dark, Back lit. Budgeted and cached like any frame. */
export function freezeBusyLeds(): void {
    cachedSetButtonLED(MoveBack, WHITE_BRIGHT);
    for (const cc of ledCachedButtons()) if (cc !== MoveBack) cachedSetButtonLED(cc, 0);
    for (let n = STEP_NOTE_BASE; n < STEP_NOTE_BASE + NUM_STEP_BUTTONS; n++) cachedSetLED(n, 0);
    for (let n = PAD_MIN; n <= PAD_MAX; n++) cachedSetLED(n, 0);
}

/** The capture is over: every painter repaints from scratch. */
export function freezeBusyEnd(): void {
    seqLedsInvalidate();
}
