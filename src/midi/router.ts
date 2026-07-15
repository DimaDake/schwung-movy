import { appState, trackIsDrum, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE, VIEW_MAIN_PARAMS } from '../app/state.js';
import { mainPageActive, mainPageKnob, mainPageTouch, mainPageRelease, closeMainPage } from '../seq/main-page.js';
import { clipPageActive, clipPageKnob, clipPageTouch, clipPageRelease, closeClipPage } from '../seq/clip-page.js';
import { CHAIN_SLOTS, MASTER_FX_SLOTS, LFO_CHAIN_INDEX, isLfoSlot } from '../chain/config.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeRoot, releaseAllNotes } from '../keyboard/handler.js';
import { drumPadOn, drumPadOff } from '../keyboard/drum-handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { openFileBrowser, navigateFileBrowser, activateFileBrowserItem } from '../browser/file-handler.js';
import { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, muteHeld, muteTrack, seqRestoreWatch } from '../seq/router.js';
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
import { mlog } from '../log.js';

const PAD_MIN        = MovePads[0];
const PAD_MAX        = MovePads[MovePads.length - 1];
const KNOB_CC_BASE   = MoveKnob1;
const NUM_KNOBS      = 8;
const JOG_TOUCH      = MoveKnob8Touch + 1;  /* note 8 = main encoder touch */
const TRACK_CC_START = 40;                   /* MoveRow4 → slot 3 */
const TRACK_CC_END   = 43;                   /* MoveRow1 → slot 0 */

function activeModel() {
    return appState.trackModels[appState.activeSlot]?.[appState.trackChainIndex[appState.activeSlot]];
}

function chainIndex(): number { return appState.trackChainIndex[appState.activeSlot]; }
function setChainIndex(i: number): void { appState.trackChainIndex[appState.activeSlot] = i; }

/* The track's instrument always lives in chain slot 1 (synth). Drum pad input
 * is keyed off it — not the focused chain slot — so pads keep sounding and
 * selecting drum lanes while the user edits the MIDI FX or an audio-FX slot on
 * the same track. (tick.ts already reads drum status/lane from this slot.) */
function synthModel() {
    return appState.trackModels[appState.activeSlot]?.[1];
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

    // The Leave-Movy modal owns all input while it is up: jog turn moves the
    // highlight, jog click confirms (Background parks / Close exits), Back
    // cancels. Everything else is swallowed so nothing fires behind it.
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
        return;
    }

    if (seqHandleMidi(data, appState.shiftHeld)) return;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7. Hold-Clear (Delete) + touch
     * clears that knob's automation lane. */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        // Step page owns the knobs: a touch shows that param's top toast; the
        // step params are intrinsic (no automation lane / model touch).
        if (stepPageAvailable() && stepPageState.selected) {
            setStepTouchedKnob(d2 > 0 && d1 < 5 ? d1 : -1);
            appState.dirty = true;
            return;
        }
        if (mainPageActive()) {
            if (d1 < 5) {   // knobs 0-3 + LINK (knob 4)
                if (d2 > 0) mainPageTouch(d1, true);
                else mainPageRelease(d1);
            }
            appState.dirty = true;
            return;
        }
        if (clipPageActive()) {
            if (d1 < 3) {
                if (d2 > 0) clipPageTouch(d1, true);
                else clipPageRelease(d1, appState.activeSlot);
            }
            appState.dirty = true;
            return;
        }
        if (d2 > 0) {
            const info = knobModel()?.getKnobParamInfo(d1) ?? null;
            if (deleteActive() && info) {
                clearLaneForKnob(appState.activeSlot, info);
                markDeleteActed();   // Clear release must not also delete the clip
                return;
            }
            knobModel()?.handleKnobTouch(d1);
            automationKnobTouched(d1);    // arm tap-to-clear in step-auto mode
            holdTouch(appState.activeSlot, d1, info);   // arm hold-to-modulate
        } else {
            const info = knobModel()?.getKnobParamInfo(d1) ?? null;
            if (knobModel()?.handleKnobRelease(d1)) seqToast('Wrong preset type');
            if (info) automationKnobReleased(appState.activeSlot, d1, info);
            holdRelease(d1);
        }
        return;
    }

    /* Main encoder (jog) touch: note=8 */
    if ((status & 0xF0) === 0x90 && d1 === JOG_TOUCH) {
        if (appState.currentView === VIEW_CHAIN || appState.currentView === VIEW_KNOBS) {
            appState.jogTouched = d2 > 0;
            appState.dirty = true;
        }
        return;
    }

    /* Other encoder touch (note 9) — ignore */
    if ((status & 0xF0) === 0x90 && d1 < 10) return;

    /* Pad notes */
    if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
        const model   = synthModel();
        const drumCfg = model?.getDrumConfig() ?? null;
        const track = appState.activeSlot;
        if ((status & 0xF0) === 0x90 && d2 > 0) {
            const vel = seqState.fullVelocity ? 127 : d2;
            if (drumCfg) {
                const pad = drumPadOn(d1, PAD_MIN, appState.shiftHeld, drumCfg, keyboardState.rootNote, model!.getComponentKey(), track, vel);
                if (pad !== null) model!.updateDrumPad(pad, d1);
            } else {
                noteOn(d1, PAD_MIN, track, vel);
            }
            seqNotePadPlayed(track, d1, keyboardState.lastPlayedNote, vel);
            return;
        }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            if (drumCfg) {
                drumPadOff(d1, PAD_MIN, drumCfg, keyboardState.rootNote, track);
            } else {
                noteOff(d1, PAD_MIN, track);
            }
            seqNotePadReleased(d1);
            return;
        }
    }

    /* Knob CC (71–78) — automation gets first refusal (hold-step / Rec / a
     * param already bound to a lane); otherwise the normal param-set path. */
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        holdTurnCancel();   // a knob turn cancels a pending / active hold-to-modulate
        // Step page owns the knobs while it is selected (intrinsic trig props,
        // never chain automation). Knobs 5..7 are blank → ignored.
        if (stepPageAvailable() && stepPageState.selected) {
            if (k < 5) editStepPageKnob(k, delta);
            return;
        }
        if (mainPageActive()) {
            // Knobs 0-3 = tempo/swing/root/key; knob 4 = LINK toggle.
            if (k < 5) { mainPageKnob(k, delta, appState.activeSlot); appState.dirty = true; }
            return;
        }
        if (clipPageActive()) {
            if (k < 3) { clipPageKnob(k, delta, appState.activeSlot); appState.dirty = true; }
            return;
        }
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
        const model = knobModel();
        const info  = model?.getKnobParamInfo(k) ?? null;
        const track = appState.activeSlot;
        if (info && handleAutomationKnob(track, k, info, delta,
                (lane) => shadow_set_param(track, 'knob_' + (lane + 1) + '_set', info.target + ':' + info.ioKey))) {
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
        const track = TRACK_CC_END - d1;
        if (d2 > 0) {
            if (muteHeld()) { muteTrack(track); momentaryGesture(); appState.dirty = true; return; }
            // A track button always exits the Set Parameters page first (it is a
            // global page, not a per-track view), so it can't be saved into the
            // per-track view memory below and re-shown on return to this track.
            if (mainPageActive()) appState.currentView = closeMainPage();
            if (clipPageActive()) appState.currentView = closeClipPage();
            // Snapshot prior state so the restore closure can return exactly here.
            // Note: seqHandleMidi already ran above and updated watchTrack/barOffset,
            // so we capture the pre-switch slot to restore on hold release.
            const prevSlot      = appState.activeSlot;
            const prevView      = appState.currentView === VIEW_BROWSE ? appState.browseOrigin : appState.currentView;
            const prevSession   = seqState.sessionMode;
            const prevLoop      = seqState.loopMode;
            const prevWatchTrack = prevSlot; // watchTrack should match active slot
            momentaryDown(d1, () => {
                seqState.sessionMode = prevSession;
                seqState.loopMode = prevLoop;
                appState.activeSlot = prevSlot;
                appState.currentView = prevView;
                seqRestoreWatch(prevWatchTrack);
                appState.initLedsDone = false; appState.initLedIndex = 0;
                appState.dirty = true;
            });
            appState.trackView[appState.activeSlot] = prevView;
            seqState.sessionMode = false;
            seqState.loopMode = false;
            appState.masterDetail = false;
            appState.activeSlot = track;
            appState.currentView = appState.trackView[track];
            appState.jogTouched = false;
            appState.initLedsDone = false; appState.initLedIndex = 0;
            appState.dirty = true;
        } else {
            momentaryUp(d1);
            appState.dirty = true;
        }
        return;
    }

    /* Shift */
    if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; return; }

    /* Back */
    if (d1 === MoveBack && d2 > 0) {
        appState.jogTouched = false;
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
            releaseAllNotes(appState.activeSlot);
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
                    appState.trackChainIndex[appState.activeSlot] = LFO_CHAIN_INDEX;
                    appState.currentView = VIEW_CHAIN;
                    const lm = appState.trackModels[appState.activeSlot]?.[LFO_CHAIN_INDEX];
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
                    appState.activeSlot,
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
                    openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeSlot, () => activeModel()?.reload());
                    appState.browseOrigin = VIEW_CHAIN;
                } else {
                    appState.currentView = VIEW_KNOBS;
                    appState.dirty = true;
                }
            } else if (!isLfoSlot(chainIndex())) {
                // VIEW_KNOBS with no file param held → module browser (the LFO
                // slot has no module to swap, so a click is a no-op there).
                openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeSlot, () => activeModel()?.reload());
                appState.browseOrigin = VIEW_KNOBS;
            }
        }
        return;
    }

    /* Jog rotation */
    if (d1 === MoveMainKnob) {
        const delta = decodeDelta(d2);
        if (delta !== 0) {
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
                if (stepPageAvailable()) {
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
        if (trackIsDrum(appState.activeSlot)) return;
        if (d2 > 0) {
            changeRoot(d1 === MoveUp ? 12 : -12, appState.activeSlot);
            setButtonLED(d1, WHITE_BRIGHT, true);
        } else {
            setButtonLED(d1, WHITE_DIM, true);
        }
        appState.dirty = true;
        return;
    }
}
