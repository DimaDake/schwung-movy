import type { KnobParam, ModuleConfig } from '../types/param.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS } from './constants.js';

export interface EnumOverlay {
    slot:     number;
    gi:       number;
    options:  string[];
    selected: number;
}

export interface ModelState {
    activeSlot:         number;
    knobParams:         (KnobParam | null)[];
    knobValues:         (number | null)[];
    pendingDeltas:      number[];
    enumAccums:         number[];   /* fractional delta accumulator per physical knob */
    knobPage:           number;
    touchedSlots:       number[];      /* all currently held knobs; last = primary */
    longPressCountdown: number;       /* -1 = inactive */
    enumOverlay:        EnumOverlay | null;
    activeModuleName:   string;
    moduleId:           string;
    moduleConfig:       ModuleConfig | null;
    hierarchyKey:       string;
    pollCountdown:      number;
    refreshCountdown:   number;
    dirty:              boolean;
}

export function createModelState(activeSlot: number): ModelState {
    return {
        activeSlot,
        knobParams:         [],
        knobValues:         [],
        pendingDeltas:      new Array(KNOBS_PER_PAGE).fill(0) as number[],
        enumAccums:         new Array(KNOBS_PER_PAGE).fill(0) as number[],
        knobPage:           0,
        touchedSlots:       [],
        longPressCountdown: -1,
        enumOverlay:        null,
        activeModuleName:   '—',
        moduleId:           '',
        moduleConfig:       null,
        hierarchyKey:       '',
        pollCountdown:      NAME_POLL_TICKS,
        refreshCountdown:   0,
        dirty:              false,
    };
}
