import type { KnobParam, ModuleConfig } from '../types/param.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS, REFRESH_SUPPRESS_TICKS } from './constants.js';

export interface EnumOverlay {
    slot:     number;
    gi:       number;
    options:  string[];
    selected: number;
}

export interface FileOverlay {
    slot:             number;
    gi:               number;
    items:            string[];   // absolute paths, filtered + sorted
    selected:         number;     // index into items
    original:         string;     // path at touch time
    accum:            number;     // fractional delta accumulator
    previewCountdown: number;     // ticks until waveform loads; reset on delta
    waveform:         number[] | null;
    waveformPath:     string | null;  // path for which waveform was loaded
}

export interface ModelState {
    activeSlot:          number;
    componentKey:        string;
    knobParams:          (KnobParam | null)[];
    knobValues:          (number | null)[];
    fileValues:          (string | null)[];
    pendingDeltas:       number[];
    enumAccums:          number[];
    knobPage:            number;
    touchedSlots:        number[];
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
}

export function createModelState(activeSlot: number, componentKey: string): ModelState {
    return {
        activeSlot,
        componentKey,
        knobParams:          [],
        knobValues:          [],
        fileValues:          [],
        pendingDeltas:       new Array(KNOBS_PER_PAGE).fill(0) as number[],
        enumAccums:          new Array(KNOBS_PER_PAGE).fill(0) as number[],
        knobPage:            0,
        touchedSlots:        [],
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
    };
}
