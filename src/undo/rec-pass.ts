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
import { seqCtl } from './record.js';
import { CLOSE, beginEdit, endEdit, onLoopWrap } from './group.js';
import { trackLabel } from './label.js';

/* Ticks to keep a just-armed group open while waiting for the engine to
 * confirm. The status poll runs at ~24 Hz, so arming is not visible in the
 * mirror for a tick or two; without this the group would be opened and closed
 * again before recording ever showed up. */
const ARM_CONFIRM_TICKS = 40;

let wasRolling = false;
let lastStep = -1;
let passOpen = false;
let pendingArm = 0;
let passSeq = 0;

function openPass(): void {
    /* The key must differ per pass, or re-entering would join the previous one
     * instead of starting a new entry. It is never shown. */
    passSeq++;
    beginEdit({
        key: 'rec:' + seqState.watchTrack + ':' + passSeq,
        verb: 'RECORD',
        target: trackLabel(seqState.watchTrack),
        close: CLOSE.LOOP_WRAP,
        seq: true,
    });
    passOpen = true;
}

/**
 * Rec pressed — arm or disarm.
 *
 * The snapshot has to be queued BEFORE the engine sees `rec`, which is why this
 * exists rather than the tick noticing recording start on its own. Arming into
 * an empty slot CREATES the clip (Engine::toggle_record calls ensure_exists),
 * so a snapshot taken once recording is rolling already contains it — undoing
 * the first pass then removed the notes but left an empty clip behind.
 */
export function recToggle(track: number): void {
    if (!seqState.recording && !seqState.countingIn) {
        openPass();                       // usnap precedes `rec` in the batch
        pendingArm = ARM_CONFIRM_TICKS;
    }
    seqCtl('rec ' + track);
}

/** Called once per app tick, after the status poll has refreshed the mirror. */
export function recPassTick(): void {
    /* Armed covers the count-in too: the clip is created at the arm, so the
     * group must already be open by then. Rolling is when notes can arrive. */
    const armed = seqState.recording || seqState.countingIn;
    const rolling = seqState.recording && !seqState.countingIn;

    if (!armed) {
        if (pendingArm > 0) { pendingArm--; return; }   // engine hasn't answered yet
        if (passOpen) {
            /* Stopping mid-pass still closes it: what was played is an edit
             * even though the loop never came round. */
            endEdit();
            passOpen = false;
        }
        lastStep = -1;
        wasRolling = false;
        return;
    }

    pendingArm = 0;
    /* Armed without going through recToggle (a device-driven start). */
    if (!passOpen) openPass();

    if (rolling) {
        /* The playhead going backwards is the wrap. A clip with no length never
         * advances, so there is nothing to detect and nothing to close. */
        if (wasRolling && seqState.curStep < lastStep) {
            onLoopWrap();
            openPass();
        }
        lastStep = seqState.curStep;
        wasRolling = true;
    }
}

/** Test hook. */
export function resetRecPass(): void {
    wasRolling = false;
    lastStep = -1;
    passOpen = false;
    pendingArm = 0;
    passSeq = 0;
}
