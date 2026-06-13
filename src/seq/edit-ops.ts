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
import { seqCmd } from './engine.js';
import { seqToast } from './render.js';
import { seqState } from './state.js';

let copyHeld = false;
let copySource: number[] = []; // absolute steps marked while Copy is held
let pasteArmedFlag = false;
let delHeld = false;
let delActed = false;

export function copyActive(): boolean {
    return copyHeld;
}
export function deleteActive(): boolean {
    return delHeld;
}
export function pasteArmed(): boolean {
    return pasteArmedFlag;
}

function absStep(button: number): number {
    return seqState.barOffset * NUM_STEP_BUTTONS + button;
}

/* Copy button (CC 60). */
export function copyButton(down: boolean): void {
    const t = seqState.watchTrack;
    if (down) {
        if (pasteArmedFlag) {
            // Pressing Copy again before pasting cancels the pending paste.
            seqCmd('cpyclr');
            pasteArmedFlag = false;
            seqToast('Clipboard cleared');
            return;
        }
        copyHeld = true;
        copySource = [];
    } else {
        copyHeld = false;
        if (copySource.length === 0) {
            seqCmd('clipdup ' + t);
            seqToast('Clip duplicated');
        } else {
            const s0 = Math.min(...copySource);
            const s1 = Math.max(...copySource);
            seqCmd(`cpy ${t} ${s0} ${s1}`);
            pasteArmedFlag = true;
            seqToast('Copied');
        }
    }
}

/* A step pressed while Copy is held marks (part of) the copy source. */
export function copyMarkStep(button: number): void {
    copySource.push(absStep(button));
}

/* A step pressed while paste-armed pastes the clipboard there. */
export function pasteAtStep(button: number): void {
    seqCmd(`pst ${seqState.watchTrack} ${absStep(button)}`);
    pasteArmedFlag = false;
    seqToast('Pasted');
}

/* Delete button (CC 119). */
export function deleteButton(down: boolean): void {
    if (down) {
        delHeld = true;
        delActed = false;
    } else {
        delHeld = false;
        if (!delActed) {
            seqCmd('clipdel ' + seqState.watchTrack);
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
        seqToast('Bar cleared');
    } else {
        const s = absStep(button);
        seqCmd(`del ${t} ${s} ${s} -1`);
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
    copyHeld = false;
    copySource = [];
    pasteArmedFlag = false;
    delHeld = false;
    delActed = false;
}
