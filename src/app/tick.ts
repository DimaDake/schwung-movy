import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS } from '../chain/config.js';
import { padLedColor, drumPadLedColor } from '../keyboard/leds.js';
import { midiNoteName } from '../keyboard/notes.js';
import { renderKnobsView } from '../renderer/knob-view.js';
import { renderKeysView }  from '../renderer/keys-view.js';
import { renderBrowseView } from '../renderer/browse-view.js';
import { renderChainView }    from '../renderer/chain-view.js';
import { renderFileBrowseView } from '../renderer/file-browse-view.js';
import { updateKnobLEDs }  from '../renderer/knob-leds.js';

const PAD_MIN        = MovePads[0];
const PAD_MAX        = MovePads[MovePads.length - 1];
const LED_INIT_BATCH = 8;

export function tick(): void {
    if (!appState.initLedsDone) {
        const total = PAD_MAX - PAD_MIN + 1;
        const end   = Math.min(appState.initLedIndex + LED_INIT_BATCH, total);
        for (let i = appState.initLedIndex; i < end; i++) {
            setLED(PAD_MIN + i, padLedColor(PAD_MIN + i, PAD_MIN), true);
        }
        appState.initLedIndex = end;
        if (appState.initLedIndex >= total) { appState.initLedsDone = true; appState.dirty = true; }
        return;
    }

    const chainIdx    = appState.trackChainIndex[appState.activeSlot];
    const activeModel = appState.trackModels[appState.activeSlot]?.[chainIdx];
    const modelDirty  = activeModel?.tick() ?? false;

    if (modelDirty || appState.dirty) {
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
        appState.dirty = false;

        /* ── Drum pad LEDs ──────────────────────────────────────────────────── */
        const dvm       = activeModel?.getViewModel();
        const isDrum    = (dvm?.drumPadCount ?? 0) > 0;
        if (isDrum) {
            const drumCfg = activeModel!.getDrumConfig()!;
            for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
                const p = PAD_MIN + i;
                setLED(p, drumPadLedColor(p, PAD_MIN, drumCfg, keyboardState.rootNote, dvm!.drumCurrentPhysPad), true);
            }
            appState.drumActive = true;
        } else if (appState.drumActive) {
            appState.drumActive = false;
            appState.initLedsDone = false;
            appState.initLedIndex = 0;
        }
    }
}
