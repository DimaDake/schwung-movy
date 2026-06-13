/* First-look dispatcher for sequencer-owned input. midi/router.ts calls
 * this before any existing handler; returning true consumes the event, so
 * the param-page layer stays untouched by sequencer features.
 *
 * Owned: step buttons (notes 16-31), Play, and — while the engine is ready —
 * Left/Right arrows (bar navigation, native behavior; param page/chain nav
 * stays on the jog wheel). Track buttons are observed (watched-clip
 * retarget) without being claimed, so the param-page track switch still
 * runs. */

import {
    CC_PLAY, CC_TRACK_END, CC_TRACK_START,
    NUM_STEP_BUTTONS, STEP_NOTE_BASE,
} from './constants.js';
import { engineReady, seqCmd } from './engine.js';
import {
    doubleLoop, loopButton, loopHeld, loopStepOff, loopStepOn, loopWheel,
} from './loop-mode.js';
import { seqToast } from './render.js';
import {
    maxBarOffset, occHasStep, occToggleStep, seqState,
} from './state.js';

const CC_LEFT = 62;
const CC_RIGHT = 63;
const CC_LOOP = 58;
const CC_WHEEL = 14;     // MoveMainKnob — claimed only while Loop is held
const STEP_FULL_VEL = 9; // Step 10 (0-indexed) — Shift+Step 10 = Full Velocity
const STEP_DOUBLE_LOOP = 14; // Step 15 — Shift+Step 15 = Double Loop

/* Pads currently held, padNote → midiNote, for chord step entry. Mirrors the
 * pads physically down so a step press can place the whole chord. */
const heldChord = new Map<number, number>();

export function seqHandleMidi(data: number[], shiftHeld: boolean): boolean {
    const statusType = data[0] & 0xF0;
    const d1 = data[1];
    const d2 = data[2];

    /* Step buttons: Shift+step are Move's shifted functions; in Loop Mode a
     * step selects a bar; otherwise a bare step-on toggles a note. */
    if ((statusType === 0x90 || statusType === 0x80)
        && d1 >= STEP_NOTE_BASE && d1 < STEP_NOTE_BASE + NUM_STEP_BUTTONS) {
        const step = d1 - STEP_NOTE_BASE;
        const on = statusType === 0x90 && d2 > 0;
        if (on && shiftHeld) {
            shiftStepFunction(step);
        } else if (seqState.loopMode) {
            if (on) loopStepOn(step);
            else loopStepOff(step);
        } else if (on) {
            toggleStep(step);
        }
        return true;
    }

    if (statusType !== 0xB0) return false;

    /* Loop button: tap toggles Loop Mode; hold + wheel resizes the loop. */
    if (d1 === CC_LOOP) {
        loopButton(d2 > 0);
        return true;
    }

    /* Wheel is claimed only while Loop is held (loop resize); otherwise it
     * falls through to the param page/chain nav. */
    if (d1 === CC_WHEEL && loopHeld()) {
        return loopWheel(decodeDelta(d2));
    }

    if (d1 === CC_PLAY) {
        if (d2 > 0) {
            seqCmd(seqState.playing ? 'stop' : 'play');
            seqState.playing = !seqState.playing;
        }
        return true;
    }

    /* Left/Right = bar navigation, but only once the engine is live; with no
     * engine they fall through to the existing param page/chain nav. */
    if ((d1 === CC_LEFT || d1 === CC_RIGHT) && d2 > 0 && engineReady()) {
        navigateBar(d1 === CC_RIGHT ? 1 : -1);
        return true;
    }

    /* Track buttons: observe only — retarget the watched clip and let the
     * existing param-page track switching run unchanged. */
    if (d1 >= CC_TRACK_START && d1 <= CC_TRACK_END && d2 > 0) {
        const track = CC_TRACK_END - d1;
        if (track !== seqState.watchTrack) {
            seqState.watchTrack = track;
            seqState.barOffset = 0;
            seqCmd('watch ' + track);
        }
        return false;
    }

    return false;
}

/* Shift + step button = Move's shifted step functions. Step 10 toggles Full
 * Velocity; further entries (Double Loop = Step 15, Quantize = Step 16) land
 * in later steps. */
function shiftStepFunction(step: number): void {
    if (step === STEP_FULL_VEL) {
        seqState.fullVelocity = !seqState.fullVelocity;
        seqToast(seqState.fullVelocity ? 'Full Velocity On' : 'Full Velocity Off');
    } else if (step === STEP_DOUBLE_LOOP) {
        doubleLoop();
    }
}

function navigateBar(delta: number): void {
    const next = Math.max(0, Math.min(seqState.barOffset + delta, maxBarOffset()));
    if (next !== seqState.barOffset) {
        seqState.barOffset = next;
        seqToast('Bar ' + (next + 1));
    }
}

function toggleStep(button: number): void {
    const step = seqState.barOffset * NUM_STEP_BUTTONS + button;
    const t = seqState.watchTrack;
    const wasSet = occHasStep(step);

    if (seqState.watchLane >= 0) {
        /* Drum lane: toggle just the selected lane's pitch at this step. */
        seqCmd(`ltog ${t} ${step} ${seqState.watchLane} ${seqState.lastVel[t]}`);
    } else {
        /* Melodic: place the currently-held chord, or the last-played note
         * if no pads are down; a step that already has notes is cleared. */
        const pitches = heldChord.size > 0
            ? [...heldChord.values()]
            : [seqState.lastPitch[t]];
        const v = seqState.lastVel[t];
        seqCmd(`tog ${t} ${step} ${pitches.map((p) => `${p} ${v}`).join(' ')}`);
    }

    /* Optimistic mirror so the step LED flips this tick. Adding the first
     * note auto-starts the transport and implicitly creates a 1-bar clip. */
    if (!wasSet) {
        if (seqState.lenSteps === 0) seqState.lenSteps = NUM_STEP_BUTTONS;
        if (step >= seqState.lenSteps) {
            seqState.lenSteps = (Math.floor(step / NUM_STEP_BUTTONS) + 1) * NUM_STEP_BUTTONS;
        }
        if (!seqState.playing) seqState.playing = true;
    }
    occToggleStep(step);
}

/* Pad note-on: remember the active track's last-played note (step-entry
 * value) and add it to the held chord. */
export function seqNotePadPlayed(track: number, padNote: number, midiNote: number, vel: number): void {
    if (track >= 0 && track < 4) {
        seqState.lastPitch[track] = midiNote;
        seqState.lastVel[track] = vel;
    }
    heldChord.set(padNote, midiNote);
}

/* Pad note-off: drop it from the held chord. */
export function seqNotePadReleased(padNote: number): void {
    heldChord.delete(padNote);
}

/* Active module changed: set the watched step-LED lane. lane < 0 = melodic
 * (all notes); lane >= 0 = a drum pad's MIDI note. Emits wlane only on a
 * real change. */
export function seqSetLane(lane: number): void {
    if (lane === seqState.watchLane) return;
    seqState.watchLane = lane;
    seqState.barOffset = 0;
    seqCmd('wlane ' + (lane < 0 ? -1 : lane));
}
