import type { Model } from '../model/index.js';

export const VIEW_KEYS   = 0;
export const VIEW_KNOBS  = 1;
export const VIEW_BROWSE = 2;
export const VIEW_CHAIN  = 3;

export const appState = {
    activeSlot:      0,
    currentView:     VIEW_CHAIN,
    shiftHeld:       false,
    dirty:           true,
    initLedIndex:    0,
    initLedsDone:    false,
    trackChainIndex: [1, 1, 1, 1] as number[],
    trackView:       [3, 3, 3, 3] as number[],   /* VIEW_CHAIN per track */
    trackModels:     [] as Model[][],
    jogTouched:      false,
    browseOrigin:    VIEW_CHAIN as number,
};
