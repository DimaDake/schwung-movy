/* Session view turns the 16 step buttons into a track selector.
 *
 * All sixteen steps show their track colour. The SELECTED track pulses its
 * colour against white; the focused group's four pulse between black and their
 * colour. Motion carries both cues, so they work for a dark accent as well as a
 * bright one — a brightness split did not, because TRACK_COLOR is not uniformly
 * bright. Two layers, because focus and selection genuinely come apart: the
 * octave buttons scroll the group without moving the selected track.
 *
 * The group is read from WHERE the pulsing quad is — position, not hue. That
 * matters because the colours have to be told apart by someone with a red-green
 * deficiency too, and position is the cue that never fails.
 *
 * The row outlives Session view. Selecting a track from it drops you straight
 * onto that track (pads, screen, knobs), and while the Session button is still
 * down the row stays a selector so you can keep going — see trackSelectHold. */

import { appState } from '../app/state.js';
import { TRACK_COUNT, trackGroup } from '../track/ref.js';
import { beginTrackSwitch, restoreTrackState, switchToTrack } from '../track/switch.js';
import { ANIM_NONE, ANIM_PULSE, C_BLACK, C_WHITE, trackColor } from './colors.js';
import { CC_NOTE_SESSION } from './constants.js';
import { momentaryCancel, momentaryDown, momentaryUp } from './momentary.js';
import { seqState } from './state.js';
import type { CellLed } from './leds.js';

/* Momentary key for the latched-Session step peek. Not a real CC — the step
 * row's notes (16..31) would sit close enough to the button CCs to be worth
 * confusing, and only one peek can be in flight anyway. */
const STEP_PEEK = 0x5150;

/* Session button physically down. Owned here rather than in router-buttons
 * because it is the selector that has to tell "held Session" (keep the row
 * alive after the switch) from "latched Session" (this press is a peek). */
let sessionBtnDown = false;

/* Step whose press opened a latched-Session peek, or -1. Its release must be
 * consumed: by then sessionMode is false and the row is real steps again, so
 * letting it through would toggle a note. */
let peekStep = -1;

/** True while the step row addresses tracks rather than steps. */
export function trackSelectActive(): boolean {
    return seqState.sessionMode || seqState.trackSelectHold;
}

export function sessionStepLed(step: number, focusGroup: number, selectedTrack: number): CellLed {
    if (step < 0 || step >= TRACK_COUNT) return { base: C_BLACK, anim: C_BLACK, channel: ANIM_NONE };
    const tc = trackColor(step);
    /* Selected outranks focused: when the group holds the selected track both
     * would apply, and "which one am I editing" is the finer answer. */
    if (step === selectedTrack) return { base: tc, anim: C_WHITE, channel: ANIM_PULSE };
    /* Focused group PULSES black<->its colour; the rest sit solid. Motion is the
     * cue, so it does not depend on one track's colour being lighter than
     * another's — which is what made a dim/bright split unreadable for the
     * darker accents. Same shape as loopBarColor's in-loop bars. */
    return trackGroup(step) === focusGroup
        ? { base: C_BLACK, anim: tc, channel: ANIM_PULSE }
        : { base: tc, anim: tc, channel: ANIM_NONE };
}

/** Session button down/up. Up ends the hold-to-keep-selecting state. */
export function sessionButtonDown(down: boolean): void {
    sessionBtnDown = down;
    if (!down && seqState.trackSelectHold) {
        /* Release commits: you stay on whatever track you last picked. */
        seqState.trackSelectHold = false;
        appState.dirty = true;
    }
}

export function sessionStepPress(step: number): void {
    if (step < 0 || step >= TRACK_COUNT) return;
    const prev = beginTrackSwitch();

    if (sessionBtnDown) {
        /* Held Session: land on the track now, but keep the row a selector so
         * the next step press switches again. The Session momentary is
         * CANCELLED rather than marked as gestured — its release must not undo
         * the switch we just committed. */
        momentaryCancel(CC_NOTE_SESSION);
        switchToTrack(step, prev);
        seqState.trackSelectHold = true;
        return;
    }

    /* Latched Session: exactly the track-button gesture. A quick tap latches
     * onto the new track; holding peeks and reverts to Session view on release. */
    peekStep = step;
    momentaryDown(STEP_PEEK, () => restoreTrackState(prev));
    switchToTrack(step, prev);
}

/* Release of the step that opened a latched-Session peek. Returns true when it
 * was consumed, so the caller must not run the normal step-release path. */
export function sessionStepRelease(step: number): boolean {
    if (step !== peekStep) return false;
    peekStep = -1;
    momentaryUp(STEP_PEEK);   // 'revert' runs restoreTrackState; 'tap' keeps the switch
    appState.dirty = true;
    return true;
}

/* Drop the latches without reverting: resetHeldInput runs on tool open and when
 * movy hands the foreground away, where a restore would be a surprise view jump
 * rather than a correction. resetMomentary() next to us drops its own the same
 * way. */
export function resetTrackSelect(): void {
    sessionBtnDown = false;
    peekStep = -1;
    seqState.trackSelectHold = false;
}
