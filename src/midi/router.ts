import { appState, trackIsDrum, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from '../app/state.js';
import { CHAIN_SLOTS, MASTER_FX_SLOTS } from '../chain/config.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeRoot, releaseAllNotes } from '../keyboard/handler.js';
import { drumPadOn, drumPadOff } from '../keyboard/drum-handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { openFileBrowser, navigateFileBrowser, activateFileBrowserItem } from '../browser/file-handler.js';
import { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, muteHeld, muteTrack, seqRestoreWatch } from '../seq/router.js';
import { seqState } from '../seq/state.js';
import { WHITE_BRIGHT, WHITE_DIM } from '../seq/colors.js';
import { momentaryDown, momentaryUp } from '../seq/momentary.js';
import { handleAutomationKnob, clearLaneForKnob, automationKnobReleased, automationKnobTouched } from '../seq/automation.js';
import { deleteActive, markDeleteActed } from '../seq/edit-ops.js';
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

export function onMidiMessageInternal(data: number[]): void {
    if (!data || data.length < 3) return;
    if (seqHandleMidi(data, appState.shiftHeld)) return;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7. Hold-Clear (Delete) + touch
     * clears that knob's automation lane. */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        if (d2 > 0) {
            const info = knobModel()?.getKnobParamInfo(d1) ?? null;
            if (deleteActive() && info) {
                clearLaneForKnob(appState.activeSlot, info);
                markDeleteActed();   // Clear release must not also delete the clip
                return;
            }
            knobModel()?.handleKnobTouch(d1);
            automationKnobTouched(d1);    // arm tap-to-clear in step-auto mode
        } else {
            const info = knobModel()?.getKnobParamInfo(d1) ?? null;
            knobModel()?.handleKnobRelease(d1);
            if (info) automationKnobReleased(appState.activeSlot, d1, info);
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
        const model   = activeModel();
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
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
        const model = knobModel();
        const info  = model?.getKnobParamInfo(k) ?? null;
        const track = appState.activeSlot;
        if (info && handleAutomationKnob(track, k, info, delta,
                (lane) => shadow_set_param(track, 'knob_' + (lane + 1) + '_set', info.target + ':' + info.key))) {
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
            if (muteHeld()) { muteTrack(track); appState.dirty = true; return; }
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
            releaseAllNotes(appState.activeSlot);
            host_exit_module();
        }
        return;
    }

    /* Jog click */
    if (d1 === MoveMainButton && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule();
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            activateFileBrowserItem();
        } else if (masterChainActive()) {
            // Master FX chain: click opens the module browser for the focused
            // master slot (empty slot adds; Shift swaps an existing module).
            const mi = appState.masterChainIndex;
            const isEmpty = masterModel()?.getViewModel().isEmpty ?? false;
            if (appState.shiftHeld || isEmpty) {
                openBrowser(MASTER_FX_SLOTS[mi], 0, () => masterModel()?.reload());
                appState.browseOrigin = VIEW_CHAIN;
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
                );
                appState.browseOrigin = appState.currentView;
            } else if (appState.currentView === VIEW_CHAIN) {
                const isEmpty = activeModel()?.getViewModel().isEmpty ?? false;
                if (appState.shiftHeld || isEmpty) {
                    openBrowser(CHAIN_SLOTS[chainIndex()], appState.activeSlot, () => activeModel()?.reload());
                    appState.browseOrigin = VIEW_CHAIN;
                } else {
                    appState.currentView = VIEW_KNOBS;
                    appState.dirty = true;
                }
            } else {
                // VIEW_KNOBS with no file param held → module browser.
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
            if (masterChainActive()) {
                appState.masterChainIndex = Math.max(0, Math.min(3, appState.masterChainIndex + (delta > 0 ? 1 : -1)));
            } else if (appState.currentView === VIEW_CHAIN) {
                setChainIndex(Math.max(0, Math.min(3, chainIndex() + (delta > 0 ? 1 : -1))));
                mlog('chain chainIndex=' + chainIndex());
            } else if (appState.currentView === VIEW_KNOBS) {
                activeModel()?.changePage(delta > 0 ? 1 : -1);
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
        if (masterChainActive()) {
            appState.masterChainIndex = Math.max(0, appState.masterChainIndex - 1);
        } else if (appState.currentView === VIEW_CHAIN) {
            setChainIndex(Math.max(0, chainIndex() - 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            activeModel()?.changePage(-1);
        }
        appState.dirty = true;
        return;
    }
    if (d1 === MoveRight && d2 > 0) {
        if (masterChainActive()) {
            appState.masterChainIndex = Math.min(3, appState.masterChainIndex + 1);
        } else if (appState.currentView === VIEW_CHAIN) {
            setChainIndex(Math.min(3, chainIndex() + 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            activeModel()?.changePage(1);
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
            changeRoot(d1 === MoveUp ? 12 : -12, appState.activeSlot, PAD_MIN, PAD_MAX);
            setButtonLED(d1, WHITE_BRIGHT, true);
        } else {
            setButtonLED(d1, WHITE_DIM, true);
        }
        appState.dirty = true;
        return;
    }
}
