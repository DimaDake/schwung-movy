import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN } from '../app/state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeRoot, releaseAllNotes } from '../keyboard/handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { mlog } from '../log.js';

const PAD_MIN      = MovePads[0];
const PAD_MAX      = MovePads[MovePads.length - 1];
const KNOB_CC_BASE = MoveKnob1;
const NUM_KNOBS    = 8;
const JOG_TOUCH    = MoveKnob8Touch + 1;  /* note 8 = main encoder touch */

export function onMidiMessageInternal(data: number[]): void {
    if (!data || data.length < 3) return;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7 */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        const active = appState.chainModels[appState.chainIndex];
        if (d2 > 0) active?.handleKnobTouch(d1);
        else        active?.handleKnobRelease(d1);
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
        if ((status & 0xF0) === 0x90 && d2 > 0) { noteOn(d1, PAD_MIN, PAD_MAX);  return; }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            noteOff(d1, PAD_MIN); return;
        }
    }

    /* Knob CC (71–78) */
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
        appState.chainModels[appState.chainIndex]?.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    /* Shift */
    if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; return; }

    /* Back */
    if (d1 === MoveBack && d2 > 0) {
        appState.jogTouched = false;
        if (appState.currentView === VIEW_BROWSE) {
            appState.currentView = appState.browseOrigin;
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
        } else if (appState.currentView === VIEW_CHAIN) {
            const isEmpty = appState.chainModels[appState.chainIndex]?.getViewModel().isEmpty ?? false;
            if (appState.shiftHeld || isEmpty) {
                openBrowser(appState.activeSlot, appState.chainIndex);
                appState.browseOrigin = VIEW_CHAIN;
            } else {
                appState.currentView = VIEW_KNOBS;
                appState.dirty = true;
            }
        } else if (appState.currentView === VIEW_KNOBS) {
            openBrowser(appState.activeSlot, appState.chainIndex);
            appState.browseOrigin = VIEW_KNOBS;
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
                appState.chainIndex = Math.max(0, Math.min(3, appState.chainIndex + (delta > 0 ? 1 : -1)));
                mlog('chain chainIndex=' + appState.chainIndex);
            } else if (appState.currentView === VIEW_KNOBS) {
                appState.chainModels[appState.chainIndex]?.changePage(delta > 0 ? 1 : -1);
            } else if (appState.currentView === VIEW_BROWSE) {
                browserState.browseIndex = Math.max(0, Math.min(browserState.modules.length - 1, browserState.browseIndex + delta));
            }
            appState.dirty = true;
        }
        return;
    }

    /* Left/Right — page nav in VIEW_KNOBS; chain-slot nav in VIEW_CHAIN */
    if (d1 === MoveLeft && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN) {
            appState.chainIndex = Math.max(0, appState.chainIndex - 1);
        } else if (appState.currentView === VIEW_KNOBS) {
            appState.chainModels[appState.chainIndex]?.changePage(-1);
        }
        appState.dirty = true;
        return;
    }
    if (d1 === MoveRight && d2 > 0) {
        if (appState.currentView === VIEW_CHAIN) {
            appState.chainIndex = Math.min(3, appState.chainIndex + 1);
        } else if (appState.currentView === VIEW_KNOBS) {
            appState.chainModels[appState.chainIndex]?.changePage(1);
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
