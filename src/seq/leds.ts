/* All sequencer LED painting goes through this cached layer: a color is
 * only sent when it differs from the last value sent for that LED, so the
 * per-tick repaint costs nothing on the wire when nothing changed
 * (davebox ui_leds pattern). */

import { CC_PLAY, NUM_STEP_BUTTONS, STEP_NOTE_BASE } from './constants.js';
import { occHasStep, seqState } from './state.js';

const lastNoteLed = new Map<number, number>();
const lastButtonLed = new Map<number, number>();

function cachedSetLED(note: number, color: number): void {
    if (lastNoteLed.get(note) !== color) {
        lastNoteLed.set(note, color);
        setLED(note, color, true);
    }
}

function cachedSetButtonLED(cc: number, color: number): void {
    if (lastButtonLed.get(cc) !== color) {
        lastButtonLed.set(cc, color);
        setButtonLED(cc, color, true);
    }
}

/* Forget everything sent — next tick repaints all sequencer LEDs. Use after
 * anything that may have clobbered LED hardware state. */
export function seqLedsInvalidate(): void {
    lastNoteLed.clear();
    lastButtonLed.clear();
}

export function seqLedsTick(barOffset: number): void {
    /* Step row: basic semantics (full native color set lands in Step 3) —
     * white = has notes, dim = empty step inside the loop, off = outside
     * the loop / empty clip, green = playhead while playing. */
    const playheadVisible = seqState.playing
        && seqState.curStep >= barOffset * NUM_STEP_BUTTONS
        && seqState.curStep < (barOffset + 1) * NUM_STEP_BUTTONS;
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        const step = barOffset * NUM_STEP_BUTTONS + i;
        let color: number;
        if (playheadVisible && step === seqState.curStep) {
            color = NeonGreen;
        } else if (occHasStep(step)) {
            color = White;
        } else if (step < seqState.lenSteps) {
            color = DarkGrey;
        } else {
            color = Black;
        }
        cachedSetLED(STEP_NOTE_BASE + i, color);
    }

    cachedSetButtonLED(CC_PLAY, seqState.playing ? White : DarkGrey);
}
