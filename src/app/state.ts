import type { Model } from '../model/index.js';

export const VIEW_KEYS        = 0;
export const VIEW_KNOBS       = 1;
export const VIEW_BROWSE      = 2;
export const VIEW_CHAIN       = 3;
export const VIEW_FILE_BROWSE = 4;

export interface FileBrowserItem {
    name:  string;
    path:  string;
    isDir: boolean;
}

export interface FileBrowserState {
    paramSlot:     number;
    componentKey:  string;
    paramKey:      string;
    gi:            number;
    root:          string;
    filter:        string[];
    currentDir:    string;
    items:         FileBrowserItem[];
    selectedIndex: number;
}

export const appState = {
    activeSlot:       0,
    currentView:      VIEW_CHAIN,
    shiftHeld:        false,
    dirty:            true,
    initLedIndex:     0,
    initLedsDone:     false,
    trackChainIndex:  [1, 1, 1, 1] as number[],
    trackView:        [3, 3, 3, 3] as number[],
    trackModels:      [] as Model[][],
    jogTouched:       false,
    browseOrigin:     VIEW_CHAIN as number,
    fileBrowserState: null as FileBrowserState | null,
    drumActive:       false,
};
