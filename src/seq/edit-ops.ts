/* Copy and Delete gestures (manual §11.8, §12.3, §12.4).
 *
 * Copy (CC 60):
 *   - tap (no step pressed while held) → duplicate the active clip.
 *   - hold + press step(s) → mark a copy source; on release the range is
 *     copied to the clipboard and the next step press pastes it.
 *   - press Copy again while paste-armed → clear the clipboard (cancel).
 * Delete (CC 119):
 *   - tap → delete the active clip.
 *   - hold + step → delete that step's notes (a whole bar in Loop Mode).
 *   - hold + drum pad → delete all notes of that pad's pitch.
 *
 * The engine owns the clip data + clipboard; this module emits commands and
 * shows toasts. */

import { NUM_STEP_BUTTONS } from './constants.js';
import { seqCmd, requestLabelSync } from './engine.js';
import { seqToast } from './render.js';
import { seqState } from './state.js';
import { clearStepAllAutomation } from './automation.js';
import { anyStepHeld, heldStepList, markHeldGestured } from './step-edit.js';

let delHeld = false;
let delActed = false;

export function deleteActive(): boolean {
    return delHeld;
}
/* Mark the in-progress Clear gesture as having acted, so its release does not
 * fall through to deleting the active clip. Used by the automation-knob clear
 * (and any other Clear-modified action). */
export function markDeleteActed(): void {
    delActed = true;
}

function absStep(button: number): number {
    return seqState.barOffset * NUM_STEP_BUTTONS + button;
}

/* Delete button (CC 119). */
export function deleteButton(down: boolean): void {
    if (down) {
        delHeld = true;
        delActed = false;
        // Step(s) held + Clear → clear that/those step(s)' automation (notes
        // are left intact; the held step was being edited, not deleted).
        if (anyStepHeld()) {
            const steps = heldStepList();
            for (const s of steps) clearStepAllAutomation(seqState.watchTrack, s);
            if (steps.length > 0) {
                markHeldGestured();    // release won't toggle a note
                seqToast('Automation cleared');
                delActed = true;       // and Clear release won't delete the clip
            }
        }
    } else {
        delHeld = false;
        if (!delActed) {
            seqCmd('clipdel ' + seqState.watchTrack);
            requestLabelSync(); // freed lanes (clip's automation gone) → re-sync
            seqToast('Clip deleted');
        }
    }
}

/* A step pressed while Delete is held removes that step's notes — or the
 * whole bar's notes in Loop Mode. */
export function deleteStep(button: number): void {
    const t = seqState.watchTrack;
    if (seqState.loopMode) {
        const base = button * NUM_STEP_BUTTONS;
        seqCmd(`del ${t} ${base} ${base + NUM_STEP_BUTTONS - 1} -1`);
        for (let s = base; s < base + NUM_STEP_BUTTONS; s++) clearStepAllAutomation(t, s);
        seqToast('Bar cleared');
    } else {
        const s = absStep(button);
        seqCmd(`del ${t} ${s} ${s} -1`);   // notes
        clearStepAllAutomation(t, s);       // and automation
        seqToast('Step cleared');
    }
    delActed = true;
}

/* A drum pad pressed while Delete is held removes all notes of that pitch
 * (manual: hold Delete + pad to clear a Drum Rack sample). */
export function deletePad(pitch: number): void {
    seqCmd(`del ${seqState.watchTrack} 0 255 ${pitch}`);
    seqToast('Notes cleared');
    delActed = true;
}

export function resetEditOps(): void {
    delHeld = false;
    delActed = false;
}
