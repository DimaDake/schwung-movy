import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from '../app/state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeRoot, releaseAllNotes } from '../keyboard/handler.js';
import { drumPadOn, drumPadOff } from '../keyboard/drum-handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { openFileBrowser, navigateFileBrowser, activateFileBrowserItem } from '../browser/file-handler.js';
import { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } from '../seq/router.js';
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

export function onMidiMessageInternal(data: number[]): void {
    if (!data || data.length < 3) return;
    if (seqHandleMidi(data)) return;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7 */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        if (d2 > 0) activeModel()?.handleKnobTouch(d1);
        else        activeModel()?.handleKnobRelease(d1);
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
        if ((status & 0xF0) === 0x90 && d2 > 0) {
            if (drumCfg) {
                const pad = drumPadOn(d1, PAD_MIN, appState.shiftHeld, drumCfg, keyboardState.rootNote, model!.getComponentKey(), appState.activeSlot);
                if (pad !== null) model!.updateDrumPad(pad, d1);
            } else {
                noteOn(d1, PAD_MIN, PAD_MAX);
            }
            seqNotePadPlayed(appState.activeSlot, d1, keyboardState.lastPlayedNote, d2);
            return;
        }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            if (drumCfg) {
                drumPadOff(d1, PAD_MIN, drumCfg, keyboardState.rootNote);
            } else {
                noteOff(d1, PAD_MIN);
            }
            seqNotePadReleased(d1);
            return;
        }
    }

    /* Knob CC (71–78) */
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
        activeModel()?.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    /* Track buttons (CC 40–43): newSlot = 43 - d1  →  CC43=slot0, CC40=slot3 */
    if (d1 >= TRACK_CC_START && d1 <= TRACK_CC_END && d2 > 0) {
        const newSlot = TRACK_CC_END - d1;
        if (newSlot !== appState.activeSlot) {
            appState.trackView[appState.activeSlot] =
                appState.currentView === VIEW_BROWSE ? appState.browseOrigin : appState.currentView;
            appState.activeSlot = newSlot;
            appState.currentView = appState.trackView[newSlot];
            appState.jogTouched = false;
        }
        appState.dirty = true;
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
            releaseAllNotes();
            host_exit_module();
        }
        return;
    }

    /* Jog click */
    if (d1 === MoveMainButton && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule(appState.activeSlot);
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            activateFileBrowserItem();
        } else if (appState.currentView === VIEW_CHAIN) {
            const isEmpty = activeModel()?.getViewModel().isEmpty ?? false;
            if (appState.shiftHeld || isEmpty) {
                openBrowser(appState.activeSlot, chainIndex());
                appState.browseOrigin = VIEW_CHAIN;
            } else {
                appState.currentView = VIEW_KNOBS;
                appState.dirty = true;
            }
        } else if (appState.currentView === VIEW_KNOBS) {
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
                appState.browseOrigin = VIEW_KNOBS;
            } else {
                openBrowser(appState.activeSlot, chainIndex());
                appState.browseOrigin = VIEW_KNOBS;
            }
        } else if (appState.currentView === VIEW_KEYS) {
            appState.currentView = VIEW_CHAIN;
            appState.dirty = true;
        }
        return;
    }

    /* Jog rotation */
    if (d1 === MoveMainKnob) {
        const delta = decodeDelta(d2);
        if (delta !== 0) {
            if (appState.currentView === VIEW_CHAIN) {
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

    /* Left/Right — page nav in VIEW_KNOBS; chain-slot nav in VIEW_CHAIN */
    if (d1 === MoveLeft && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN) {
            setChainIndex(Math.max(0, chainIndex() - 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            activeModel()?.changePage(-1);
        }
        appState.dirty = true;
        return;
    }
    if (d1 === MoveRight && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN) {
            setChainIndex(Math.min(3, chainIndex() + 1));
        } else if (appState.currentView === VIEW_KNOBS) {
            activeModel()?.changePage(1);
        }
        appState.dirty = true;
        return;
    }

    /* Up → VIEW_KEYS from CHAIN or KNOBS */
    if (d1 === MoveUp && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN || appState.currentView === VIEW_KNOBS) {
            appState.currentView = VIEW_KEYS;
            appState.dirty = true;
        } else if (appState.currentView === VIEW_KEYS) {
            changeRoot(1, PAD_MIN, PAD_MAX);
        }
        return;
    }
    if (d1 === MoveDown && d2 > 0 && appState.currentView === VIEW_KEYS) {
        changeRoot(-1, PAD_MIN, PAD_MAX);
        return;
    }
}
