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
    /* Display labels for `items`, built once when the overlay opens. The view
     * model is rebuilt every frame, and deriving these there re-ran a basename
     * and a slice over the whole list on each one — the reason a folder of many
     * samples scrolled badly. */
    labels:   string[];
    selected: number;     // index into items
    original: string;     // path at touch time
    accum:    number;     // fractional delta accumulator
}

export interface ParamGestureState {
    lastTurnMs: number;
    direction:  number;
}

/* One-shot trigger knob. `latched` means it has already fired and a CW turn is a
 * no-op; it releases on a CCW turn or once the debounce runs out. `autoRearm` is
 * false for a latch we inferred from the DSP's value at load rather than one we
 * caused — there is no timer to run out, so it waits for the CCW turn. */
export interface TriggerState {
    latched:    boolean;
    autoRearm:  boolean;
    lastTurnMs: number;
    firedAtMs:  number;
    /* Last badge appearance actually painted. The drain is quantised, so without
     * this the animation would mark the frame dirty on every tick and repaint ~70
     * times per cooldown instead of once per visible change. */
    paintedPhase: string;
    paintedCool:  number;
    paintedBlink: boolean;
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
    /* Sub-step turn progress per PARAM index, for knobs that need several clicks
     * per value (knob-step.ts:detentsPerStep). Keyed by param, not by physical
     * knob like enumAccums, so paging away mid-turn resumes where it left off.
     * Cleared on a module change so it cannot leak into another module's knob. */
    detentAccum:         number[];
    longPressCountdown:  number;
    enumOverlay:         EnumOverlay | null;
    fileOverlay:         FileOverlay | null;
    activeModuleName:    string;
    moduleId:            string;
    moduleConfig:        ModuleConfig | null;
    bankNames:           string[];
    /* Group id per page: pages built from the same hierarchy level share one, so
     * shift+jog can skip a level's overflow pages in a single gesture. */
    bankGroups:          number[];
    hierarchyKey:        string;
    pollCountdown:       number;
    /* A module can publish its preset list and enum options AFTER load (osirus
     * scans its ROM asynchronously). These drive a bounded re-probe; both reset
     * on a genuine module change, like paramGestures. */
    metaRetries:         number;
    presetDeclared:      boolean;
    /* params[] keys left off the pages because the module reported an
     * unturnable range. Re-checked by the metadata retry — osirus widens
     * bank_index 0..0 → 0..1 once its ROM lists the banks. */
    degenerateKeys:      string[];
    refreshParamCursor:  number;
    /* Cursor over the CURRENT page's 8 slots, interleaved with
     * refreshParamCursor (one read per tick, alternating) so on-screen values
     * converge in ~16 ticks no matter how many pages the module has. */
    refreshPageCursor:   number;
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
    /* Per-param turn history for opt-in wide-range knob acceleration. Reset only
     * when the loaded module changes — a reload of the SAME module must not
     * disturb a gesture in progress. */
    paramGestures:       Record<string, ParamGestureState>;
    /* Badge state for one-shot trigger knobs, keyed by param key. Same
     * same-module-reload rule as paramGestures: clearing it mid-gesture would
     * re-arm a latch and fire the action twice. */
    triggerStates:       Record<string, TriggerState>;
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
        detentAccum:         [],
        longPressCountdown:  -1,
        enumOverlay:         null,
        fileOverlay:         null,
        activeModuleName:    '—',
        moduleId:            '',
        moduleConfig:        null,
        bankNames:           [],
        bankGroups:          [],
        hierarchyKey:        '',
        pollCountdown:       NAME_POLL_TICKS,
        metaRetries:         0,
        presetDeclared:      false,
        degenerateKeys:      [],
        refreshParamCursor:  0,
        refreshPageCursor:   0,
        lastDeltaTick:       -(REFRESH_SUPPRESS_TICKS + 1),
        dirty:               false,
        isDrum:              false,
        drumPadCount:        0,
        drumCurrentPad:      1,
        drumCurrentPhysPad:  0,
        noRefreshKeys:       new Set(),
        modulatedKeys:       new Set(),
        paramGestures:       {},
        triggerStates:       {},
    };
}
