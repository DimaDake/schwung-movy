/* Sequencer LED painting through a cached diff layer — only changed colors
 * are sent, so unchanged frames cost nothing on the wire (davebox pattern). */

import { backLedColor, arrowLedColor, sampleLedColor, captureLedColor, undoLedColor } from './buttons.js';
import { C_BLACK, C_DARKGREY, C_GREEN, C_WHITE, WHITE_BRIGHT, WHITE_DIM, WHITE_OFF, trackColor, trackColorDim } from './colors.js';
import {
    CC_PLAY, CC_REC, CC_TRACK_END, NUM_STEP_BUTTONS, PAD_MIN, STEP_NOTE_BASE,
} from './constants.js';
import { sessionPaintGrid } from './session.js';
import { loopEndBar, loopStartBar, occHasStep, seqState } from './state.js';

const C_RED = 1;  // BrightRed — recording

/* CC addresses for non-step buttons (MoveCCButtons). */
const CC_BACK = 51, CC_CAPTURE = 52, CC_UNDO = 56, CC_LOOP = 58,
      CC_COPY = 60, CC_LEFT = 62, CC_RIGHT = 63, CC_MUTE = 88,
      CC_SAMPLE = 118, CC_DELETE_BTN = 119;

const STEP_ICON_CC_BASE = 16; // step-icon LEDs are CC 16..31 (printed icons under each step)

/* Step-icon slot indices (0-based) for the latched shortcut features. */
const ICON_METRO = 5;     // step 6
const ICON_FULLVEL = 9;   // step 10
const ICON_DBLLOOP = 14;  // step 15
const ICON_QUANT = 15;    // step 16

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

// No per-tick allocation: derive blink from engine tick integer division.
function blinkPhase(): boolean { return Math.floor(seqState.engineTick / 24) % 2 === 0; }

interface BarCtx { isPlayhead: boolean; selected: boolean; hasContent: boolean; inLoop: boolean; blink: boolean; track: number; }

export function loopBarColor(c: BarCtx): number {
    if (c.isPlayhead) return C_GREEN;                                   // playhead while playing
    if (c.selected)   return C_WHITE;                                   // selected bar
    if (c.hasContent) return c.blink ? trackColor(c.track) : C_BLACK;  // content bars blink track color
    return C_BLACK;                                                     // empty/out-of-loop
}

/* Loop Mode: step buttons are bars — selected white, content blink track color, playhead green. */
function paintLoopBars(): void {
    const start = loopStartBar();
    const end = loopEndBar();
    const playBar = seqState.playing ? Math.floor(seqState.curStep / NUM_STEP_BUTTONS) : -1;
    const blink = blinkPhase();
    for (let bar = 0; bar < NUM_STEP_BUTTONS; bar++) {
        cachedSetLED(STEP_NOTE_BASE + bar, loopBarColor({
            isPlayhead: bar === playBar,
            selected: bar === seqState.barOffset,
            hasContent: barHasContent(bar),
            inLoop: bar >= start && bar <= end,
            blink, track: seqState.watchTrack,
        }));
    }
}

export function transportPlayColor(playing: boolean): number {
    return playing ? C_GREEN : C_DARKGREY;
}

export function transportRecColor(recording: boolean): number {
    return recording ? C_RED : C_DARKGREY;
}

/* Transport button LEDs: Play green while running; Rec red while recording. */
function paintTransport(): void {
    cachedSetButtonLED(CC_PLAY, transportPlayColor(seqState.playing));
    cachedSetButtonLED(CC_REC, transportRecColor(seqState.recording));
}

/* Step-icon LEDs are CC 16..31 (the printed icons under each step), separate
 * from the step buttons' RGB LEDs at notes 16..31. They show latched feature
 * state, and — while Shift is held — the full set of combinable shortcuts. */
interface IconCtx { shift: boolean; metro: boolean; fullVel: boolean; }

export function stepIconColor(idx: number, c: IconCtx): number {
    const active = (idx === ICON_METRO && c.metro) || (idx === ICON_FULLVEL && c.fullVel);
    if (active) return WHITE_BRIGHT;
    if (c.shift && (idx === ICON_METRO || idx === ICON_FULLVEL
                    || idx === ICON_DBLLOOP || idx === ICON_QUANT)) {
        return WHITE_DIM;
    }
    return WHITE_OFF;
}

function paintStepIcons(shift: boolean): void {
    const ctx = { shift, metro: seqState.metro, fullVel: seqState.fullVelocity };
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        cachedSetButtonLED(STEP_ICON_CC_BASE + i, stepIconColor(i, ctx));
    }
}

/* Track buttons (CC 40..43; CC 43 = track 0). Base = the track color so they
 * match the chromatic root; a sounding note on that track flashes it white;
 * muted track dims to the track's dim color so it's visually "off". */
export function trackButtonColor(track: number, active: boolean, muted: boolean): number {
    if (active) return C_WHITE;          // sounding note wins (full brightness)
    return muted ? trackColorDim(track) : trackColor(track);
}

function trackHasActiveNote(track: number): boolean {
    const base = track * 128;
    for (let p = 0; p < 128; p++) if (seqState.activeNotes[base + p]) return true;
    return false;
}

function paintTrackButtons(): void {
    for (let t = 0; t < 4; t++) {
        const cc = CC_TRACK_END - t; // CC 43 = track 0
        cachedSetButtonLED(cc, trackButtonColor(t, trackHasActiveNote(t), seqState.muted[t]));
    }
}

function paintAffordances(view: number, barOffset: number, maxOff: number, lp: boolean, rp: boolean): void {
    cachedSetButtonLED(CC_BACK,   backLedColor(view));
    cachedSetButtonLED(CC_LEFT,   arrowLedColor(-1, barOffset, maxOff, lp));
    cachedSetButtonLED(CC_RIGHT,  arrowLedColor(+1, barOffset, maxOff, rp));
    cachedSetButtonLED(CC_SAMPLE, sampleLedColor());
    cachedSetButtonLED(CC_CAPTURE, captureLedColor());
    cachedSetButtonLED(CC_UNDO,   undoLedColor());
    // Functional buttons always dim; Loop bright in Loop Mode.
    cachedSetButtonLED(CC_LOOP, seqState.loopMode ? WHITE_BRIGHT : WHITE_DIM);
    cachedSetButtonLED(CC_COPY, WHITE_DIM); cachedSetButtonLED(CC_DELETE_BTN, WHITE_DIM); cachedSetButtonLED(CC_MUTE, WHITE_DIM);
}

/* Worst-case cold frame: ~29 CC + up to 8 pad packets < 60-packet buffer.
 * Do not raise LED_INIT_BATCH past 8 without rechecking this. */
export function seqLedsTick(
    shiftHeld: boolean = false,
    currentView: number = 0,
    barOffset: number = 0,
    maxOff: number = 0,
): void {
    // Session mode owns the 32-pad clip grid (cached).
    if (seqState.sessionMode) {
        sessionPaintGrid(cachedSetLED, PAD_MIN);
    }
    paintTrackButtons();
    paintStepIcons(shiftHeld);
    paintAffordances(currentView, barOffset, maxOff, false, false);  // lp/rp: never pressed in tick path
    if (seqState.loopMode) {
        paintLoopBars();
        paintTransport();
        return;
    }
    const bar = seqState.barOffset;
    const base = bar * NUM_STEP_BUTTONS;

    /* Step-row: white=notes, dim-track=in-loop, dim-gray=out-of-loop, green=playhead */
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
