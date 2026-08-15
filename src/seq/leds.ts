/* Sequencer LED painting through a cached diff layer — only changed colors
 * are sent, so unchanged frames cost nothing on the wire (davebox pattern). */

import { backLedColor, arrowLedColor, stepRecArrowColor, sampleLedColor, captureLedColor, undoLedColor } from './buttons.js';
import { canRedo, canUndo } from '../undo/state.js';
import { ANIM_NONE, ANIM_PULSE, C_BLACK, C_DARKGREY, C_GREEN, C_LIGHTGREY, C_REC_RED, C_WHITE, WHITE_BRIGHT, WHITE_DIM, WHITE_OFF, trackColor, trackColorDim } from './colors.js';
import {
    CC_PLAY, CC_REC, CC_TRACK_END, NUM_STEP_BUTTONS, PAD_MIN, STEP_NOTE_BASE,
} from './constants.js';
import { mainPageActive } from './main-page.js';
import { clipPageActive } from './clip-page.js';
import { appState } from '../app/state.js';
import { focusedTrack } from '../track/focus.js';
import { GROUP_SIZE } from '../track/ref.js';
import { sessionPaintGrid } from './session.js';
import { sessionStepColor } from './track-select.js';
import { loopEndBar, loopStartBar, occHasStep, seqState, stepInLoop } from './state.js';
import { stepRecActive, stepRecCanGoLeft, stepRecHead } from './step-rec.js';
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
const ICON_CLIP = 2; // Shift+Step 3 opens Clip Params (Track view only)

let lastLoopMode = false;

const BLINK_MS = 250;
/* Affordance blinks run on wall time, never on the engine's master tick.
 * seq-core stops advancing that tick while the transport is stopped (it returns
 * before the increment) and only resets it on play — so a blink derived from it
 * is a CONSTANT whenever the sequencer is stopped, decided by wherever the last
 * stop left the tick. Any odd 24-tick block meant a step-record head that was
 * permanently black, and Loop-mode content bars that never lit. Both of those
 * are states you look at precisely while stopped. */
function blinkPhase(): boolean {
    return Math.floor(Date.now() / BLINK_MS) % 2 === 0;
}
/* Loop-mode bars fade their own colour against black — one hue per meaning, where
 * blending two colours muddied both — and every pulsing bar shares ONE animation
 * channel so the whole row breathes in step. Mixing rates (a slow selected bar
 * against on-beat neighbours) cannot stay in lockstep by definition: the firmware
 * drives each rate off its own division, so peaks only coincide every other cycle.
 * Colour alone separates the states now.
 *
 * The lit colour goes in `anim`, never in `base` — led-cache.ts's contract is that
 * a firmware which ignores the base once a pulse channel is set still shows the
 * animation colour, so colour-in-base would pulse black against black there.
 *
 * Content is deliberately NOT shown: a bar's job here is to say whether it plays. */
interface BarCtx { isPlayhead: boolean; selected: boolean; inLoop: boolean; track: number; }
export interface CellLed { base: number; anim: number; channel: number; }

export function loopBarColor(c: BarCtx): CellLed {
    if (c.isPlayhead) return { base: C_BLACK, anim: C_GREEN, channel: ANIM_PULSE };
    if (c.selected)   return { base: C_BLACK, anim: C_WHITE, channel: ANIM_PULSE };
    if (c.inLoop)     return { base: C_BLACK, anim: trackColor(c.track), channel: ANIM_PULSE };
    return { base: C_DARKGREY, anim: C_DARKGREY, channel: ANIM_NONE };
}

/* Loop Mode: step buttons are bars. */
function paintLoopBars(): void {
    const start = loopStartBar();
    const end = loopEndBar();
    const playBar = seqState.playing ? Math.floor(seqState.curStep / NUM_STEP_BUTTONS) : -1;
    for (let bar = 0; bar < NUM_STEP_BUTTONS; bar++) {
        const led = loopBarColor({
            isPlayhead: bar === playBar,
            selected: bar === seqState.barOffset,
            inLoop: bar >= start && bar <= end,
            track: seqState.watchTrack,
        });
        cachedSetAnimLED(STEP_NOTE_BASE + bar, led.base, led.anim, led.channel);
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
interface IconCtx { shift: boolean; metro: boolean; fullVel: boolean; mainPage?: boolean; clipPage?: boolean; session?: boolean; }

export function stepIconColor(idx: number, c: IconCtx): number {
    const active = (idx === ICON_METRO && c.metro) || (idx === ICON_FULLVEL && c.fullVel)
                || (c.mainPage && ICON_MAIN.includes(idx)) // page open → full bright
                || (c.clipPage && idx === ICON_CLIP);
    if (active) return WHITE_BRIGHT;
    // Clip Params only opens in Track view, so its icon is unavailable in Session.
    const clipAvail = idx === ICON_CLIP && !c.session;
    if (c.shift && (idx === ICON_METRO || idx === ICON_FULLVEL
                    || idx === ICON_DBLLOOP || idx === ICON_QUANT
                    || ICON_MAIN.includes(idx) || clipAvail)) { // shift held → available
        return WHITE_DIM;
    }
    return WHITE_OFF;
}

function paintStepIcons(shift: boolean): void {
    const ctx = { shift, metro: seqState.metro, fullVel: seqState.fullVelocity,
        mainPage: mainPageActive(), clipPage: clipPageActive(), session: seqState.sessionMode };
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        cachedSetButtonLED(STEP_ICON_CC_BASE + i, stepIconColor(i, ctx));
    }
}

// Track buttons: sounding note → white; muted → dim; else base track color.
// Solo needs no special case here: it silences other tracks by muting them in
// the engine, so the mute mirror already dims them.
export function trackButtonColor(track: number, active: boolean, muted: boolean): number {
    if (active) return C_WHITE;
    return muted ? trackColorDim(track) : trackColor(track);
}

function trackHasActiveNote(track: number): boolean {
    const base = track * 128;
    for (let p = 0; p < 128; p++) if (seqState.activeNotes[base + p]) return true;
    return false;
}

/* Four buttons, always — this loop counts HARDWARE, not tracks. With 16 tracks
 * the buttons address the focused group's quartet, so the whole row changes
 * colour when the group moves. That is what makes the group readable at a
 * glance from the track buttons alone. */
function paintTrackButtons(): void {
    for (let n = 0; n < GROUP_SIZE; n++) {
        const t  = focusedTrack(n);
        const cc = CC_TRACK_END - n; // CC 43 = the group's first track
        cachedSetButtonLED(cc, trackButtonColor(t, trackHasActiveNote(t), seqState.muted[t]));
    }
}

function paintAffordances(view: number, barOffset: number, maxOff: number, shiftHeld: boolean): void {
    cachedSetButtonLED(CC_BACK, backLedColor(view));
    // While step recording the arrows belong to the head, not to bar navigation.
    if (stepRecActive()) {
        const blink = blinkPhase();
        const canLeft = stepRecCanGoLeft();
        cachedSetButtonLED(CC_LEFT, stepRecArrowColor(-1, canLeft, blink));
        cachedSetButtonLED(CC_RIGHT, stepRecArrowColor(+1, canLeft, blink));
    } else {
        cachedSetButtonLED(CC_LEFT, arrowLedColor(-1, barOffset, maxOff));
        cachedSetButtonLED(CC_RIGHT, arrowLedColor(+1, barOffset, maxOff));
    }
    cachedSetButtonLED(CC_SAMPLE, sampleLedColor()); cachedSetButtonLED(CC_CAPTURE, captureLedColor(seqState.capPending)); cachedSetButtonLED(CC_UNDO, undoLedColor(canUndo(), canRedo(), shiftHeld));
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
    /* The step row is painted through cachedSetLED outside Loop mode and
     * cachedSetAnimLED inside it — two independent caches over the same notes.
     * Whichever map is idle goes stale, so a toggle has to forget both or the
     * first frame after it silently keeps the old colours. */
    if (seqState.loopMode !== lastLoopMode) {
        lastLoopMode = seqState.loopMode;
        seqLedsInvalidate();
    }
    // Session mode owns the 32-pad clip grid (the focused group's 4 tracks),
    // and the step row becomes the 16-track selector. Pads paint first for
    // priority within the frame budget.
    if (seqState.sessionMode) {
        sessionPaintGrid(cachedSetAnimLED, PAD_MIN);
        for (let i = 0; i < NUM_STEP_BUTTONS; i++)
            cachedSetLED(STEP_NOTE_BASE + i, sessionStepColor(i, appState.focusGroup));
        paintTrackButtons();
        paintStepIcons(shiftHeld);
        paintAffordances(currentView, barOffset, maxOff, shiftHeld);
        paintTransport();
        return;
    }
    paintTrackButtons();
    paintStepIcons(shiftHeld);
    paintAffordances(currentView, barOffset, maxOff, shiftHeld);
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
    // The step-record head outranks every other step colour, including the
    // past-the-clip-length blackout — in grow mode the head legitimately sits
    // on a step the clip has not reached yet.
    const recHead = stepRecActive() ? stepRecHead() : -1;
    const headBlink = blinkPhase();
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        const step = base + i;
        let color: number;
        if (step === recHead) {
            color = headBlink ? C_REC_RED : C_BLACK;
        } else if (emptyMetro) {
            color = metronomeStep(i, seqState.engineTick) ? C_GREEN : C_BLACK;
        } else if (seqState.lenSteps > 0 && !stepInLoop(step)) {
            // Steps outside the loop window are not part of the pattern → fully
            // off (overrides occupancy/playhead, which never land out here).
            color = C_BLACK;
        } else {
            const span = lengthSpanColor(step, holdStep, holdLen, watchTrack);
            if (span >= 0) color = span;
            else if (step === playStep) color = seqState.recording ? C_REC_RED : C_GREEN;
            else if (occHasStep(step)) color = C_WHITE;
            else if (seqState.lenSteps > 0 && stepInLoop(step)) color = dimTrack;
            else color = C_DARKGREY;
        }
        cachedSetLED(STEP_NOTE_BASE + i, color);
    }

    paintTransport();
}
