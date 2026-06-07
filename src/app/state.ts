import type { Model } from '../model/index.js';

export const VIEW_KEYS   = 0;
export const VIEW_KNOBS  = 1;
export const VIEW_BROWSE = 2;
export const VIEW_CHAIN  = 3;

export const appState = {
    activeSlot:   0,
    currentView:  VIEW_CHAIN,
    shiftHeld:    false,
    dirty:        true,
    initLedIndex: 0,
    initLedsDone: false,
    chainIndex:   1,
    chainModels:  [] as Model[],
    jogTouched:   false,
    browseOrigin: VIEW_CHAIN as number,
};
