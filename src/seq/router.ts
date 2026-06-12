/* First-look dispatcher for sequencer-owned input. midi/router.ts calls
 * this before any existing handler; returning true consumes the event, so
 * the param-page layer stays untouched by sequencer features.
 *
 * Owned today: step buttons (notes 16-31) and the Play button.
 * Observed without claiming: track buttons (to retarget the engine's
 * watched clip — selection itself stays with the param-page handler). */

import {
    CC_PLAY, CC_TRACK_END, CC_TRACK_START,
    NUM_STEP_BUTTONS, STEP_NOTE_BASE,
} from './constants.js';
import { seqCmd } from './engine.js';
import { occHasStep, occToggleStep, seqState } from './state.js';

/* Bar shown on the step buttons (left/right arrows move it — Step 3). */
export let barOffset = 0;

export function seqHandleMidi(data: number[]): boolean {
    const status = data[0] & 0xF0;
    const d1 = data[1];
    const d2 = data[2];

    /* Step buttons: note-on toggles; note-off ignored (hold gestures land
     * in later steps). */
    if ((status === 0x90 || status === 0x80)
        && d1 >= STEP_NOTE_BASE && d1 < STEP_NOTE_BASE + NUM_STEP_BUTTONS) {
        if (status === 0x90 && d2 > 0) {
            toggleStep(d1 - STEP_NOTE_BASE);
        }
        return true;
    }

    if (status !== 0xB0) return false;

    /* Play: toggle transport. Mirror updated optimistically so the LED
     * reacts this tick; the next status poll confirms. */
    if (d1 === CC_PLAY) {
        if (d2 > 0) {
            seqCmd(seqState.playing ? 'stop' : 'play');
            seqState.playing = !seqState.playing;
        }
        return true;
    }

    /* Track buttons: observe only — retarget the watched clip and let the
     * existing param-page track switching run unchanged. */
    if (d1 >= CC_TRACK_START && d1 <= CC_TRACK_END && d2 > 0) {
        const track = CC_TRACK_END - d1;
        if (track !== seqState.watchTrack) {
            seqState.watchTrack = track;
            seqCmd('watch ' + track);
        }
        return false;
    }

    return false;
}

function toggleStep(button: number): void {
    const step = barOffset * NUM_STEP_BUTTONS + button;
    const t = seqState.watchTrack;
    seqCmd(`tog ${t} ${step} ${seqState.lastPitch[t]} ${seqState.lastVel[t]}`);
    /* Optimistic mirror so the step LED flips this tick. Adding the first
     * note also auto-starts the transport (engine rule) and implicitly
     * creates a 1-bar clip — mirror both. */
    if (!occHasStep(step)) {
        if (seqState.lenSteps === 0) seqState.lenSteps = NUM_STEP_BUTTONS;
        if (!seqState.playing) seqState.playing = true;
        occToggleStep(step);
    } else {
        occToggleStep(step);
    }
}

/* Pads feed step entry: remember the active track's last played note so a
 * step press knows what to place. Called from the keyboard handlers. */
export function seqNotePadPlayed(track: number, pitch: number, vel: number): void {
    if (track >= 0 && track < 4) {
        seqState.lastPitch[track] = pitch;
        seqState.lastVel[track] = vel;
    }
}
