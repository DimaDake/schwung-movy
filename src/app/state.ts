import type { Model } from '../model/index.js';

export const VIEW_KEYS   = 0;
export const VIEW_KNOBS  = 1;
export const VIEW_BROWSE = 2;

export const appState = {
    model:        null as Model | null,
    activeSlot:   0,
    currentView:  VIEW_KNOBS,
    shiftHeld:    false,
    dirty:        true,
    initLedIndex: 0,
    initLedsDone: false,
};
