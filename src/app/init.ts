import { createModel }  from '../model/index.js';
import { appState, VIEW_CHAIN } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS } from '../chain/config.js';
import { mlog } from '../log.js';

export function init(): void {
    appState.activeSlot = (typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0;
    mlog('init: activeSlot=' + appState.activeSlot);

    appState.chainModels  = CHAIN_SLOTS.map(s => createModel(appState.activeSlot, s.componentKey));
    appState.chainIndex   = 1;
    appState.currentView  = VIEW_CHAIN;
    appState.shiftHeld    = false;
    appState.jogTouched   = false;
    appState.browseOrigin = VIEW_CHAIN;
    appState.dirty        = true;
    appState.initLedIndex = 0;
    appState.initLedsDone = false;

    for (const m of appState.chainModels) m.reset();

    keyboardState.rootNote = 48;
    for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];

    browserState.modules      = [];
    browserState.browseIndex  = 0;
    browserState.componentKey = 'synth';
}
