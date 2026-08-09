/* One place that forgets every "this button is down" fact movy holds.
 *
 * Every held-input latch here is armed by a press and disarmed only by the
 * matching release. There is no way to read the hardware's button state, so a
 * release that never arrives — swallowed by a modal, or dropped by the host
 * while a synchronous scan blocks the input callback — strands the latch for
 * the rest of the tool's life. A stranded step hold is the worst of them: it
 * keeps `anyStepHeld()` true, which keeps `stepAutoMode` true, which routes
 * every knob turn into step automation instead of the param under it. The user
 * sees "the knobs stopped working" and has to close and reopen movy.
 *
 * Called on tool open (init) and whenever movy hands the foreground away
 * (the Leave-Movy modal), where releases provably cannot come back. */

import { seqState } from '../seq/state.js';
import { seqCmd } from '../seq/engine.js';
import { resetStepEdit } from '../seq/step-edit.js';
import { resetStepPage } from '../seq/step-page.js';
import { resetMomentary } from '../seq/momentary.js';
import { resetMainPage } from '../seq/main-page.js';
import { resetClipPage } from '../seq/clip-page.js';
import { resetEditOps } from '../seq/edit-ops.js';
import { resetDuplicate } from '../seq/duplicate.js';
import { resetLoopMode } from '../seq/loop-mode.js';
import { resetSeqChord, setMuteHeld } from '../seq/router.js';
import { resetStepRec } from '../seq/step-rec.js';
import { resetTrackVolume } from '../mixer/track-volume.js';
import { resetAssignMode } from '../lfo/assign-mode.js';
import { jogHintTouch } from './jog-hint.js';
import { appState } from './state.js';

/* Drop every held-input latch. `notifyEngine` sends the matching `hold -1` so
 * the engine's parameter-lock session ends with ours; skip it at init, where
 * the engine has not booted yet and the queued command would be pointless. */
import { resetButtonHeld } from '../seq/button-held.js';

export function resetHeldInput(notifyEngine: boolean): void {
    resetStepEdit();      // heldRanges / gestured / pressMs / co-press / length target
    resetStepPage();
    resetMomentary();
    resetMainPage();
    resetClipPage();
    resetEditOps();       // Delete held
    resetDuplicate();     // Copy held
    resetLoopMode();      // Loop held
    resetSeqChord(notifyEngine);   // pads held for chord step entry
    resetStepRec();       // Rec held for step recording
    resetTrackVolume();   // track-button + volume-knob gesture
    resetAssignMode();    // knob held → LFO assign
    setMuteHeld(false);
    jogHintTouch(false);

    seqState.stepAutoMode = false;
    seqState.heldLocks.clear();
    seqState.holdStep = -1;
    seqState.holdNotes = [];
    seqState.holdLen = 0;
    appState.shiftHeld = false;

    // Knob touch/hold state lives on each chain model (touched highlight, enum /
    // file overlay, long-press timer). Models are built by init() after this
    // runs on the open path, so an empty list here is expected, not an error.
    for (const track of appState.trackModels) for (const m of track) m.clearTouch();
    for (const m of appState.masterFxModels) m.clearTouch();

    if (notifyEngine) seqCmd('hold ' + seqState.watchTrack + ' -1');
}
