import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS } from '../chain/config.js';
import { drumPadLedColor } from '../keyboard/leds.js';
import { chromaticPadColor } from '../seq/pads.js';
import { midiNoteName } from '../keyboard/notes.js';
import { renderKnobsView } from '../renderer/knob-view.js';
import { renderKeysView }  from '../renderer/keys-view.js';
import { renderBrowseView } from '../renderer/browse-view.js';
import { renderChainView }    from '../renderer/chain-view.js';
import { renderFileBrowseView } from '../renderer/file-browse-view.js';
import { updateKnobLEDs }  from '../renderer/knob-leds.js';
import { seqEngineTick } from '../seq/engine.js';
import { seqPersistTick } from '../seq/persist.js';
import { seqLedsTick, seqLedsInvalidate } from '../seq/leds.js';
import { seqSetLane } from '../seq/router.js';
import { activeHasNote, maxBarOffset, seqState } from '../seq/state.js';
import { engineReady } from '../seq/engine.js';
import {
    drawLoopStrip, drawSeqToast, drawSeqHeader,
    seqToastActive, seqToastTick,
    seqHeaderActive, seqHeaderTick,
} from '../seq/render.js';

const PAD_MIN        = MovePads[0];
const PAD_MAX        = MovePads[MovePads.length - 1];
const LED_INIT_BATCH = 8;

let lastToastShowing = false;
let lastSessionMode = false;

export function tick(): void {
    seqEngineTick();
    seqPersistTick();
    /* Session toggle changes pad ownership: invalidate the seq LED cache and
     * re-init the instrument pad LEDs when returning to Note mode. */
    if (seqState.sessionMode !== lastSessionMode) {
        lastSessionMode = seqState.sessionMode;
        seqLedsInvalidate();
        if (!seqState.sessionMode) { appState.initLedsDone = false; appState.initLedIndex = 0; }
        appState.dirty = true;
    }
    seqLedsTick(appState.shiftHeld, appState.currentView, seqState.barOffset, maxBarOffset());
    if (!appState.initLedsDone && !seqState.sessionMode) {
        const total = PAD_MAX - PAD_MIN + 1;
        const end   = Math.min(appState.initLedIndex + LED_INIT_BATCH, total);
        const base  = keyboardState.rootNote;
        for (let i = appState.initLedIndex; i < end; i++) {
            const p = PAD_MIN + i;
            setLED(p, chromaticPadColor(p, PAD_MIN, base, appState.activeSlot, false, false), true);
        }
        appState.initLedIndex = end;
        if (appState.initLedIndex >= total) { appState.initLedsDone = true; appState.dirty = true; }
        return;
    }

    const chainIdx    = appState.trackChainIndex[appState.activeSlot];
    const activeModel = appState.trackModels[appState.activeSlot]?.[chainIdx];
    const modelDirty  = activeModel?.tick() ?? false;

    /* Keep the sequencer's watched step-LED lane in sync with the active
     * module: a drum module filters steps to the selected pad's note; a
     * melodic module shows all notes (lane -1). */
    const dvm0   = activeModel?.getViewModel();
    const isDrum = (dvm0?.drumPadCount ?? 0) > 0;
    if (isDrum) {
        const cfg = activeModel!.getDrumConfig();
        seqSetLane(cfg ? cfg.padNoteStart + (dvm0!.drumCurrentPad - 1) : -1);
    } else {
        seqSetLane(-1);
    }

    seqToastTick();
    seqHeaderTick();
    const toastShowing = seqToastActive();
    const headerShowing = seqHeaderActive();

    if (modelDirty || appState.dirty || toastShowing !== lastToastShowing || headerShowing) {
        if (appState.currentView === VIEW_KEYS) {
            renderKeysView(activeModel?.getModuleName() ?? '—', keyboardState.rootNote, midiNoteName);
        } else if (appState.currentView === VIEW_KNOBS) {
            const vm = activeModel!.getViewModel();
            renderKnobsView(vm, appState.jogTouched, appState.activeSlot);
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_CHAIN) {
            const vm = activeModel!.getViewModel();
            renderChainView(vm, chainIdx, appState.jogTouched, appState.activeSlot);
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            if (appState.fileBrowserState) renderFileBrowseView(appState.fileBrowserState);
        } else {
            const browseTitle = CHAIN_SLOTS[chainIdx]?.label ?? 'Module';
            renderBrowseView(browserState.modules, browserState.browseIndex, browseTitle);
        }
        if (toastShowing) drawSeqToast();
        if (headerShowing) drawSeqHeader();
        lastToastShowing = toastShowing;
        appState.dirty = false;

        /* ── Drum pad LEDs ──────────────────────────────────────────────────── */
        /* In Session mode the clip grid owns the pads (painted by seqLedsTick). */
        const dvm       = activeModel?.getViewModel();
        const drumNow   = !seqState.sessionMode && (dvm?.drumPadCount ?? 0) > 0;
        if (drumNow) {
            const drumCfg = activeModel!.getDrumConfig()!;
            const track   = seqState.watchTrack;
            for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
                const p = PAD_MIN + i;
                // Derive the pad's MIDI note to check activeHasNote (mirrors drumPadLedColor's mapping).
                const idx = p - PAD_MIN, col = idx % 8, row = Math.floor(idx / 8);
                const dp  = drumCfg.rawMidi ? p - drumCfg.padNoteStart + 1 : row * 4 + col + 1;
                const note = drumCfg.rawMidi ? p : drumCfg.padNoteStart + dp - 1;
                const playing = activeHasNote(track, note);
                setLED(p, drumPadLedColor(p, PAD_MIN, drumCfg, keyboardState.rootNote, dvm!.drumCurrentPhysPad, track, playing), true);
            }
            appState.drumActive = true;
        } else if (appState.drumActive) {
            appState.drumActive = false;
            appState.initLedsDone = false;
            appState.initLedIndex = 0;
        }
    }

    /* Loop Overview strip overlays the bottom of the param view whenever the
     * sequencer is live; a toast temporarily covers it. Drawn every tick (not
     * just on dirty frames) so the playhead sweeps continuously. */
    if (engineReady() && !seqToastActive()) {
        drawLoopStrip();
    }
}
