import { createModel }  from '../model/index.js';
import { appState, VIEW_CHAIN } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS, MASTER_FX_SLOTS } from '../chain/config.js';
import { mlog } from '../log.js';

export function init(): void {
    appState.activeSlot = (typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0;
    mlog('init: activeSlot=' + appState.activeSlot);

    appState.trackModels = Array.from({ length: 4 }, (_, slot) =>
        CHAIN_SLOTS.map(s => createModel(slot, s.componentKey))
    );
    appState.masterFxModels  = MASTER_FX_SLOTS.map(s => createModel(0, s.componentKey));
    appState.masterChainIndex = 0;
    appState.trackChainIndex = [1, 1, 1, 1];
    appState.trackView       = [VIEW_CHAIN, VIEW_CHAIN, VIEW_CHAIN, VIEW_CHAIN];
    appState.currentView     = VIEW_CHAIN;
    appState.shiftHeld    = false;
    appState.jogTouched   = false;
    appState.browseOrigin = VIEW_CHAIN;
    appState.dirty           = true;
    appState.initLedIndex    = 0;
    appState.initLedsDone    = false;
    appState.fileBrowserState = null;

    for (const trackSlots of appState.trackModels) {
        for (const m of trackSlots) m.reset();
    }
    for (const m of appState.masterFxModels) m.reset();

    keyboardState.rootNote = 48;
    for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];

    browserState.modules      = [];
    browserState.browseIndex  = 0;
    browserState.componentKey = 'synth';
}
