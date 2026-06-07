import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE } from '../app/state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { noteOn, noteOff, changeRoot, releaseAllNotes } from '../keyboard/handler.js';
import { openBrowser, loadSelectedModule } from '../browser/handler.js';
import { mlog } from '../log.js';

const PAD_MIN = MovePads[0];
const PAD_MAX = MovePads[MovePads.length - 1];
const KNOB_CC_BASE = MoveKnob1;
const NUM_KNOBS    = 8;

export function onMidiMessageInternal(data: number[]): void {
    if (!data || data.length < 3) return;
    const { model } = appState;
    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7 */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        if (d2 > 0) model?.handleKnobTouch(d1);
        else        model?.handleKnobRelease(d1);
        return;
    }
    if ((status & 0xF0) === 0x90 && d1 < 10) return;  /* encoder touch — ignore */

    if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
        if ((status & 0xF0) === 0x90 && d2 > 0) { noteOn(d1, PAD_MIN, PAD_MAX);  return; }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            noteOff(d1, PAD_MIN); return;
        }
    }

    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        mlog('knobCC k=' + k + ' d2=' + d2 + ' delta=' + delta);
        model?.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    if (d1 === MoveShift) { appState.shiftHeld = d2 > 0; return; }

    if (d1 === MoveBack && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE || appState.currentView === VIEW_KEYS) {
            appState.currentView = VIEW_KNOBS; appState.dirty = true;
        } else {
            releaseAllNotes();
            host_exit_module();
        }
        return;
    }

    if (d1 === MoveMainButton && d2 > 0) {
        if (appState.currentView === VIEW_BROWSE) {
            loadSelectedModule(appState.activeSlot);
        } else {
            appState.currentView = (appState.currentView === VIEW_KNOBS) ? VIEW_KEYS : VIEW_KNOBS;
            appState.dirty = true;
        }
        return;
    }

    if (appState.currentView === VIEW_KNOBS) {
        if (d1 === MoveMainKnob) {
            const delta = decodeDelta(d2);
            if (delta !== 0) { mlog('jog bank delta=' + delta); model?.changePage(delta > 0 ? 1 : -1); appState.dirty = true; }
            return;
        }
        if (d1 === MoveLeft  && d2 > 0) { appState.shiftHeld ? openBrowser(appState.activeSlot) : model?.changePage(-1); appState.dirty = true; return; }
        if (d1 === MoveRight && d2 > 0) { appState.shiftHeld ? openBrowser(appState.activeSlot) : model?.changePage(1);  appState.dirty = true; return; }
    }

    if (appState.currentView === VIEW_KEYS) {
        if (d1 === MoveLeft  && d2 > 0) { appState.shiftHeld ? openBrowser(appState.activeSlot) : changeRoot(-12, PAD_MIN, PAD_MAX); return; }
        if (d1 === MoveRight && d2 > 0) { appState.shiftHeld ? openBrowser(appState.activeSlot) : changeRoot(12,  PAD_MIN, PAD_MAX); return; }
        if (d1 === MoveUp    && d2 > 0) { changeRoot(1,  PAD_MIN, PAD_MAX); return; }
        if (d1 === MoveDown  && d2 > 0) { changeRoot(-1, PAD_MIN, PAD_MAX); return; }
    }

    if (appState.currentView === VIEW_BROWSE && d1 === MoveMainKnob) {
        const delta = decodeDelta(d2);
        if (delta !== 0) {
            browserState.browseIndex = Math.max(0, Math.min(browserState.modules.length - 1, browserState.browseIndex + delta));
            appState.dirty = true;
        }
    }
}
