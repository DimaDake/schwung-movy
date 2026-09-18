import type { Model } from '../model/index.js';
import { trackRef, TRACK_COUNT, type TrackRef } from '../track/ref.js';

export const VIEW_KEYS        = 0;
export const VIEW_SESSION      = 5;
export const VIEW_KNOBS       = 1;
export const VIEW_BROWSE      = 2;
export const VIEW_CHAIN       = 3;
export const VIEW_FILE_BROWSE = 4;
export const VIEW_MAIN_PARAMS = 6;
export const VIEW_CLIP_PARAMS = 7;
export const VIEW_FLAGS       = 8;   // Settings (Shift+Step 2; ships in every build)
export const VIEW_CPU         = 9;   // CPU meter (Shift+Step 12)
export const VIEW_VERSIONS    = 10;  // Backups (Settings -> BACKUPS)

/* A stable name for the screen constants above, for anything that has to SAY
 * which one is up: the probe, and whatever device scenario reads it. It lives
 * here because this is the list it names — a screen added without a word here
 * answers `unknown`, which is a visible gap rather than a silent wrong answer.
 * The strings are the scenario's contract; the numbers are not, which is the
 * whole reason this exists. */
const VIEW_NAMES: Record<number, string> = {
    [VIEW_KEYS]:        'keys',
    [VIEW_KNOBS]:       'knobs',
    [VIEW_BROWSE]:      'browse',
    [VIEW_CHAIN]:       'chain',
    [VIEW_FILE_BROWSE]: 'file-browse',
    [VIEW_SESSION]:     'session',
    [VIEW_MAIN_PARAMS]: 'main-params',
    [VIEW_CLIP_PARAMS]: 'clip-params',
    [VIEW_FLAGS]:       'flags',
    [VIEW_CPU]:         'cpu',
    [VIEW_VERSIONS]:    'versions',
};

export function viewName(view: number): string { return VIEW_NAMES[view] ?? 'unknown'; }

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
    /* The track the UI is editing. A TrackRef, not a slot number: a host track's
     * index happens to equal its schwung slot, and every place that assumed the
     * two were the same thing is what the port abstraction had to unpick. */
    activeTrack:      trackRef(0) as TrackRef,
    /* Which quartet the four track buttons and the session clip grid address.
     * Always the group containing activeTrack — track/focus.ts moves both. */
    focusGroup:       0,
    currentView:      VIEW_CHAIN,
    shiftHeld:        false,
    /* Mute held, beside Shift because it is the same kind of state and for the
     * same reason: a held button that changes what the pads MEAN. `track/pad-route`
     * reads it — the engine answers live pads on the audio thread and cannot see a
     * button, so the map has to carry the fact or a gesture press sounds. */
    muteHeld:         false,
    dirty:            true,
    initLedIndex:     0,
    initLedsDone:     false,
    /* Sized in init() from TRACK_COUNT; these defaults only cover the boot
     * frame before init runs. */
    trackChainIndex:  new Array(TRACK_COUNT).fill(1) as number[],
    trackView:        new Array(TRACK_COUNT).fill(VIEW_CHAIN) as number[],
    trackModels:      [] as Model[][],
    masterFxModels:   [] as Model[],
    masterChainIndex: 0,
    /* In the master FX chain (Session mode), true once the user has drilled from
     * the slot grid into the focused slot's module detail (knob) page. There is
     * no master VIEW_KNOBS: rendering keys off sessionMode, so this flag — not
     * currentView — distinguishes the master grid from the master detail page. */
    masterDetail:     false,
    browseOrigin:     VIEW_CHAIN as number,
    fileBrowserState: null as FileBrowserState | null,
    drumActive:       false,
};

/* True when slot's synth (chain index 1) is a drum module.
 * Always uses the synth slot — not the currently-viewed chain slot — so the
 * answer stays consistent regardless of which FX page is open. Reads the drum
 * config rather than the ViewModel (same answer — drumPadCount is derived from
 * it in loadHierarchy) because this runs per tick for every track, and building
 * a ViewModel four times a frame is not free. */
export function trackIsDrum(slot: number): boolean {
    return (appState.trackModels[slot]?.[1]?.getDrumConfig()?.padCount ?? 0) > 0;
}
