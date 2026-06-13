/* All sequencer LED painting goes through this cached layer: a color is
 * only sent when it differs from the last value sent for that LED, so the
 * per-tick repaint costs nothing on the wire when nothing changed
 * (davebox ui_leds pattern). */

import { C_DARKGREY, C_GREEN, C_WHITE, trackColor, trackColorDim } from './colors.js';
import { CC_PLAY, CC_REC, NUM_STEP_BUTTONS, PAD_MIN, STEP_NOTE_BASE } from './constants.js';
import { sessionPaintGrid } from './session.js';
import { loopEndBar, loopStartBar, occHasStep, seqState } from './state.js';

const C_RED = 1;        // BrightRed — recording
const C_RED_DIM = 67;   // dim red — armed / count-in off-phase

/* A coarse blink phase from the engine tick, for flashing LEDs. */
function blinkOn(): boolean {
    return Math.floor(seqState.engineTick / 24) % 2 === 0;
}

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

function barHasContent(bar: number): boolean {
    const base = bar * NUM_STEP_BUTTONS;
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        if (occHasStep(base + i)) return true;
    }
    return false;
}

/* Loop Mode: step buttons are bars (manual §12.1) — white = bar in the loop
 * window, track color = bar with content outside the loop, dim gray = empty
 * bar outside, green = the bar the playhead is in while playing. */
function paintLoopBars(): void {
    const start = loopStartBar();
    const end = loopEndBar();
    const playBar = seqState.playing ? Math.floor(seqState.curStep / NUM_STEP_BUTTONS) : -1;
    const inLoopCol = trackColor(seqState.watchTrack);
    for (let bar = 0; bar < NUM_STEP_BUTTONS; bar++) {
        let color: number;
        if (bar === playBar) {
            color = C_GREEN;
        } else if (bar >= start && bar <= end) {
            color = C_WHITE;
        } else if (barHasContent(bar)) {
            color = inLoopCol;
        } else {
            color = C_DARKGREY;
        }
        cachedSetLED(STEP_NOTE_BASE + bar, color);
    }
}

/* Transport button LEDs: Play lit while running; Rec solid red while
 * recording, flashing red during the count-in, dim otherwise. */
function paintTransport(): void {
    cachedSetButtonLED(CC_PLAY, seqState.playing ? C_WHITE : C_DARKGREY);
    let rec: number;
    if (seqState.recording) {
        rec = C_RED;
    } else if (seqState.countingIn) {
        rec = blinkOn() ? C_RED : C_RED_DIM;
    } else {
        rec = C_RED_DIM;
    }
    cachedSetButtonLED(CC_REC, rec);
}

export function seqLedsTick(): void {
    // Session mode owns the 32-pad clip grid (cached).
    if (seqState.sessionMode) {
        sessionPaintGrid(cachedSetLED, PAD_MIN);
    }
    if (seqState.loopMode) {
        paintLoopBars();
        paintTransport();
        return;
    }
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

    paintTransport();
}
