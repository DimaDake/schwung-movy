import type { Model } from '../model/index.js';

export const VIEW_KEYS        = 0;
export const VIEW_SESSION      = 5;
export const VIEW_KNOBS       = 1;
export const VIEW_BROWSE      = 2;
export const VIEW_CHAIN       = 3;
export const VIEW_FILE_BROWSE = 4;
export const VIEW_MAIN_PARAMS = 6;
export const VIEW_CLIP_PARAMS = 7;

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
    requireContains?: string;
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
    masterFxModels:   [] as Model[],
    masterChainIndex: 0,
    jogTouched:       false,
    browseOrigin:     VIEW_CHAIN as number,
    fileBrowserState: null as FileBrowserState | null,
    drumActive:       false,
};

/* True when slot's synth (chain index 1) is a drum module.
 * Always uses the synth slot — not the currently-viewed chain slot — so the
 * answer stays consistent regardless of which FX page is open. */
export function trackIsDrum(slot: number): boolean {
    return (appState.trackModels[slot]?.[1]?.getViewModel()?.drumPadCount ?? 0) > 0;
}
