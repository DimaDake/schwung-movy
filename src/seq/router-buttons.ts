/* The sequencer's modal and edit buttons: Mute/Solo, Loop, Note/Session,
 * Copy, Delete, Capture and Undo.
 *
 * Split out of router.ts, which is the dispatcher; these are the buttons whose
 * behaviour is a gesture in its own right rather than a single dispatch line.
 * Transport, encoders and the arrows stay with the dispatcher. */

import { appState } from '../app/state.js';
import { releaseAllLive } from '../keyboard/release.js';
import { toggleMute, toggleSolo } from '../mixer/track-mutes.js';
import { redoOnce, undoOnce } from '../undo/apply.js';
import { showUndoToast } from '../undo/toast.js';
import { CC_MUTE, CC_NOTE_SESSION } from './constants.js';
import { captureButton, captureClear } from './capture.js';
import { closeClipPage, clipPageActive } from './clip-page.js';
import { deleteActive, deleteButton } from './edit-ops.js';
import { copyButton as dupCopyButton } from './duplicate.js';
import { loopButton } from './loop-mode.js';
import { momentaryDown, momentaryUp, momentaryUpUngated } from './momentary.js';
import { sessionDeleteButton } from './session.js';
import { seqState } from './state.js';

const CC_LOOP = 58;
const CC_COPY = 60;
const CC_DELETE = 119;
const CC_CAPTURE = 52;
const CC_UNDO = 56;

let muteHeldState = false;
export function setMuteHeld(down: boolean): void { muteHeldState = down; }
export function muteHeld(): boolean { return muteHeldState; }

/* Shift state captured when Mute went down: selects solo over mute for the
 * whole gesture, including the Mute+track form (midi/router.ts). */
let muteShift = false;
export function muteShiftHeld(): boolean { return muteShift; }

/* Mute and solo both live in mixer/track-mutes.ts, which owns the interaction
 * between them (a solo derives the engine's mutes from the user's own). */
export function muteTrack(track: number): void { toggleMute(track); }

/* Session view state before the Note/Session button's current press, so a tap
 * can decide latch-vs-toggle-off and a hold can revert. */
let sessionPrev = false;

/** Handle a 0xB0 button. Returns false when the CC is not one of ours. */
export function seqHandleButtonCc(d1: number, d2: number, shiftHeld: boolean): boolean {
    /* Mute button: held state gates the Mute+track mute gesture (midi/router.ts).
     * In Track view a press with no track-button mute used while held instead
     * mutes the active track on release; Session view keeps Mute as a pure
     * held modifier (no current track to mute). The Mute+track gesture marks the
     * momentary (momentaryGesture in midi/router.ts) so it suppresses this.
     *
     * Ungated release: how long the button was down is not a different intent
     * here, and the 500 ms hold rule silently swallowed any deliberate press.
     *
     * Shift selects solo instead of mute. Taken at the press OR at the moment
     * of the action, because either order is natural: Shift is often released
     * before the button it modifies, and just as often added after it. */
    if (d1 === CC_MUTE) {
        if (d2 > 0) {
            setMuteHeld(true);
            muteShift = shiftHeld;
            momentaryDown(CC_MUTE, () => {});
        } else {
            setMuteHeld(false);
            if (momentaryUpUngated(CC_MUTE) === 'clean' && !seqState.sessionMode) {
                if (muteShift || shiftHeld) toggleSolo(appState.activeSlot);
                else muteTrack(appState.activeSlot);
                appState.dirty = true;
            }
            muteShift = false;
        }
        return true;
    }

    /* Loop button: tap toggles Loop Mode; hold + wheel resizes the loop. */
    if (d1 === CC_LOOP) {
        loopButton(d2 > 0);
        return true;
    }

    /* Note/Session: momentary. Down shows Session; a clean tap latches (or
     * toggles back to Note if already in Session); a hold or any clip launch
     * while held reverts to the prior view on release. */
    if (d1 === CC_NOTE_SESSION) {
        if (d2 > 0) {
            sessionPrev = seqState.sessionMode;
            momentaryDown(d1, () => { seqState.sessionMode = sessionPrev; });
            // Clip Params is Track-view only: leaving for Session closes it.
            if (clipPageActive()) appState.currentView = closeClipPage();
            // Session mode swallows pad note-offs (the pad branch in router.ts
            // returns true for 0x80 too), so a pad held across the switch would
            // strand.
            releaseAllLive();
            // Session is a different job from playing the pads, so whatever was
            // buffered for Capture belongs to the view being left.
            captureClear();
            seqState.sessionMode = true;
        } else if (momentaryUp(d1) === 'tap' && sessionPrev) {
            seqState.sessionMode = false; // tap while already in Session → back to Note
        }
        return true;
    }

    /* Copy/Delete: in Session mode they act on clips by pad; otherwise the
     * Note-mode step/clip gestures (edit-ops). */
    if (d1 === CC_COPY) {
        dupCopyButton(d2 > 0);
        return true;
    }
    if (d1 === CC_DELETE) {
        if (seqState.sessionMode) sessionDeleteButton(d2 > 0);
        else deleteButton(d2 > 0);
        return true;
    }

    /* Capture: keep what was just played; hold Clear to throw it away. */
    if (d1 === CC_CAPTURE) {
        if (d2 > 0) captureButton(deleteActive());
        return true;
    }

    /* Undo, and Shift+Undo for redo — the Move OG binding (manual, "Undo"). */
    if (d1 === CC_UNDO) {
        if (d2 > 0) {
            const redo = shiftHeld;
            showUndoToast(redo ? redoOnce() : undoOnce(), redo);
        }
        return true;
    }

    return false;
}
