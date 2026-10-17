import type { KnobParam, ModuleConfig } from '../types/param.js';
import type { TrackPort } from '../track/port.js';
import { NAME_POLL_TICKS } from './constants.js';

export interface ModelState {
    /* How this model talks to its track. Everything that used to take a slot
     * number now asks the port instead — that is what lets a movy-hosted track
     * reuse this whole layer unchanged. The track index is still reachable as
     * `port.track.index`, but only labels and log lines want it. */
    port:                TrackPort;
    componentKey:        string;
    knobParams:          (KnobParam | null)[];
    /* Per-param (by gi) enum exchange format, learned on read: true = module
     * uses the numeric index, false = option name. Drives set_param formatting
     * without re-reading. Undefined until first read (defaults to index). */
    enumFmt:             (boolean | undefined)[];
    touchedSlots:        number[];
    /* Params the module is hiding via visible_if, and the params those
     * conditions watch — a change in any watched value rebuilds the page. */
    hiddenKeys:          Set<string>;
    /* The module's visible_if rules, kept so visibility can be re-evaluated
     * from CACHED values — the round-robin refresh already reads every param,
     * so watching for a change costs no host call at all. */
    visibilityRules:     { key: string; param: string; equals: string }[];
    activeModuleName:    string;
    moduleId:            string;
    moduleConfig:        ModuleConfig | null;
    bankNames:           string[];
    hierarchyKey:        string;
    pollCountdown:       number;
    /* A module can publish its preset list and enum options AFTER load (osirus
     * scans its ROM asynchronously). These drive a bounded re-probe; both reset
     * on a genuine module change, like paramGestures. */
    metaRetries:         number;
    /* A NAMED module read back with ZERO params — the master-FX load race
     * (hierarchy.ts's B1 bail). -1 = not armed; reset on a genuine module
     * change alongside metaRetries. Ticks down at its OWN faster pace
     * (HIERARCHY_RETRY_TICKS) in processTick, independent of pollCountdown —
     * see hierarchy.ts and model/constants.ts. */
    hierarchyRetryCountdown: number;
    hierarchyRetries:    number;
    presetDeclared:      boolean;
    /* params[] keys left off the pages because the module reported an
     * unturnable range. Re-checked by the metadata retry — osirus widens
     * bank_index 0..0 → 0..1 once its ROM lists the banks. */
    degenerateKeys:      string[];
    dirty:               boolean;
    drumPadCount:        number;
    /* The drum config actually in force: the module's declaration where it made
     * one, otherwise movy's own table. Resolved once per hierarchy load rather
     * than at every call site, so the two sources cannot be merged differently
     * in two places. */
    drumConfig:          import('../types/param.js').DrumConfig | null;
    /* What the MODULE calls each pad, pad-ordered. Only a declared rack has
     * these; movy's own table names banks, never voices. */
    drumPadNames:        string[];
    /* The declared hierarchy's per-instance levels (`model/child-keys.ts`). */
    childLevels:         any[];
    /* Per pad, the keys only that pad's voice owns (`model/voice-keys.ts`);
     * empty for a module that is not a declared rack. */
    voiceKeys:           string[][];
    /* What the last hierarchy load read about every declared key — chain_params
     * metadata, the levels' own definitions, and the key list. Null before a
     * load. Read by `paramRangeByKey` for a key no movy page shows. */
    declared:            { cp: Record<string, any>; defs: Record<string, any>; keys: Set<string> } | null;
    /* The module's declared live-press param (schwung's `child_press_param` /
     * `focus_press_param`), or null.
     *
     * Here rather than on DrumConfig because `focus_press_param` sits at the
     * hierarchy ROOT — a module need not declare a drum layout to want it. */
    pressParam:          string | null;
    drumCurrentPad:      number;
    drumCurrentPhysPad:  number;
    /* ioKeys on this component that a slot LFO targets. Cached (refreshed on the
     * poll cadence, not per frame) — Schwung's page asks for the mark by key
     * (`modulatedKeys()`). */
    modulatedKeys:       Set<string>;
}

export function createModelState(port: TrackPort, componentKey: string): ModelState {
    return {
        port,
        componentKey,
        knobParams:          [],
        enumFmt:             [],
        touchedSlots:        [],
        hiddenKeys:          new Set<string>(),
        visibilityRules:     [],
        activeModuleName:    '—',
        moduleId:            '',
        moduleConfig:        null,
        bankNames:           [],
        hierarchyKey:        '',
        pollCountdown:       NAME_POLL_TICKS,
        metaRetries:         0,
        hierarchyRetryCountdown: -1,
        hierarchyRetries:    0,
        presetDeclared:      false,
        degenerateKeys:      [],
        dirty:               false,
        drumPadCount:        0,
        drumConfig:          null,
        drumPadNames:        [],
        childLevels:         [],
        voiceKeys:           [],
        declared:            null,
        pressParam:          null,
        drumCurrentPad:      1,
        drumCurrentPhysPad:  0,
        modulatedKeys:       new Set(),
    };
}
