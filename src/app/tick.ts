import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { MASTER_FX_SLOTS } from '../chain/config.js';
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
let lastHeaderShowing = false;
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

    const mIdx        = appState.masterChainIndex;
    const masterModel = seqState.sessionMode ? appState.masterFxModels[mIdx] : null;
    const masterDirty = masterModel?.tick() ?? false;

    /* Drum status comes from the synth slot (index 1) regardless of which
     * chain module is currently selected — drum pads and step lane stay active
     * even when the user is browsing FX parameters on the same track. */
    const synthModel = appState.trackModels[appState.activeSlot]?.[1];
    const synthDvm   = synthModel?.getViewModel();
    const isDrum     = (synthDvm?.drumPadCount ?? 0) > 0;
    if (isDrum) {
        const cfg = synthModel!.getDrumConfig();
        seqSetLane(cfg ? cfg.padNoteStart + (synthDvm!.drumCurrentPad - 1) : -1);
    } else {
        seqSetLane(-1);
    }

    seqToastTick();
    seqHeaderTick();
    const toastShowing = seqToastActive();
    const headerShowing = seqHeaderActive();

    if (modelDirty || masterDirty || appState.dirty || toastShowing !== lastToastShowing
        || headerShowing !== lastHeaderShowing) {
        if (seqState.sessionMode) {
            const vm = masterModel!.getViewModel();
            renderChainView(vm, mIdx, appState.jogTouched, 'MASTER', MASTER_FX_SLOTS[mIdx]?.label);
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_KEYS) {
            renderKeysView(activeModel?.getModuleName() ?? '—', keyboardState.rootNote, midiNoteName);
        } else if (appState.currentView === VIEW_KNOBS) {
            const vm = activeModel!.getViewModel();
            renderKnobsView(vm, appState.jogTouched, appState.activeSlot);
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_CHAIN) {
            const vm = activeModel!.getViewModel();
            renderChainView(vm, chainIdx, appState.jogTouched, 'T' + (appState.activeSlot + 1));
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            if (appState.fileBrowserState) renderFileBrowseView(appState.fileBrowserState);
        } else {
            const browseTitle = activeModel?.getModuleName() ?? 'Module';
            renderBrowseView(browserState.modules, browserState.browseIndex, browseTitle);
        }
        if (toastShowing) drawSeqToast();
        if (headerShowing) drawSeqHeader();
        lastToastShowing = toastShowing;
        lastHeaderShowing = headerShowing;
        appState.dirty = false;

        /* ── Drum pad LEDs ──────────────────────────────────────────────────── */
        /* In Session mode the clip grid owns the pads (painted by seqLedsTick).
         * synthModel/synthDvm/isDrum are from the synth slot regardless of the
         * active chain index, so drum pads light up even on FX parameter pages. */
        const drumNow = !seqState.sessionMode && isDrum;
        if (drumNow) {
            const drumCfg = synthModel!.getDrumConfig()!;
            const track   = seqState.watchTrack;
            for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
                const p = PAD_MIN + i;
                // Derive the pad's MIDI note to check activeHasNote (mirrors drumPadLedColor's mapping).
                const idx = p - PAD_MIN, col = idx % 8, row = Math.floor(idx / 8);
                const dp  = drumCfg.rawMidi ? p - drumCfg.padNoteStart + 1 : row * 4 + col + 1;
                const note = drumCfg.rawMidi ? p : drumCfg.padNoteStart + dp - 1;
                const playing = activeHasNote(track, note);
                setLED(p, drumPadLedColor(p, PAD_MIN, drumCfg, keyboardState.rootNote, synthDvm!.drumCurrentPhysPad, track, playing), true);
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
