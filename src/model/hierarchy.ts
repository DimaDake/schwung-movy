import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { loadModuleConfig } from '../modules/loader.js';
import { mlog } from '../log.js';
import { KNOBS_PER_PAGE } from './constants.js';

interface HierParam {
    key?: string; label?: string; level?: string;
    type?: string; min?: number; max?: number; step?: number; options?: string[];
}
interface HierLevel {
    knobs?: (string | HierParam)[];
    params?: (string | HierParam)[];
    list_param?: string; count_param?: string; name_param?: string;
    items_param?: string; select_param?: string;
}

function inferRenderStyle(type: KnobParam['type'], min: number, max: number): KnobParam['renderStyle'] {
    return (type === 'int' && min === 0 && max === 1) ? 'hbar' : 'arc';
}

export function loadHierarchy(s: ModelState): void {
    s.knobParams   = [];
    s.knobValues   = [];
    s.moduleConfig = null;
    s.bankNames    = [];
    s.hierarchyKey = s.activeModuleName;

    mlog('loadHierarchy: slot=' + s.activeSlot + ' module=' + s.activeModuleName);
    s.moduleId = shadow_get_param(s.activeSlot, s.componentKey + '_module') || '';

    /* chain_params → cpMap for type/min/max/step/options/name lookups */
    const cpMap: Record<string, HierParam & { name?: string }> = {};
    const chainParamsRaw = shadow_get_param(s.activeSlot, s.componentKey + ':chain_params');
    if (chainParamsRaw) {
        try {
            const arr = JSON.parse(chainParamsRaw) as Array<{ key?: string }>;
            for (const cp of arr) { if (cp.key) cpMap[cp.key] = cp; }
            mlog('loadHierarchy: chain_params ' + arr.length + ' entries');
        } catch (e) { mlog('chain_params parse error: ' + e); }
    }

    const raw = shadow_get_param(s.activeSlot, s.componentKey + ':ui_hierarchy');
    if (!raw) {
        mlog('loadHierarchy: ui_hierarchy null — using test params');
        s.knobParams = [
            { key: 'test_a', label: 'TestA', shortLabel: null, type: 'float', min: 0, max: 1,   step: 0.02, options: null, renderStyle: 'arc' },
            { key: 'test_b', label: 'TestB', shortLabel: null, type: 'int',   min: 0, max: 127, step: 1,    options: null, renderStyle: 'arc' },
        ];
        s.knobValues = [0.5, 64];
        s.dirty = true;
        return;
    }

    /* Parse ui_hierarchy — build paramDefs (from .params arrays) and knobInline
     * (from inline object knobs) for label/type fallback lookups */
    const paramDefs:  Record<string, HierParam> = {};
    const knobInline: Record<string, HierParam> = {};
    let allLevels: Record<string, HierLevel> = {};
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

    s.moduleConfig = loadModuleConfig(s.moduleId);

    /* ── Custom config path (Plaits, Wurl, etc.) ─────────────────────────── */
    if (s.moduleConfig) {
        for (const bank of s.moduleConfig.banks) {
            for (const row of bank.rows) {
                for (const slot of row) {
                    if (!slot?.key) { s.knobParams.push(null); continue; }
                    const cp   = cpMap[slot.key]   ?? {};
                    const hier = paramDefs[slot.key] ?? {};
                    const type = slot.type || cp.type || hier.type || 'float';
                    const options = cp.options ?? hier.options ?? null;
                    let min  = cp.min  != null ? cp.min  : (hier.min  != null ? hier.min  : 0);
                    let max  = cp.max  != null ? cp.max  : (hier.max  != null ? hier.max  : 1);
                    let step = cp.step != null ? cp.step : (hier.step != null ? hier.step : (type === 'float' ? 0.01 : 1));
                    if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                    const renderStyle = slot.render ?? inferRenderStyle(type as KnobParam['type'], min, max);
                    s.knobParams.push({
                        key:        slot.key,
                        label:      slot.full || cp.name || hier.label || slot.key,
                        shortLabel: slot.short ?? null,
                        type:       type as KnobParam['type'],
                        options, min, max, step, renderStyle,
                    });
                }
            }
        }
        mlog('loadHierarchy: config for ' + s.moduleId + ', ' + s.moduleConfig.banks.length + ' banks');
        s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
        s.dirty = true;
        return;
    }

    /* ── Generic no-config path: parse all levels ────────────────────────── */
    const rootLevel = allLevels['root'] || Object.values(allLevels)[0] || null;
    if (!rootLevel) { s.dirty = true; return; }

    function toKey(k: string | HierParam): string | null {
        return typeof k === 'string' ? k : (k.key ?? null);
    }

    /* Level → display label map from root.params navigation entries */
    const levelLabel: Record<string, string> = {};
    if (Array.isArray(rootLevel.params)) {
        for (const p of rootLevel.params) {
            if (typeof p === 'object' && p.level && p.label) levelLabel[p.level] = p.label;
        }
    }

    /* Preset detection */
    let presetParam: KnobParam | null = null;
    const listParam  = rootLevel.list_param;
    const countParam = rootLevel.count_param;
    const nameParam  = rootLevel.name_param;
    let presetSeparate = false;

    if (listParam && countParam) {
        const countRaw    = shadow_get_param(s.activeSlot, s.componentKey + ':' + countParam);
        const presetCount = countRaw ? parseInt(countRaw) : 0;
        if (presetCount > 0) {
            let allNames: string[] | null = null;

            /* Strategy 1: bulk JSON array */
            const namesRaw = shadow_get_param(s.activeSlot, s.componentKey + ':preset_names');
            if (namesRaw) { try { allNames = JSON.parse(namesRaw) as string[]; } catch {} }

            /* Strategy 2: per-index query */
            if (!allNames && shadow_get_param(s.activeSlot, s.componentKey + ':preset_name_0') !== null) {
                allNames = [];
                for (let i = 0; i < presetCount; i++) {
                    allNames.push(shadow_get_param(s.activeSlot, s.componentKey + ':preset_name_' + i) ?? String(i));
                }
            }

            presetParam = {
                key: listParam, label: 'Preset', shortLabel: null,
                type: 'enum', min: 0, max: presetCount - 1, step: 1,
                options: allNames,
                nameKey: allNames ? undefined : (nameParam ?? undefined),
                renderStyle: 'arc',
            };
            presetSeparate = (rootLevel.knobs ?? []).length >= KNOBS_PER_PAGE;
        }
    }

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

    /* Dedicated Preset page before Main when Main is full */
    if (presetParam && presetSeparate) addPage('Preset', [listParam!]);

    /* Main page from root.knobs (with preset prepended if there's room) */
    let rootKeys = (rootLevel.knobs ?? []).map(toKey).filter((k): k is string => k !== null);
    if (presetParam && !presetSeparate) rootKeys = [listParam!, ...rootKeys];
    if (rootKeys.length > 0) addLevel('Main', rootKeys);

    /* Sub-levels from root.params order — skip navigation-only levels (no knobs) */
    if (Array.isArray(rootLevel.params)) {
        for (const entry of rootLevel.params) {
            if (typeof entry !== 'object' || !entry.level) continue;
            const lvl = allLevels[entry.level];
            if (!lvl || !Array.isArray(lvl.knobs) || lvl.knobs.length === 0) continue;
            const keys = lvl.knobs.map(toKey).filter((k): k is string => k !== null);
            if (keys.length > 0) addLevel(levelLabel[entry.level] || entry.level, keys);
        }
    }

    /* Build s.knobParams and s.bankNames from bankEntries */
    s.bankNames = bankEntries.map(e => e.name);
    for (const entry of bankEntries) {
        for (const key of entry.keys) {
            if (!key) { s.knobParams.push(null); continue; }
            if (key === listParam && presetParam) { s.knobParams.push(presetParam); continue; }

            const cp  = cpMap[key]       ?? {};
            const def = paramDefs[key]   ?? knobInline[key] ?? {};
            const type    = cp.type    || def.type    || 'float';
            const options = cp.options ?? def.options ?? null;
            let min  = cp.min  != null ? cp.min  : (def.min  != null ? def.min  : 0);
            let max  = cp.max  != null ? cp.max  : (def.max  != null ? def.max  : 1);
            let step = cp.step != null ? cp.step : (def.step != null ? def.step : (type === 'float' ? 0.02 : 1));
            if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
            s.knobParams.push({
                key,
                label:      cp.name || def.label || key,
                shortLabel: null,
                type:       type as KnobParam['type'],
                options, min, max, step,
                renderStyle: inferRenderStyle(type as KnobParam['type'], min, max),
            });
        }
    }

    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params, ' + bankEntries.length + ' banks');
    s.dirty = true;
}
