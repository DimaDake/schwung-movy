import { createModel } from '../model/index.js';
import { appState, VIEW_KNOBS } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { mlog } from '../log.js';

export function init(): void {
    appState.activeSlot = (typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0;
    mlog('init: activeSlot=' + appState.activeSlot);

    appState.model       = createModel(appState.activeSlot);
    appState.currentView = VIEW_KNOBS;
    appState.shiftHeld   = false;
    appState.dirty       = true;
    appState.initLedIndex = 0;
    appState.initLedsDone = false;

    appState.model.reset();

    keyboardState.rootNote = 48;
    for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];

    browserState.modules     = [];
    browserState.browseIndex = 0;
}
