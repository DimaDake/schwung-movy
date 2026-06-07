import { appState, VIEW_KEYS, VIEW_KNOBS } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { padLedColor } from '../keyboard/leds.js';
import { midiNoteName } from '../keyboard/notes.js';
import { renderKnobsView } from '../renderer/knob-view.js';
import { renderKeysView }  from '../renderer/keys-view.js';
import { renderBrowseView } from '../renderer/browse-view.js';
import { updateKnobLEDs }  from '../renderer/knob-leds.js';

const PAD_MIN       = MovePads[0];
const PAD_MAX       = MovePads[MovePads.length - 1];
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

    const modelDirty = appState.model?.tick() ?? false;

    if (modelDirty || appState.dirty) {
        if (appState.currentView === VIEW_KEYS) {
            renderKeysView(appState.model?.getModuleName() ?? '—', keyboardState.rootNote, midiNoteName);
        } else if (appState.currentView === VIEW_KNOBS) {
            const vm = appState.model!.getViewModel();
            renderKnobsView(vm);
            updateKnobLEDs(vm);
        } else {
            renderBrowseView(browserState.modules, browserState.browseIndex);
        }
        appState.dirty = false;
    }
}
