/* All sequencer LED painting goes through this cached layer: a color is
 * only sent when it differs from the last value sent for that LED, so the
 * per-tick repaint costs nothing on the wire when nothing changed
 * (davebox ui_leds pattern). */

import { C_DARKGREY, C_GREEN, C_WHITE, trackColorDim } from './colors.js';
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

export function seqLedsTick(): void {
    const bar = seqState.barOffset;
    const base = bar * NUM_STEP_BUTTONS;

    /* Step-row semantics (manual §9.5):
     *   white            = step has note(s)
     *   dim track color  = empty step inside the loop
     *   dim gray         = empty clip / bar outside the loop
     *   green (playhead)  = current play position while playing  */
    const playStep = seqState.playing ? seqState.curStep : -1;
    const dimTrack = trackColorDim(seqState.watchTrack);

    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        const step = base + i;
        let color: number;
        if (step === playStep) {
            color = C_GREEN;
        } else if (occHasStep(step)) {
            color = C_WHITE;
        } else if (seqState.lenSteps > 0 && step < seqState.lenSteps) {
            color = dimTrack;
        } else {
            color = C_DARKGREY;
        }
        cachedSetLED(STEP_NOTE_BASE + i, color);
    }

    cachedSetButtonLED(CC_PLAY, seqState.playing ? C_WHITE : C_DARKGREY);
}
