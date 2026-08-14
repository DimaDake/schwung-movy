import type { ModelState } from './state.js';
import { loadModuleConfig } from '../modules/loader.js';
import { mlog } from '../log.js';
import { moduleReadKey } from '../chain/config.js';
import { buildConfigPages } from './config-pages.js';
import { buildGenericPages } from './generic-pages.js';
import { conditionHolds, collectRules } from './visible-if.js';
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
    s.presetDeclared = false;
    s.degenerateKeys = [];
    s.slotMapCache = null;
    s.detentAccum  = [];
    s.hierarchyKey = s.activeModuleName;

    mlog('loadHierarchy: slot=' + s.activeSlot + ' module=' + s.activeModuleName);
    const prevModuleId = s.moduleId;
    s.moduleId = shadow_get_param(s.activeSlot, moduleReadKey(s.componentKey)) || '';

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
            shadow_set_param(s.activeSlot, s.componentKey + ':' + k, v);
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
    }

    /* chain_params → cpMap for type/min/max/step/options/name lookups. cpOrder
     * preserves the publish order for the no-hierarchy fallback (B1). */
    const cpMap: Record<string, HierParam & { name?: string }> = {};
    const cpOrder: string[] = [];
    const chainParamsRaw = shadow_get_param(s.activeSlot, s.componentKey + ':chain_params');
    if (chainParamsRaw) {
        try {
            const arr = JSON.parse(chainParamsRaw) as Array<{ key?: string }>;
            for (const cp of arr) { if (cp.key) { cpMap[cp.key] = cp; cpOrder.push(cp.key); } }
            mlog('loadHierarchy: chain_params ' + arr.length + ' entries');
        } catch (e) { mlog('chain_params parse error: ' + e); }
    }

    const raw = shadow_get_param(s.activeSlot, s.componentKey + ':ui_hierarchy');
    // B1: with no ui_hierarchy and no config we can still build pages from
    // chain_params (handled by the fallback in the generic path below). Only bail
    // when there's genuinely nothing — no hierarchy, no config, no chain_params.
    if (!raw && !s.moduleConfig && cpOrder.length === 0) {
        mlog('loadHierarchy: ui_hierarchy null — no params');
        s.dirty = true;
        return;
    }

    /* Parse ui_hierarchy — build paramDefs (from .params arrays) and knobInline
     * (from inline object knobs) for label/type fallback lookups */
    const paramDefs:  Record<string, HierParam> = {};
    const knobInline: Record<string, HierParam> = {};
    let allLevels: Record<string, HierLevel> = {};
    if (raw) {
        try {
            const hier = JSON.parse(raw) as { levels?: Record<string, HierLevel> };
            allLevels = hier.levels ?? {};
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
        } catch (e) { mlog('ui_hierarchy parse error: ' + e); }
    }

    /* Which params the module is hiding right now. Evaluated against live
     * values, and re-evaluated whenever a watched value changes (processTick). */
    s.visibilityRules = collectRules(paramDefs);
    s.hiddenKeys = new Set<string>();
    for (const r of s.visibilityRules) {
        /* One read per rule, at LOAD only. After this the value cache carries
         * it (see hiddenNow in tick.ts) and no further host call is made. */
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + r.param);
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
