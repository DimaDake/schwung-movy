import type { KnobParam, ModuleConfig } from '../types/param.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS, REFRESH_SUPPRESS_TICKS } from './constants.js';

export interface EnumOverlay {
    slot:     number;
    gi:       number;
    options:  string[];
    selected: number;
}

export interface FileOverlay {
    slot:     number;
    gi:       number;
    items:    string[];   // absolute paths, filtered + sorted
    selected: number;     // index into items
    original: string;     // path at touch time
    accum:    number;     // fractional delta accumulator
}

export interface ModelState {
    activeSlot:          number;
    componentKey:        string;
    knobParams:          (KnobParam | null)[];
    knobValues:          (number | null)[];
    /* Per-param (by gi) enum exchange format, learned on read: true = module
     * uses the numeric index, false = option name. Drives set_param formatting
     * without re-reading. Undefined until first read (defaults to index). */
    enumFmt:             (boolean | undefined)[];
    fileValues:          (string | null)[];
    pendingDeltas:       number[];
    enumAccums:          number[];
    knobPage:            number;
    touchedSlots:        number[];
    /* Memoized physical-knob → page-param permutation for the current page (set
     * by store.slotToLocal; invalidated on hierarchy reload). */
    slotMapCache:        { page: number; map: number[] } | null;
    longPressCountdown:  number;
    enumOverlay:         EnumOverlay | null;
    fileOverlay:         FileOverlay | null;
    activeModuleName:    string;
    moduleId:            string;
    moduleConfig:        ModuleConfig | null;
    bankNames:           string[];
    hierarchyKey:        string;
    pollCountdown:       number;
    refreshParamCursor:  number;
    lastDeltaTick:       number;
    dirty:               boolean;
    isDrum:              boolean;
    drumPadCount:        number;
    drumCurrentPad:      number;
    drumCurrentPhysPad:  number;
    /* Param keys that are automation lanes — their synth value is driven by
     * automation playback, so the param page must NOT read it back (it shows
     * the UI-owned base). Set by the app from the automation registry. */
    noRefreshKeys:       Set<string>;
    /* ioKeys on this component that a slot LFO targets. Cached (refreshed on the
     * poll cadence, not per render) so buildViewModel does no per-frame IPC, and
     * so refreshOneParam skips them — the knob shows the UI-owned base instead of
     * following the LFO-modulated value (same idea as noRefreshKeys). */
    modulatedKeys:       Set<string>;
}

export function createModelState(activeSlot: number, componentKey: string): ModelState {
    return {
        activeSlot,
        componentKey,
        knobParams:          [],
        knobValues:          [],
        enumFmt:             [],
        fileValues:          [],
        pendingDeltas:       new Array(KNOBS_PER_PAGE).fill(0) as number[],
        enumAccums:          new Array(KNOBS_PER_PAGE).fill(0) as number[],
        knobPage:            0,
        touchedSlots:        [],
        slotMapCache:        null,
        longPressCountdown:  -1,
        enumOverlay:         null,
        fileOverlay:         null,
        activeModuleName:    '—',
        moduleId:            '',
        moduleConfig:        null,
        bankNames:           [],
        hierarchyKey:        '',
        pollCountdown:       NAME_POLL_TICKS,
        refreshParamCursor:  0,
        lastDeltaTick:       -(REFRESH_SUPPRESS_TICKS + 1),
        dirty:               false,
        isDrum:              false,
        drumPadCount:        0,
        drumCurrentPad:      1,
        drumCurrentPhysPad:  0,
        noRefreshKeys:       new Set(),
        modulatedKeys:       new Set(),
    };
}
