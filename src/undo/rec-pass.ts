/* One undo per live-record pass.
 *
 * Recording is the one gesture with no release: the notes arrive over a whole
 * loop and the user never lets go of anything. The musical boundary is the
 * loop wrap, so that is what closes the group — two loops recorded give two
 * undos, and undoing once takes back the pass you just played rather than the
 * whole take.
 *
 * The wrap is detected from the mirrored playhead rather than from an engine
 * event, because the engine reports position anyway (`step=` in status) and a
 * new event would be a second source of truth for the same fact. */

import { seqState } from '../seq/state.js';
import { CLOSE, beginEdit, endEdit, onLoopWrap } from './group.js';
import { trackLabel } from './label.js';

let wasRecording = false;
let lastStep = -1;
let passIndex = 0;

function openPass(): void {
    passIndex++;
    beginEdit({
        key: 'rec:' + seqState.watchTrack + ':' + passIndex,
        verb: 'RECORD',
        target: trackLabel(seqState.watchTrack),
        detail: 'PASS ' + passIndex,
        close: CLOSE.LOOP_WRAP,
        seq: true,
    });
}

/** Called once per app tick, after the status poll has refreshed the mirror. */
export function recPassTick(): void {
    const rec = seqState.recording && !seqState.countingIn;

    if (rec && !wasRecording) {
        passIndex = 0;
        lastStep = seqState.curStep;
        openPass();
    } else if (!rec && wasRecording) {
        /* Stopping mid-pass still closes it: what was played is an edit even
         * though the loop never came round. */
        endEdit();
        lastStep = -1;
    } else if (rec) {
        /* The playhead going backwards is the wrap. A clip with no length
         * never advances, so there is nothing to detect and nothing to close. */
        if (seqState.curStep < lastStep) {
            onLoopWrap();
            openPass();
        }
        lastStep = seqState.curStep;
    }
    wasRecording = rec;
}

/** Test hook. */
export function resetRecPass(): void {
    wasRecording = false;
    lastStep = -1;
    passIndex = 0;
}
