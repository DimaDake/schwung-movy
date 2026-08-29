/* First-look dispatcher for sequencer-owned input. midi/router.ts calls
 * this before any existing handler; returning true consumes the event, so
 * the param-page layer stays untouched by sequencer features.
 *
 * Owned: step buttons (notes 16-31), Play, and — while the engine is ready —
 * Left/Right arrows (bar navigation, native behavior; param page/chain nav
 * stays on the jog wheel). Track buttons are observed (watched-clip
 * retarget) without being claimed, so the param-page track switch still
 * runs.
 *
 * The three halves of what it dispatches to live next door — router-steps.ts
 * (the step row), router-pads.ts (pads and the held chord) and
 * router-buttons.ts (the modal/edit buttons). This file keeps the routing plus
 * the transport, encoders and arrows, which are one branch each. */

import {
    CC_PLAY, CC_REC, CC_TRACK_END, CC_TRACK_START,
    NUM_STEP_BUTTONS, PAD_MAX, PAD_MIN, STEP_NOTE_BASE,
} from './constants.js';
import { engineReady, seqCmd } from './engine.js';
import { focusedTrack } from '../track/focus.js';
import { recToggle } from '../undo/rec-pass.js';
import { loopHeld, loopWheel } from './loop-mode.js';
import { momentaryGesture } from './momentary.js';
import { sessionPad } from './session.js';
import { requestLoopWindowAdopt, seqState } from './state.js';
import { anyStepHeld, editNudge, editTranspose, editVelocity } from './step-edit.js';
import { stepRecArrow, stepRecDown, stepRecEnd, stepRecUp } from './step-rec.js';
import { padsPlayNotes } from './router-pads.js';
import { handleStepButton, navigateBar } from './router-steps.js';
import { muteHeld, seqHandleButtonCc } from './router-buttons.js';
import { setWatchTrack } from './watch.js';

/* The sequencer's public input surface stays on this module: these are its
 * other halves, re-exported so callers keep one import site. */
export { muteHeld, muteMarkGestured, muteShiftHeld, muteTrack, setMuteHeld } from './router-buttons.js';
export { padsPlayNotes, resetSeqChord, seqNotePadPlayed, seqNotePadReleased } from './router-pads.js';
export { resetMuteMap } from './router-steps.js';

const CC_LEFT = 62;
const CC_RIGHT = 63;
const CC_WHEEL = 14;     // MoveMainKnob — wheel
const CC_VOLUME = 79;    // MoveMaster — Volume encoder
const CC_PLUS = 55;      // MoveUp / +
const CC_MINUS = 54;     // MoveDown / -

export function seqHandleMidi(data: number[], shiftHeld: boolean): boolean {
    const statusType = data[0] & 0xF0;
    const d1 = data[1];
    const d2 = data[2];

    /* Session mode owns the 32 pads as the clip grid. */
    if (!padsPlayNotes()
        && (statusType === 0x90 || statusType === 0x80)
        && d1 >= PAD_MIN && d1 <= PAD_MAX) {
        if (statusType === 0x90 && d2 > 0) {
            momentaryGesture(); // launching a clip while Session is held = temporary peek
            sessionPad(d1, PAD_MIN);
        }
        return true;
    }

    if ((statusType === 0x90 || statusType === 0x80)
        && d1 >= STEP_NOTE_BASE && d1 < STEP_NOTE_BASE + NUM_STEP_BUTTONS) {
        handleStepButton(d1 - STEP_NOTE_BASE, statusType === 0x90 && d2 > 0, shiftHeld);
        return true;
    }

    if (statusType !== 0xB0) return false;

    if (seqHandleButtonCc(d1, d2, shiftHeld)) return true;

    /* Rec: held while stopped = step recording (step-rec.ts); a bare quick tap
     * keeps the old meaning, toggling live recording with its one-bar count-in. */
    if (d1 === CC_REC) {
        if (d2 > 0) {
            if (!stepRecDown()) recToggle(seqState.watchTrack);
        } else if (stepRecUp()) {
            recToggle(seqState.watchTrack);
        }
        return true;
    }

    /* Volume encoder edits held steps' velocity; otherwise not ours. */
    if (d1 === CC_VOLUME) {
        return editVelocity(decodeDelta(d2));
    }

    /* Wheel: Loop+wheel resizes the loop; otherwise it falls through to the
     * param page / chain nav (so a held step can roam pages + modules to
     * automate). It no longer edits note length. */
    if (d1 === CC_WHEEL) {
        if (loopHeld()) return loopWheel(decodeDelta(d2));
        return false;
    }

    if (d1 === CC_PLAY) {
        if (d2 > 0) {
            stepRecEnd();   // step recording is a stopped-transport mode
            seqCmd(seqState.playing ? 'stop' : 'play');
            seqState.playing = !seqState.playing;
        }
        return true;
    }

    /* +/- buttons transpose held steps; otherwise fall through to octave. */
    if ((d1 === CC_PLUS || d1 === CC_MINUS) && d2 > 0 && anyStepHeld()) {
        return editTranspose(d1 === CC_PLUS ? 1 : -1);
    }

    /* Left/Right: step recording (tie the held chord / move the head) takes
     * them first; then nudge held steps; else bar navigation (engine ready);
     * else fall through to the existing param page/chain nav. */
    if ((d1 === CC_LEFT || d1 === CC_RIGHT) && d2 > 0) {
        const dir = d1 === CC_RIGHT ? 1 : -1;
        if (stepRecArrow(dir)) return true;
        if (anyStepHeld()) return editNudge(dir, shiftHeld);
        if (engineReady()) { navigateBar(dir); return true; }
        return false;
    }

    /* Track buttons: observe only — retarget the watched clip and let the
     * existing param-page track switching run unchanged. While Mute is held a
     * track press is purely a mute (handled in midi/router.ts), so do not
     * retarget the step-view focus. */
    if (d1 >= CC_TRACK_START && d1 <= CC_TRACK_END && d2 > 0) {
        /* The four buttons address the FOCUSED group's quartet, not tracks 0-3.
         * Taking the raw button index here made the step view watch track 0-3
         * whichever group was on screen, so edits meant for track 5, 9 or 13 all
         * landed on track 1 — they share a button. midi/router.ts already
         * resolves this the same way for the active track; the two must agree or
         * the screen shows one track while the steps edit another. */
        const track = focusedTrack(CC_TRACK_END - d1);
        if (!muteHeld()) setWatchTrack(track);
        return false;
    }

    return false;
}

/* Active module changed: set the watched step-LED lane. lane < 0 = melodic
 * (all notes); lane >= 0 = a drum pad's MIDI note. Emits wlane only on a
 * real change. */
export function seqSetLane(lane: number): void {
    if (lane === seqState.watchLane) return;
    seqState.watchLane = lane;
    seqState.barOffset = 0;
    requestLoopWindowAdopt();
    seqCmd('wlane ' + (lane < 0 ? -1 : lane));
}
