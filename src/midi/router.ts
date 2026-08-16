import { trackRef } from '../track/ref.js';
import { focusedTrack, focusGroupStep, selectTrack, GROUP_DIR_UP, GROUP_DIR_DOWN } from '../track/focus.js';
import { portFor } from '../track/registry.js';
import { setButtonHeld } from '../seq/button-held.js';
import { appState, trackIsDrum, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE, VIEW_MAIN_PARAMS } from '../app/state.js';
import { mainPageActive, mainPageKnob, mainPageTouch, mainPageRelease, closeMainPage } from '../seq/main-page.js';
import { clipPageActive, clipPageKnob, clipPageTouch, clipPageRelease, closeClipPage } from '../seq/clip-page.js';
import { CHAIN_SLOTS, MASTER_FX_SLOTS, LFO_CHAIN_INDEX, isLfoSlot } from '../chain/config.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeOctave } from '../keyboard/handler.js';
import { soundingPitch, soundingTrack } from '../keyboard/held-notes.js';
import { releaseAllLive } from '../keyboard/release.js';
import { drumPadOn, drumPadOff } from '../keyboard/drum-handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { openFileBrowser, navigateFileBrowser, activateFileBrowserItem } from '../browser/file-handler.js';
import { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, muteHeld, muteShiftHeld, muteTrack, seqRestoreWatch } from '../seq/router.js';
import { anyStepHeld, editStepPageKnob } from '../seq/step-edit.js';
import { stepPageState, setStepPageSelected, setStepTouchedKnob, stepPageAvailable } from '../seq/step-page.js';
import { seqState } from '../seq/state.js';
import { WHITE_BRIGHT, WHITE_DIM } from '../seq/colors.js';
import { momentaryDown, momentaryGesture, momentaryUp } from '../seq/momentary.js';
import { handleAutomationKnob, clearLaneForKnob, automationKnobReleased, automationKnobTouched } from '../seq/automation.js';
import { holdTouch, holdRelease, holdTurnCancel, assignActive, assignCycle, assignCommit } from '../lfo/assign-mode.js';
import { deleteActive, markDeleteActed } from '../seq/edit-ops.js';
import { seqToast } from '../seq/render.js';
import { leaveModalActive, openLeaveModal, closeLeaveModal, leaveModalMove, leaveModalConfirm } from '../app/leave-modal.js';
import {
    quantOverlayActive, quantOverlayAction, quantOverlayJog, quantOverlayHold,
    dismissQuantOverlay,
} from '../seq/quant-overlay.js';
import { captureOverlayActive, captureOverlayAction, captureJog, captureDismiss } from '../seq/capture.js';
import { resetHeldInput } from '../app/input-reset.js';
import { jogHintTouch } from '../app/jog-hint.js';
import { MASTER_CC, volumeTrackDown, volumeTrackUp, volumeTouch, volumeKnobDelta } from '../mixer/track-volume.js';
import { toggleSolo } from '../mixer/track-mutes.js';
import { mlog } from '../log.js';

const PAD_MIN        = MovePads[0];
const PAD_MAX        = MovePads[MovePads.length - 1];
const KNOB_CC_BASE   = MoveKnob1;
const NUM_KNOBS      = 8;
const MASTER_TOUCH   = MoveKnob8Touch + 1;  /* note 8 = master (volume) knob touch */
const JOG_TOUCH      = MoveKnob8Touch + 2;  /* note 9 = main encoder (jog) touch */
const TRACK_CC_START = 40;                   /* MoveRow4 → slot 3 */
const TRACK_CC_END   = 43;                   /* MoveRow1 → slot 0 */

/* True for an event that RELEASES something we may be holding. Relative
 * encoders are excluded on purpose: they send a value, not a button state, and
 * d2 === 0 there means "no movement", not "up". */
function isRelease(data: number[]): boolean {
    const type = data[0] & 0xF0;
    if (type === 0x80) return true;
    if (type === 0x90) return data[2] === 0;
    if (type === 0xB0) {
        const k = data[1];
        if (k === MoveMainKnob || k === MASTER_CC) return false;
        if (k >= KNOB_CC_BASE && k < KNOB_CC_BASE + NUM_KNOBS) return false;
        return data[2] === 0;
    }
    return false;
}

/* Every non-encoder CC is a button; led-cache uses this to light whichever one
 * is under the finger (see seq/button-held.ts). Recorded before dispatch so the
 * same tick's repaint already sees it. */
function trackButtonPress(data: number[]): void {
    if ((data[0] & 0xF0) !== 0xB0) return;
    const k = data[1];
    if (k === MoveMainKnob || k === MASTER_CC) return;
    if (k >= KNOB_CC_BASE && k < KNOB_CC_BASE + NUM_KNOBS) return;
    setButtonHeld(k, data[2] > 0);
}

function activeModel() {
    return appState.trackModels[appState.activeTrack.index]?.[appState.trackChainIndex[appState.activeTrack.index]];
}

function chainIndex(): number { return appState.trackChainIndex[appState.activeTrack.index]; }
function setChainIndex(i: number): void { appState.trackChainIndex[appState.activeTrack.index] = i; }

/* The track's instrument always lives in chain slot 1 (synth). Drum pad input
 * is keyed off it — not the focused chain slot — so pads keep sounding and
 * selecting drum lanes while the user edits the MIDI FX or an audio-FX slot on
 * the same track. (tick.ts already reads drum status/lane from this slot.) */
function synthModel() {
    return appState.trackModels[appState.activeTrack.index]?.[1];
}

function masterModel() { return appState.masterFxModels[appState.masterChainIndex]; }

/* The model the 8 knobs edit and the screen shows: the master FX slot while the
 * master chain is on screen (Session mode), otherwise the active track slot. */
function knobModel() { return masterChainActive() ? masterModel() : activeModel(); }

/* Session mode shows the master FX chain, but a browse/file-browse view (opened
 * from it) takes over the screen and the jog wheel — so master-chain navigation
 * only applies while that chain is actually on screen. */
function masterChainActive(): boolean {
    return seqState.sessionMode
        && appState.currentView !== VIEW_BROWSE
        && appState.currentView !== VIEW_FILE_BROWSE;
}

/* The master slot grid is on screen (jog scrolls slots, click adds/drills). */
function masterGridActive(): boolean { return masterChainActive() && !appState.masterDetail; }

/* A master slot's module detail page is on screen (jog scrolls param banks). */
function masterDetailActive(): boolean { return masterChainActive() && appState.masterDetail; }

export function onMidiMessageInternal(data: number[]): void {
    if (!data || data.length < 3) return;
    /* Before any dispatch, including the paths that swallow input: a button
     * whose press is swallowed by a modal is still physically down, and its LED
     * must not stay dim under the finger. */
    trackButtonPress(data);

    // The Leave-Movy modal owns all input while it is up: jog turn moves the
    // highlight, jog click confirms (Background parks / Close exits), Back
    // cancels. Every other PRESS is swallowed so nothing fires behind it.
    //
    // Releases are not swallowed. The handler that armed a hold has no other way
    // to learn the button came up, so a dropped release strands it for the rest
    // of the session — a stranded step hold keeps stepAutoMode latched and eats
    // every subsequent knob turn (tempo, clip length, module params), curable
    // only by reopening movy. openLeaveModal() already forgot what was held, so
    // these releases land on empty state and do nothing but stay honest.
    // The post-capture overlay stays up until something is pressed. The jog
    // picks a tempo (applied as you turn); every other PRESS just dismisses it
    // and is swallowed. Swallowed rather than passed through because movy has
    // no undo — a step button that both dismissed this and wrote a note into
    // the clip you just captured is not a trade worth offering. Releases fall
    // through so no handler is left holding a button that never came up.
    if (captureOverlayActive()) {
        const action = captureOverlayAction(data);
        if (action === 'jog') { captureJog(decodeDelta(data[2])); return; }
        if (action === 'swallow') return;
        if (action === 'dismiss') { captureDismiss(data); return; }
    }

    /* The quantize panel is a confirmation, not a decision: only Back and the
     * jog assembly are consumed, and anything that neither repaints nor toasts
     * runs underneath without even closing it. Below capture's gate, so a
     * screen-owning overlay always wins. */
    if (quantOverlayActive()) {
        const action = quantOverlayAction(data, appState.shiftHeld);
        if (action === 'jog') { quantOverlayJog(decodeDelta(data[2]), Date.now()); return; }
        if (action === 'swallow') { quantOverlayHold(Date.now()); return; }
        if (action === 'dismiss') { dismissQuantOverlay(); return; }
    }

    if (leaveModalActive()) {
        if ((data[0] & 0xF0) === 0xB0) {
            const k = data[1], v = data[2];
            if (k === MoveBack && v > 0) { closeLeaveModal(); appState.dirty = true; return; }
            if (k === MoveMainKnob) {
                const delta = decodeDelta(v);
                if (delta !== 0) { leaveModalMove(delta); appState.dirty = true; }
                return;
            }
            if (k === MoveMainButton && v > 0) {
                const action = leaveModalConfirm();
                appState.dirty = true;
                if (action === 'background') host_suspend_overtake();
                else if (action === 'close') host_exit_module();
                return;
            }
        }
        if (!isRelease(data)) return;
    }

    if (seqHandleMidi(data, appState.shiftHeld)) return;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7. Hold-Clear (Delete) + touch
     * clears that knob's automation lane. */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        // Main/Clip Params are pages the user opened deliberately and are what
        // app/tick.ts actually renders, so they own the knobs ahead of the step
        // page. (The other order let a step hold silently steer the knobs away
        // from the page on screen.)
        if (mainPageActive()) {
            if (d1 < 8) {   // every knob on the page (3 is unused but harmless)
                if (d2 > 0) mainPageTouch(d1, true);
                else mainPageRelease(d1);
            }
            appState.dirty = true;
            return;
        }
        if (clipPageActive()) {
            if (d1 < 4) {
                if (d2 > 0) clipPageTouch(d1, true);
                else clipPageRelease(d1, appState.activeTrack.index);
            }
            appState.dirty = true;
            return;
        }
        // Step page owns the knobs: a touch shows that param's top toast; the
        // step params are intrinsic (no automation lane / model touch).
        if (stepPageAvailable() && stepPageState.selected) {
            setStepTouchedKnob(d2 > 0 && d1 < 5 ? d1 : -1);
            appState.dirty = true;
            return;
        }
        if (d2 > 0) {
            const info = knobModel()?.getKnobParamInfo(d1) ?? null;
            if (deleteActive() && info) {
                clearLaneForKnob(appState.activeTrack.index, info);
                markDeleteActed();   // Clear release must not also delete the clip
                return;
            }
            knobModel()?.handleKnobTouch(d1);
            automationKnobTouched(d1);    // arm tap-to-clear in step-auto mode
            holdTouch(appState.activeTrack.index, d1, info);   // arm hold-to-modulate
        } else {
            const info = knobModel()?.getKnobParamInfo(d1) ?? null;
            if (knobModel()?.handleKnobRelease(d1)) seqToast('Wrong preset type');
            if (info) automationKnobReleased(appState.activeTrack.index, d1, info);
            holdRelease(d1);
        }
        return;
    }

    /* Master (volume) knob touch: note=8 — arms the track-volume gesture. */
    if ((status & 0xF0) === 0x90 && d1 === MASTER_TOUCH) {
        volumeTouch(d2 > 0);
        appState.dirty = true;
        return;
    }

    /* Main encoder (jog) touch: note=9. Arms the hint only — it appears a
     * beat later (jogHintTick), so grabbing the jog to scroll shows nothing.
     * The repaint is needed only when the release takes a visible hint away. */
    if ((status & 0xF0) === 0x90 && d1 === JOG_TOUCH) {
        if (appState.currentView === VIEW_CHAIN || appState.currentView === VIEW_KNOBS) {
            if (jogHintTouch(d2 > 0)) appState.dirty = true;
        }
        return;
    }

    /* Any other sub-10 note is an encoder touch we don't use */
    if ((status & 0xF0) === 0x90 && d1 < 10) return;

    /* Pad notes */
    if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
        const model   = synthModel();
        const drumCfg = model?.getDrumConfig() ?? null;
        const track = appState.activeTrack.index;
        if ((status & 0xF0) === 0x90 && d2 > 0) {
            const vel = seqState.fullVelocity ? 127 : d2;
            if (drumCfg) {
                const pad = drumPadOn(d1, PAD_MIN, appState.shiftHeld, drumCfg, model!.getComponentKey(), track, vel);
                if (pad !== null) model!.updateDrumPad(pad, d1);
            } else {
                noteOn(d1, PAD_MIN, track, vel);
            }
            /* The pitch this pad actually sounded, from the ledger — not
             * `lastPlayedNote`, which is the last note played ANYWHERE and is
             * simply stale when the press produced nothing (a pad outside the
             * drum grid, a piano-layout gap, a shift-select). Passing that stale
             * value let a gesture act on a pitch the user never touched: holding
             * Clear and hitting a dead pad wiped the previous pad's whole lane. */
            const played = soundingPitch(d1);
            if (played !== undefined) seqNotePadPlayed(track, d1, played, vel);
            return;
        }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            // Read the owner before the release drains it — the record-capture
            // note-off has to reach the same track the note was played on.
            const owner = soundingTrack(d1) ?? track;
            if (drumCfg) {
                drumPadOff(d1);
            } else {
                noteOff(d1, PAD_MIN);
            }
            seqNotePadReleased(d1, owner);
            return;
        }
    }

    /* Master volume knob (CC 79): with a track button held it edits that track's
     * slot volume; otherwise it stays Move's master volume and we ignore it. */
    if ((status & 0xF0) === 0xB0 && d1 === MASTER_CC) {
        if (volumeKnobDelta(d2)) {
            momentaryGesture();   // a volume edit means the release must not latch
            appState.dirty = true;
        }
        return;
    }

    /* Knob CC (71–78) — automation gets first refusal (hold-step / Rec / a
     * param already bound to a lane); otherwise the normal param-set path. */
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        holdTurnCancel();   // a knob turn cancels a pending / active hold-to-modulate
        // Main/Clip Params first, for the same reason as the touch branch above:
        // the page on screen owns its knobs, whatever a step hold thinks.
        if (mainPageActive()) {
            // 0 tempo, 1 swing, 2 LINK, 4 root, 5 key, 6 mode, 7 layout.
            if (k < 8) { mainPageKnob(k, delta); appState.dirty = true; }
            return;
        }
        if (clipPageActive()) {
            if (k < 4) { clipPageKnob(k, delta, appState.activeTrack.index); appState.dirty = true; }
            return;
        }
        // Step page owns the knobs while it is selected (intrinsic trig props,
        // never chain automation). Knobs 5..7 are blank → ignored.
        if (stepPageAvailable() && stepPageState.selected) {
            if (k < 5) editStepPageKnob(k, delta);
            return;
        }
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
        const model = knobModel();
        const info  = model?.getKnobParamInfo(k) ?? null;
        const track = appState.activeTrack.index;
        if (info && handleAutomationKnob(track, k, info, delta,
                (lane) => portFor(track).setParam('knob_' + (lane + 1) + '_set', info.target + ':' + info.ioKey))) {
            return;
        }
        model?.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    /* Track buttons (CC 40–43): CC43=slot0 … CC40=slot3.
     * Mute+track gesture mutes; otherwise momentary: down opens the track's
     * note layout, up decides tap (latch) vs hold (return to prior state). */
    if (d1 >= TRACK_CC_START && d1 <= TRACK_CC_END) {
        /* The four buttons are hardware, not tracks: they address the focused
         * group's quartet. CC 43 is the group's first track (the mapping is
         * reversed — CC 40 is the fourth). */
        const track = focusedTrack(TRACK_CC_END - d1);
        if (d2 > 0) {
            volumeTrackDown(track);   // arm hold-track + volume knob
            // Mute+track mutes that track; Shift+Mute+track solos it instead.
            // Shift counts if it was down at the Mute press or is down now, so
            // neither ordering of the two modifiers loses the gesture.
            // Either marks the momentary as gestured, so the release no longer
            // toggles the *current* track as well.
            if (muteHeld()) {
                if (muteShiftHeld() || appState.shiftHeld) toggleSolo(track);
                else muteTrack(track);
                momentaryGesture(); appState.dirty = true; return;
            }
            // A track button always exits the Set Parameters page first (it is a
            // global page, not a per-track view), so it can't be saved into the
            // per-track view memory below and re-shown on return to this track.
            if (mainPageActive()) appState.currentView = closeMainPage();
            if (clipPageActive()) appState.currentView = closeClipPage();
            // Snapshot prior state so the restore closure can return exactly here.
            // Note: seqHandleMidi already ran above and updated watchTrack/barOffset,
            // so we capture the pre-switch slot to restore on hold release.
            const prevSlot      = appState.activeTrack.index;
            const prevView      = appState.currentView === VIEW_BROWSE ? appState.browseOrigin : appState.currentView;
            const prevSession   = seqState.sessionMode;
            const prevLoop      = seqState.loopMode;
            const prevWatchTrack = prevSlot; // watchTrack should match active slot
            momentaryDown(d1, () => {
                releaseAllLive();   // the peeked track's notes must not survive the revert
                seqState.sessionMode = prevSession;
                seqState.loopMode = prevLoop;
                selectTrack(prevSlot);
                appState.currentView = prevView;
                seqRestoreWatch(prevWatchTrack);
                appState.initLedsDone = false; appState.initLedIndex = 0;
                appState.dirty = true;
            });
            appState.trackView[appState.activeTrack.index] = prevView;
            seqState.sessionMode = false;
            seqState.loopMode = false;
            appState.masterDetail = false;
            // Cut on switch: no live note outlives the track it was played on.
            releaseAllLive();
            selectTrack(track);
            appState.currentView = appState.trackView[track];
            jogHintTouch(false);
            appState.initLedsDone = false; appState.initLedIndex = 0;
            appState.dirty = true;
        } else {
            volumeTrackUp(track);
            momentaryUp(d1);
            appState.dirty = true;
        }
        return;
    }

    /* Shift */
    if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; return; }

    /* Back */
    if (d1 === MoveBack && d2 > 0) {
        jogHintTouch(false);
        holdTurnCancel();   // Back cancels an active hold-to-modulate
        if (masterDetailActive()) {
            appState.masterDetail = false;   // master detail → back to the slot grid
            appState.dirty = true;
            return;
        }
        if (mainPageActive()) {
            appState.currentView = closeMainPage();
            appState.dirty = true;
            return;
        }
        if (clipPageActive()) {
            appState.currentView = closeClipPage();
            appState.dirty = true;
            return;
        }
        if (appState.currentView === VIEW_BROWSE) {
            appState.currentView = appState.browseOrigin;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            appState.fileBrowserState = null;
            appState.currentView      = appState.browseOrigin;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_KEYS || appState.currentView === VIEW_KNOBS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        } else {
            // Root view → open the Leave-Movy modal (Background vs Close Movy).
            // Release live notes now: the modal swallows pad MIDI while it's up,
            // so a physically-held pad would otherwise strand. Background then
            // parks (sequencer + Phase 1 clock keep running under Move's UI);
            // Shift+Back stays the host's instant full-exit.
            releaseAllLive();
            // Confirming Background hands the foreground to Move, and every
            // release still owed to us goes there instead. Forget them now,
            // while we still know what they are.
            resetHeldInput(true);
            openLeaveModal();
            appState.dirty = true;
        }
        return;
    }

    /* Jog click */
    if (d1 === MoveMainButton && d2 > 0) {
        // Assign-mode: commit the LFO modulation (assign → jump to that LFO's
        // chain page; remove → stay + toast). Consumes the click.
        if (assignActive()) {
            const r = assignCommit();
            if (r) {
                activeModel()?.refreshModulation();   // update the ~ mark immediately
                if (r.assigned) {
                    appState.trackChainIndex[appState.activeTrack.index] = LFO_CHAIN_INDEX;
                    appState.currentView = VIEW_CHAIN;
                    const lm = appState.trackModels[appState.activeTrack.index]?.[LFO_CHAIN_INDEX];
                    if (lm) {
                        lm.changePage(r.lfoIdx - lm.getKnobPage());
                        lm.reload();   // re-read the freshly-written target (cache was stale)
                    }
                } else {
                    seqToast('LFO' + (r.lfoIdx + 1) + ' mod removed');
                }
                appState.dirty = true;
            }
            return;
        }
        // While a step is held, the jog click is navigation-only: drill from the
        // chain into the focused module's params, never open a browser (Back
        // returns to the chain). Lets one held step automate across modules.
        if (anyStepHeld()) {
            if (appState.currentView === VIEW_CHAIN) {
                appState.currentView = VIEW_KNOBS;
                appState.dirty = true;
            }
            return;
        }
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule();
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            activateFileBrowserItem();
        } else if (masterChainActive()) {
            // Master FX chain, mirroring the track chain:
            //  - in the detail page, a click opens the browser to swap the module
            //    (browseOrigin VIEW_CHAIN + masterDetail kept → Back returns to detail);
            //  - on the grid, an empty slot (or Shift) opens the browser to add/swap,
            //    and a loaded slot drills into its detail page.
            const mi = appState.masterChainIndex;
            const isEmpty = masterModel()?.getViewModel().isEmpty ?? false;
            if (appState.masterDetail || appState.shiftHeld || isEmpty) {
                openBrowser(MASTER_FX_SLOTS[mi], 0, () => masterModel()?.reload());
                appState.browseOrigin = VIEW_CHAIN;
            } else {
                appState.masterDetail = true;
                appState.dirty = true;
            }
        } else if (appState.currentView === VIEW_KEYS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_CHAIN || appState.currentView === VIEW_KNOBS) {
            // Holding a file-param knob + jog click opens the file browser — the
            // same gesture works on the module knob page and on the chain page,
            // since the touched param lives on the model regardless of view.
            // browseOrigin returns to whichever view the click happened in.
            const fileTarget = activeModel()?.getFileBrowseTarget() ?? null;
            if (fileTarget) {
                // Capture the origin BEFORE openFileBrowser flips currentView to
                // VIEW_FILE_BROWSE — otherwise Back/select return to the browser
                // itself, leaving a frozen screen.
                appState.browseOrigin = appState.currentView;
                activeModel()?.clearFileOverlay();
                openFileBrowser(
                    appState.activeTrack.index,
                    activeModel()!.getComponentKey(),
                    fileTarget.key,
                    fileTarget.gi,
                    fileTarget.root,
                    fileTarget.filter,
                    fileTarget.startPath,
                    fileTarget.currentPath,
                    fileTarget.requireContains,
                );
            } else if (appState.currentView === VIEW_CHAIN) {
                const isEmpty = activeModel()?.getViewModel().isEmpty ?? false;
                // The LFO slot has no module to add/swap — a click always drills.
                if (!isLfoSlot(chainIndex()) && (appState.shiftHeld || isEmpty)) {
                    openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeTrack.index, () => activeModel()?.reload());
                    appState.browseOrigin = VIEW_CHAIN;
                } else {
                    appState.currentView = VIEW_KNOBS;
                    appState.dirty = true;
                }
            } else if (!isLfoSlot(chainIndex())) {
                // VIEW_KNOBS with no file param held → module browser (the LFO
                // slot has no module to swap, so a click is a no-op there).
                openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeTrack.index, () => activeModel()?.reload());
                appState.browseOrigin = VIEW_KNOBS;
            }
        }
        return;
    }

    /* Jog rotation */
    if (d1 === MoveMainKnob) {
        const delta = decodeDelta(d2);
        if (delta !== 0) {
            jogHintTouch(false);   // a turn answers the hint's question — drop it
            if (assignActive()) { assignCycle(delta); appState.dirty = true; return; }
            if (masterDetailActive()) {
                masterModel()?.changePage(delta > 0 ? 1 : -1);
            } else if (masterGridActive()) {
                appState.masterChainIndex = Math.max(0, Math.min(3, appState.masterChainIndex + (delta > 0 ? 1 : -1)));
            } else if (appState.currentView === VIEW_CHAIN) {
                const dir = delta > 0 ? 1 : -1;
                if (stepPageAvailable()) {
                    if (stepPageState.selected) {
                        if (dir > 0) setStepPageSelected(false);       // leave step → slots
                    } else if (dir < 0 && chainIndex() === 0) {
                        setStepPageSelected(true);                     // enter step page
                    } else {
                        setChainIndex(Math.max(0, Math.min(LFO_CHAIN_INDEX, chainIndex() + dir)));
                    }
                } else {
                    setChainIndex(Math.max(0, Math.min(LFO_CHAIN_INDEX, chainIndex() + dir)));
                }
                mlog('chain chainIndex=' + chainIndex());
            } else if (appState.currentView === VIEW_KNOBS) {
                const dir = delta > 0 ? 1 : -1;
                const m = activeModel();
                /* Shift+jog is an explicit "next section" gesture: it skips a
                 * level's overflow pages, and bypasses the step-page-at-bank-0
                 * interplay a plain jog has. */
                if (appState.shiftHeld) {
                    m?.changePageGroup(dir);
                } else if (stepPageAvailable()) {
                    const onBank0 = (m?.getKnobPage?.() ?? 0) === 0;
                    if (stepPageState.selected) {
                        if (dir > 0) setStepPageSelected(false);
                    } else if (dir < 0 && onBank0) {
                        setStepPageSelected(true);
                    } else {
                        m?.changePage(dir);
                    }
                } else {
                    m?.changePage(dir);
                }
            } else if (appState.currentView === VIEW_BROWSE) {
                browserState.browseIndex = Math.max(0, Math.min(browserState.modules.length - 1, browserState.browseIndex + delta));
            } else if (appState.currentView === VIEW_FILE_BROWSE) {
                navigateFileBrowser(delta);
            }
            appState.dirty = true;
        }
        return;
    }

    /* Left/Right — master FX slot nav in session mode; page nav in VIEW_KNOBS;
     * chain-slot nav in VIEW_CHAIN. */
    if (d1 === MoveLeft && d2 > 0) {
        if (masterDetailActive()) {
            masterModel()?.changePage(-1);
        } else if (masterGridActive()) {
            appState.masterChainIndex = Math.max(0, appState.masterChainIndex - 1);
        } else if (appState.currentView === VIEW_CHAIN) {
            if (stepPageAvailable() && !stepPageState.selected && chainIndex() === 0) setStepPageSelected(true);
            else if (!(stepPageAvailable() && stepPageState.selected)) setChainIndex(Math.max(0, chainIndex() - 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            const m = activeModel();
            if (stepPageAvailable() && !stepPageState.selected && (m?.getKnobPage?.() ?? 0) === 0) setStepPageSelected(true);
            else if (!(stepPageAvailable() && stepPageState.selected)) m?.changePage(-1);
        }
        appState.dirty = true;
        return;
    }
    if (d1 === MoveRight && d2 > 0) {
        if (masterDetailActive()) {
            masterModel()?.changePage(1);
        } else if (masterGridActive()) {
            appState.masterChainIndex = Math.min(3, appState.masterChainIndex + 1);
        } else if (appState.currentView === VIEW_CHAIN) {
            if (stepPageAvailable() && stepPageState.selected) setStepPageSelected(false);
            else setChainIndex(Math.min(LFO_CHAIN_INDEX, chainIndex() + 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            const m = activeModel();
            if (stepPageAvailable() && stepPageState.selected) setStepPageSelected(false);
            else m?.changePage(1);
        }
        appState.dirty = true;
        return;
    }

    /* +/- buttons shift the chromatic pad layout by an octave. Disabled on drum
     * tracks (drum pad layout has no octave concept). On melodic tracks: press
     * flashes the button white, release clears it. */
    if (d1 === MoveUp || d1 === MoveDown) {
        const dir = d1 === MoveUp ? 1 : -1;
        /* In Session view the pads are the clip grid, so there is no octave to
         * shift and these buttons move the focused GROUP instead. Checked
         * before the drum guard: group navigation is not a per-track concept,
         * so a drum track must not disable it. */
        if (seqState.sessionMode) {
            const gdir = d1 === MoveUp ? GROUP_DIR_UP : GROUP_DIR_DOWN;
            if (d2 > 0 && focusGroupStep(gdir)) {
                appState.initLedsDone = false; appState.initLedIndex = 0;
            }
            setButtonLED(d1, d2 > 0 ? WHITE_BRIGHT : WHITE_DIM, true);
            appState.dirty = true;
            return;
        }
        if (trackIsDrum(appState.activeTrack.index)) return;
        if (d2 > 0) {
            changeOctave(appState.activeTrack.index, dir);
            setButtonLED(d1, WHITE_BRIGHT, true);
        } else {
            setButtonLED(d1, WHITE_DIM, true);
        }
        appState.dirty = true;
        return;
    }
}
