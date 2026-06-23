/* Sequencer LED painting through a cached diff layer — only changed colors
 * are sent, so unchanged frames cost nothing on the wire (davebox pattern). */

import { backLedColor, arrowLedColor, sampleLedColor, captureLedColor, undoLedColor } from './buttons.js';
import { C_BLACK, C_DARKGREY, C_GREEN, C_LIGHTGREY, C_REC_RED, C_WHITE, WHITE_BRIGHT, WHITE_DIM, WHITE_OFF, trackColor, trackColorDim } from './colors.js';
import {
    CC_PLAY, CC_REC, CC_TRACK_END, NUM_STEP_BUTTONS, PAD_MIN, STEP_NOTE_BASE,
} from './constants.js';
import { mainPageActive } from './main-page.js';
import { sessionPaintGrid } from './session.js';
import { loopEndBar, loopStartBar, occHasStep, seqState } from './state.js';
import { cachedSetLED, cachedSetButtonLED, cachedSetAnimLED, ledFrameReset, seqLedsInvalidate } from './led-cache.js';

/* Re-exported so callers keep importing the LED API from one place. */
export { seqLedsInvalidate, cachedSetAnimLED, ledFrameReset };

/* CC addresses for non-step buttons (MoveCCButtons). */
const CC_BACK = 51, CC_CAPTURE = 52, CC_UNDO = 56, CC_LOOP = 58,
      CC_COPY = 60, CC_LEFT = 62, CC_RIGHT = 63, CC_MUTE = 88,
      CC_SAMPLE = 118, CC_DELETE_BTN = 119;

const STEP_ICON_CC_BASE = 16; // step-icon LEDs = CC 16..31
// Step-icon slot indices (0-based) for the latched shortcut features.
const ICON_METRO = 5, ICON_FULLVEL = 9, ICON_DBLLOOP = 14, ICON_QUANT = 15;
// Steps 5/7/9 (0-based 4/6/8) open the Set Params page.
const ICON_MAIN: readonly number[] = [4, 6, 8];

function barHasContent(bar: number): boolean {
    const b = bar * NUM_STEP_BUTTONS;
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) if (occHasStep(b + i)) return true;
    return false;
}

// No per-tick allocation: derive blink from engine tick integer division.
function blinkPhase(): boolean { return Math.floor(seqState.engineTick / 24) % 2 === 0; }
interface BarCtx { isPlayhead: boolean; selected: boolean; hasContent: boolean; inLoop: boolean; blink: boolean; track: number; }
export function loopBarColor(c: BarCtx): number {
    if (c.isPlayhead) return C_GREEN;
    if (c.selected)   return C_WHITE;
    if (c.hasContent) return c.blink ? trackColor(c.track) : C_BLACK;
    return C_BLACK;
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

export function transportRecColor(recording: boolean, countingIn: boolean): number {
    return (recording || countingIn) ? C_REC_RED : C_DARKGREY;
}

function paintTransport(): void {
    cachedSetButtonLED(CC_PLAY, transportPlayColor(seqState.playing));
    cachedSetButtonLED(CC_REC, transportRecColor(seqState.recording, seqState.countingIn));
}

/* Step-icon LEDs are CC 16..31 (the printed icons under each step), separate
 * from the step buttons' RGB LEDs at notes 16..31. They show latched feature
 * state, and — while Shift is held — the full set of combinable shortcuts. */
interface IconCtx { shift: boolean; metro: boolean; fullVel: boolean; mainPage: boolean; }

export function stepIconColor(idx: number, c: IconCtx): number {
    const active = (idx === ICON_METRO && c.metro) || (idx === ICON_FULLVEL && c.fullVel)
                || (c.mainPage && ICON_MAIN.includes(idx)); // page open → full bright
    if (active) return WHITE_BRIGHT;
    if (c.shift && (idx === ICON_METRO || idx === ICON_FULLVEL
                    || idx === ICON_DBLLOOP || idx === ICON_QUANT
                    || ICON_MAIN.includes(idx))) {            // shift held → available
        return WHITE_DIM;
    }
    return WHITE_OFF;
}

function paintStepIcons(shift: boolean): void {
    const ctx = { shift, metro: seqState.metro, fullVel: seqState.fullVelocity, mainPage: mainPageActive() };
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        cachedSetButtonLED(STEP_ICON_CC_BASE + i, stepIconColor(i, ctx));
    }
}

// Track buttons: sounding note → white; muted → dim; else base track color.
export function trackButtonColor(track: number, active: boolean, muted: boolean): number {
    if (active) return C_WHITE;
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
    cachedSetButtonLED(CC_BACK, backLedColor(view));
    cachedSetButtonLED(CC_LEFT, arrowLedColor(-1, barOffset, maxOff, lp));
    cachedSetButtonLED(CC_RIGHT, arrowLedColor(+1, barOffset, maxOff, rp));
    cachedSetButtonLED(CC_SAMPLE, sampleLedColor()); cachedSetButtonLED(CC_CAPTURE, captureLedColor()); cachedSetButtonLED(CC_UNDO, undoLedColor());
    cachedSetButtonLED(CC_LOOP, seqState.loopMode ? WHITE_BRIGHT : WHITE_DIM);
    cachedSetButtonLED(CC_COPY, WHITE_DIM); cachedSetButtonLED(CC_DELETE_BTN, WHITE_DIM); cachedSetButtonLED(CC_MUTE, WHITE_DIM);
}

/* Length-span overlay while a step is held: the steps AFTER the held step, up
 * to its note length, light light-grey (distinct from in-clip dim and brighter
 * than out-of-clip dark-grey; overrides occupied steps as it paints first).
 * Returns -1 when `absStep` is not a span step (caller keeps the normal color). */
export function lengthSpanColor(absStep: number, holdStep: number, holdLen: number, _track: number): number {
    if (holdStep < 0 || holdLen <= 1) return -1;
    if (absStep > holdStep && absStep <= holdStep + holdLen - 1) return C_LIGHTGREY;
    return -1;
}

/* Held-step notes shown transposed so the highlighted pads line up with what
 * actually sounds (playback re-adds the clip transpose at emit); the live pads
 * themselves stay at concert pitch. Mirrors the engine's emit-time transpose. */
export function displayHoldNotes(): number[] {
    return seqState.holdNotes.map((p) => Math.max(0, Math.min(127, p + seqState.clipTranspose)));
}

/* Empty-clip visual metronome: which 4-step beat-group is lit (one per beat, cycling). */
export function metronomeStep(stepInBar: number, engineTick: number): boolean {
    return Math.floor(stepInBar / 4) === Math.floor(engineTick / 96) % 4; // 96 = PPQN
}

/* A cold frame can want ~80 LED sends (Session grid + steps + buttons); the
 * FRAME_BUDGET cap in cachedSet* spreads that over a few ticks so the ~60-packet
 * MIDI buffer never overflows. Paint Session pads first so the user-visible clip
 * grid gets priority within the budget; lower-priority buttons fill in next tick. */
export function seqLedsTick(
    shiftHeld: boolean = false,
    currentView: number = 0,
    barOffset: number = 0,
    maxOff: number = 0,
): void {
    ledFrameReset();
    // Session mode owns the 32-pad clip grid; the step row is not part of it,
    // so keep the step button LEDs dark (the master FX chain has no per-step
    // editing). Pads paint first for priority within the frame budget.
    if (seqState.sessionMode) {
        sessionPaintGrid(cachedSetAnimLED, PAD_MIN);
        for (let i = 0; i < NUM_STEP_BUTTONS; i++) cachedSetLED(STEP_NOTE_BASE + i, C_BLACK);
        paintTrackButtons();
        paintStepIcons(shiftHeld);
        paintAffordances(currentView, barOffset, maxOff, false, false);
        paintTransport();
        return;
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

    // Step-row: empty+playing → cycling green beat-group; else span/playhead/occ/loop.
    const playStep = seqState.playing ? seqState.curStep : -1;
    const dimTrack = trackColorDim(seqState.watchTrack);
    const { holdStep, holdLen, watchTrack } = seqState;
    const emptyMetro = seqState.lenSteps === 0 && seqState.playing;
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        const step = base + i;
        let color: number;
        if (emptyMetro) {
            color = metronomeStep(i, seqState.engineTick) ? C_GREEN : C_BLACK;
        } else if (seqState.lenSteps > 0 && step >= seqState.lenSteps) {
            // Steps past the clip length are not part of the pattern → fully off
            // (overrides occupancy/playhead, which never land out here anyway).
            color = C_BLACK;
        } else {
            const span = lengthSpanColor(step, holdStep, holdLen, watchTrack);
            if (span >= 0) color = span;
            else if (step === playStep) color = seqState.recording ? C_REC_RED : C_GREEN;
            else if (occHasStep(step)) color = C_WHITE;
            else if (seqState.lenSteps > 0 && step < seqState.lenSteps) color = dimTrack;
            else color = C_DARKGREY;
        }
        cachedSetLED(STEP_NOTE_BASE + i, color);
    }

    paintTransport();
}
