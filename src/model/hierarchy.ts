import type { ModelState } from './state.js';
import { loadModuleConfig, loadModuleJson } from '../modules/loader.js';
import { mlog } from '../log.js';
import { moduleReadKey } from '../chain/config.js';
import { buildConfigPages } from './config-pages.js';
import { buildGenericPages } from './generic-pages.js';
import { conditionHolds, collectRules } from './visible-if.js';
import { physPadOfDrumPad } from '../keyboard/drum-grid.js';
import { PAD_MIN } from '../seq/constants.js';
import type { RawMeta } from './param-build.js';

type HierParam = RawMeta;

interface HierLevel {
    name?: string;
    knobs?: (string | HierParam)[];
    params?: (string | HierParam)[];
    list_param?: string; count_param?: string; name_param?: string;
    items_param?: string; select_param?: string;
    children?: string;
}

export function loadHierarchy(s: ModelState): void {
    s.knobParams   = [];
    s.knobValues   = [];
    s.moduleConfig = null;
    s.bankNames    = [];
    s.bankGroups   = [];
    s.voiceBank    = 0;
    s.presetDeclared = false;
    s.degenerateKeys = [];
    s.slotMapCache = null;
    s.detentAccum  = [];
    s.hierarchyKey = s.activeModuleName;

    mlog('loadHierarchy: slot=' + s.port.track.index + ' module=' + s.activeModuleName);
    const prevModuleId = s.moduleId;
    s.moduleId = s.port.getParam(moduleReadKey(s.componentKey)) || '';

    s.moduleConfig = loadModuleConfig(s.moduleId, s.componentKey);
    /* Only a genuine module change invalidates per-param gesture state. A reload
     * of the same module happens ~1 s after load as pollModuleName settles —
     * clearing then would re-arm a latched trigger mid-gesture and fire a
     * destructive action twice. */
    if (s.moduleId !== prevModuleId) {
        s.paramGestures = {};
        s.triggerStates = {};
        // A same-module rebuild is what the metadata retry itself triggers —
        // resetting the budget there would loop forever.
        s.metaRetries   = 0;
    }

    /* Params movy wants to own from load (e.g. ui_auto_select_pad=off so the DSP
     * never drifts its focused pad away from movy's manual selection). */
    if (s.moduleConfig?.setOnLoad) {
        for (const [k, v] of Object.entries(s.moduleConfig.setOnLoad)) {
            s.port.setParam(s.componentKey + ':' + k, v);
        }
    }

    s.isDrum             = false;
    s.drumPadCount       = 0;
    // Focused pad is movy-authoritative: default 1, changed only by a manual pad
    // press. Deliberately NOT seeded from the DSP's currentPadParam — that
    // coupling let the DSP's playback-drifted pad leak into movy.
    s.drumCurrentPad     = 1;
    s.drumCurrentPhysPad = 0;
    if (s.moduleConfig?.drum) {
        s.isDrum       = true;
        s.drumPadCount = s.moduleConfig.drum.padCount;
        /* Which GRID pad that first pad is. The step lane and the header icon
         * already opened on pad 1; leaving the physical pad at 0 meant no pad
         * lit white, so a freshly loaded rack looked like it had no pad
         * selected while the sequencer was already editing one. */
        s.drumCurrentPhysPad = physPadOfDrumPad(s.drumCurrentPad, PAD_MIN, s.moduleConfig.drum);
    }

    /* chain_params → cpMap for type/min/max/step/options/name lookups. cpOrder
     * preserves the publish order for the no-hierarchy fallback (B1). */
    const cpMap: Record<string, HierParam & { name?: string }> = {};
    const cpOrder: string[] = [];
    const chainParamsRaw = s.port.getParam(s.componentKey + ':chain_params');
    if (chainParamsRaw) {
        try {
            const arr = JSON.parse(chainParamsRaw) as Array<{ key?: string }>;
            for (const cp of arr) { if (cp.key) { cpMap[cp.key] = cp; cpOrder.push(cp.key); } }
            mlog('loadHierarchy: chain_params ' + arr.length + ' entries');
        } catch (e) { mlog('chain_params parse error: ' + e); }
    }

    /* Parse ui_hierarchy — build paramDefs (from .params arrays) and knobInline
     * (from inline object knobs) for label/type fallback lookups */
    const paramDefs:  Record<string, HierParam> = {};
    const knobInline: Record<string, HierParam> = {};
    let allLevels: Record<string, HierLevel> = {};
    function absorbHierarchy(hier: { levels?: Record<string, HierLevel> } | null): void {
        allLevels = hier?.levels ?? {};
        for (const lvl of Object.values(allLevels)) {
            if (lvl.params) {
                for (const p of lvl.params) {
                    if (typeof p === 'object' && p.key) paramDefs[p.key] = p;
                }
            }
            if (lvl.knobs) {
                for (const k of lvl.knobs) {
                    if (typeof k === 'object' && k.key) knobInline[k.key] = k;
                }
            }
        }
    }

    const raw = s.port.getParam(s.componentKey + ':ui_hierarchy');
    if (raw) {
        try { absorbHierarchy(JSON.parse(raw) as { levels?: Record<string, HierLevel> }); }
        catch (e) { mlog('ui_hierarchy parse error: ' + e); }
    }

    /* Nothing served? Read the module's own manifest. Schwung serves a SYNTH
     * slot's ui_hierarchy from the plugin alone — only FX and MIDI FX slots get
     * module.json's, cached by the chain host — so a module that describes its
     * UI in module.json and not in its DSP arrives here with an empty
     * hierarchy, and everything it declares there (a sample browser, most
     * visibly) would be unreachable. This is the same file schwung parses for
     * the slot's own param table. */
    if (Object.keys(allLevels).length === 0) {
        const caps = loadModuleJson(s.moduleId, s.componentKey)?.capabilities;
        const hier = caps?.ui_hierarchy as { levels?: Record<string, HierLevel> } | undefined;
        if (hier?.levels) {
            mlog('loadHierarchy: ui_hierarchy from module.json');
            absorbHierarchy(hier);
        }
    }

    // B1: with no ui_hierarchy and no config we can still build pages from
    // chain_params (handled by the fallback in the generic path below). Only bail
    // when there's genuinely nothing — no hierarchy, no config, no chain_params.
    if (Object.keys(allLevels).length === 0 && !s.moduleConfig && cpOrder.length === 0) {
        mlog('loadHierarchy: ui_hierarchy null — no params');
        s.dirty = true;
        return;
    }

    /* Which params the module is hiding right now. Evaluated against live
     * values, and re-evaluated whenever a watched value changes (processTick). */
    s.visibilityRules = collectRules(paramDefs);
    s.hiddenKeys = new Set<string>();
    for (const r of s.visibilityRules) {
        /* One read per rule, at LOAD only. After this the value cache carries
         * it (see hiddenNow in tick.ts) and no further host call is made. */
        const raw = s.port.getParam(s.componentKey + ':' + r.param);
        const opts = (cpMap[r.param]?.options ?? paramDefs[r.param]?.options) ?? null;
        if (!conditionHolds(r, raw, opts)) s.hiddenKeys.add(r.key);
    }

    /* ── Custom config path (Plaits, Wurl, etc.) ─────────────────────────── */
    if (s.moduleConfig) {
        buildConfigPages(s, cpMap, paramDefs, allLevels);
        return;
    }

    buildGenericPages(s, cpMap, cpOrder, paramDefs, knobInline, allLevels);
}
