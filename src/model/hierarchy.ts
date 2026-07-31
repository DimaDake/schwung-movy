import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { loadModuleConfig } from '../modules/loader.js';
import { mlog } from '../log.js';
import { moduleReadKey } from '../chain/config.js';
import { KNOBS_PER_PAGE } from './constants.js';
import { buildLevelPages, knobKeys } from './hierarchy-walk.js';
import { buildPresetParam } from './preset-param.js';
import { buildConfigPages } from './config-pages.js';
import type { RawMeta } from './param-build.js';
import { buildGenericParam } from './param-build.js';

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
    s.slotMapCache = null;
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

    /* ── Custom config path (Plaits, Wurl, etc.) ─────────────────────────── */
    if (s.moduleConfig) {
        buildConfigPages(s, cpMap, paramDefs, allLevels);
        return;
    }

    /* ── Generic no-config path: parse all levels ────────────────────────── */
    const rootLevel = allLevels['root'] || Object.values(allLevels)[0] || null;

    /* Bank page accumulator: each entry is KNOBS_PER_PAGE keys (null = empty slot) */
    const bankEntries: Array<{ name: string; keys: (string | null)[] }> = [];

    function addPage(name: string, keys: (string | null)[]): void {
        const padded = keys.slice(0, KNOBS_PER_PAGE);
        while (padded.length < KNOBS_PER_PAGE) padded.push(null);
        bankEntries.push({ name, keys: padded });
    }

    function addLevel(label: string, keys: string[]): void {
        const pages = Math.max(1, Math.ceil(keys.length / KNOBS_PER_PAGE));
        for (let i = 0; i < pages; i++) {
            addPage(
                pages === 1 ? label : label + ' - ' + (i + 1),
                keys.slice(i * KNOBS_PER_PAGE, (i + 1) * KNOBS_PER_PAGE),
            );
        }
    }

    /* The preset param and its list key are consumed by the final build loop;
     * declared here so both the hierarchy path and the chain_params fallback
     * (which leaves them unset) can share that loop. */
    let presetParam: KnobParam | null = null;
    let listParam: string | undefined;

    if (!rootLevel) {
        /* B1: modules that publish chain_params but no ui_hierarchy would show an
         * empty page. Build pages straight from the chain_params publish order.
         * Filepath entries become file knobs in the final build loop below, so no
         * orphan-filepath injection here (which would double-add them); ui_* keys
         * are internal UI state, not user-facing params. */
        const fallbackKeys = cpOrder.filter(k => !k.startsWith('ui_'));
        if (fallbackKeys.length > 0) addLevel('Main', fallbackKeys);
    } else {

    /* Preset detection */
    listParam   = rootLevel.list_param;
    presetParam = buildPresetParam(s, listParam, rootLevel.count_param, rootLevel.name_param);
    const presetSeparate = presetParam != null && (rootLevel.knobs ?? []).length >= KNOBS_PER_PAGE;

    /* Dedicated Preset page before Main when Main is full */
    if (presetParam && presetSeparate) addPage('Preset', [listParam!]);

    /* Main page from root.knobs (with preset prepended if there's room) */
    let rootKeys = knobKeys(rootLevel);
    // C1: the preset knob renders via presetParam (its own page, or prepended
    // below) — drop it from root.knobs so it never renders a second time.
    if (presetParam) rootKeys = rootKeys.filter(k => k !== listParam);
    if (presetParam && !presetSeparate) rootKeys = [listParam!, ...rootKeys];

    /* Inject filepath params from chain_params not already in any knobs array */
    const allKnobKeys = new Set<string>();
    for (const lvl of Object.values(allLevels)) {
        for (const k of (lvl.knobs ?? [])) {
            const key = typeof k === 'string' ? k : k.key;
            if (key) allKnobKeys.add(key);
        }
    }
    const orphanFilePaths = Object.entries(cpMap)
        .filter(([key, cp]) => (cp as { type?: string }).type === 'filepath' && !allKnobKeys.has(key))
        .map(([key]) => key);
    if (orphanFilePaths.length > 0) rootKeys = [...orphanFilePaths, ...rootKeys];

    if (rootKeys.length > 0) addLevel('Main', rootKeys);

    /* Every level below root comes from the shared walk. */
    const rootLevelKey = allLevels['root'] ? 'root' : Object.keys(allLevels)[0];
    for (const page of buildLevelPages(allLevels, rootLevelKey)) {
        addLevel(page.name, page.keys);
    }
    }  /* end hierarchy path (else of the chain_params fallback) */

    /* Build s.knobParams and s.bankNames from bankEntries */
    s.bankNames = bankEntries.map(e => e.name);
    for (const entry of bankEntries) {
        for (const key of entry.keys) {
            if (!key) { s.knobParams.push(null); continue; }
            if (key === listParam && presetParam) { s.knobParams.push(presetParam); continue; }

            s.knobParams.push(buildGenericParam(
                key, cpMap[key] ?? {}, paramDefs[key] ?? knobInline[key] ?? {},
            ));
        }
    }

    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    s.enumFmt    = new Array(s.knobParams.length).fill(undefined) as (boolean | undefined)[];
    s.fileValues = new Array(s.knobParams.length).fill(null) as (string | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params, ' + bankEntries.length + ' banks');
    s.dirty = true;
}
