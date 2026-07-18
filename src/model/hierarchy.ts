import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { loadModuleConfig } from '../modules/loader.js';
import { mlog } from '../log.js';
import { moduleReadKey } from '../chain/config.js';
import { KNOBS_PER_PAGE } from './constants.js';

interface HierParam {
    key?: string; label?: string; level?: string;
    type?: string; min?: number; max?: number; step?: number; options?: string[];
}
interface HierLevel {
    name?: string;
    knobs?: (string | HierParam)[];
    params?: (string | HierParam)[];
    list_param?: string; count_param?: string; name_param?: string;
    items_param?: string; select_param?: string;
    children?: string;
}

function inferRenderStyle(type: KnobParam['type'], min: number, max: number): KnobParam['renderStyle'] {
    return (type === 'int' && min === 0 && max === 1) ? 'hbar' : 'arc';
}

function parseFilter(filter: unknown): string[] {
    if (!filter) return [];
    const vals = Array.isArray(filter) ? filter as unknown[] : [filter];
    return (vals as string[])
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map(v => v.toLowerCase().startsWith('.') ? v.toLowerCase() : '.' + v.toLowerCase());
}

/* Build the name-polled preset knob from a list/count/name param triple.
 * Names come from a bulk `preset_names` JSON array, else per-index
 * `preset_name_N`, else live polling of `nameKey`. Returns null when there's
 * no list+count or the count is empty — callers then fall back (config: a plain
 * indexed knob; generic: no preset knob). Shared by the hierarchy and config
 * paths so both render identical named presets. */
function buildPresetParam(
    s: ModelState, listParam?: string, countParam?: string, nameParam?: string,
): KnobParam | null {
    if (!listParam || !countParam) return null;
    const countRaw = shadow_get_param(s.activeSlot, s.componentKey + ':' + countParam);
    const presetCount = countRaw ? parseInt(countRaw) : 0;
    if (!(presetCount > 0)) return null;

    let allNames: string[] | null = null;
    const namesRaw = shadow_get_param(s.activeSlot, s.componentKey + ':preset_names');
    if (namesRaw) { try { allNames = JSON.parse(namesRaw) as string[]; } catch {} }
    if (!allNames && shadow_get_param(s.activeSlot, s.componentKey + ':preset_name_0') !== null) {
        allNames = [];
        for (let i = 0; i < presetCount; i++) {
            allNames.push(shadow_get_param(s.activeSlot, s.componentKey + ':preset_name_' + i) ?? String(i));
        }
    }
    return {
        key: listParam, label: 'Preset', shortLabel: null,
        type: 'enum', min: 0, max: presetCount - 1, step: 1,
        options: allNames,
        nameKey: allNames ? undefined : (nameParam ?? undefined),
        renderStyle: 'preset',
        automatable: false,
    };
}

export function loadHierarchy(s: ModelState): void {
    s.knobParams   = [];
    s.knobValues   = [];
    s.moduleConfig = null;
    s.bankNames    = [];
    s.slotMapCache = null;
    s.hierarchyKey = s.activeModuleName;

    mlog('loadHierarchy: slot=' + s.activeSlot + ' module=' + s.activeModuleName);
    s.moduleId = shadow_get_param(s.activeSlot, moduleReadKey(s.componentKey)) || '';

    s.moduleConfig = loadModuleConfig(s.moduleId);

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
        // Root level of the runtime hierarchy supplies preset count/name param
        // keys for `render: 'preset'` slots (no per-module hardcoding).
        const cfgRoot = allLevels['root'] || Object.values(allLevels)[0] || null;
        for (const bank of s.moduleConfig.banks) {
            const bankStart = s.knobParams.length;
            for (const row of bank.rows) {
                for (const slot of row) {
                    if (!slot?.key) { s.knobParams.push(null); continue; }
                    /* Named preset knob: reuse the generic name-polling builder,
                     * pulling count/name keys from the hierarchy root unless the
                     * slot overrides them. Falls through to a plain knob when no
                     * preset list is resolvable (indexed value shown). */
                    if (slot.render === 'preset') {
                        const pp = buildPresetParam(
                            s, slot.key,
                            slot.presetCountKey ?? cfgRoot?.count_param,
                            slot.presetNameKey  ?? cfgRoot?.name_param,
                        );
                        if (pp) {
                            if (slot.short) pp.shortLabel = slot.short;
                            if (slot.full)  pp.label      = slot.full;
                            s.knobParams.push(pp);
                            continue;
                        }
                    }
                    const cp   = cpMap[slot.key]   ?? {};
                    const hier = paramDefs[slot.key] ?? {};
                    // The module is authoritative for value metadata (type/range/
                    // options); the config's job is layout/presentation. A config
                    // value is only a GAP-FILLER for params the module doesn't
                    // report (e.g. moog osc3/4 wave enums absent from module.json),
                    // never an override — that just drifts (weird-dreams cutoff was
                    // pinned 0..1 while the DSP reports 20..18000).
                    const type = cp.type || hier.type || slot.type || 'float';
                    const options = cp.options ?? hier.options ?? slot.options ?? null;
                    let min  = cp.min  != null ? cp.min  : (hier.min  != null ? hier.min  : (slot.min  != null ? slot.min  : 0));
                    let max  = cp.max  != null ? cp.max  : (hier.max  != null ? hier.max  : (slot.max  != null ? slot.max  : 1));
                    let step = cp.step != null ? cp.step : (hier.step != null ? hier.step : (type === 'float' ? 0.01 : 1));
                    if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                    const renderStyle = slot.render ?? inferRenderStyle(type as KnobParam['type'], min, max);
                    const param: KnobParam = {
                        key:        slot.key,
                        label:      slot.full || cp.name || hier.label || slot.key,
                        shortLabel: slot.short ?? null,
                        type:       type as KnobParam['type'],
                        options, min, max, step, renderStyle,
                        env:        slot.env,
                        lfo:        slot.lfo,
                        filter:     slot.filter,
                        // Global-bank params aren't reachable as chain target:params
                        // (device spike), so they can't be automated. A config may
                        // override per slot (host can't resolve some per-voice keys).
                        automatable: slot.automatable ??
                            ((type === 'float' || type === 'int') && max > min && !bank.global),
                    };
                    /* File slots carry browse metadata. The module config (mrdrums.json)
                     * is authoritative; chain_params (root/filter/start_path) is the
                     * device fallback. Without this the browser loses its filter and
                     * start dir — it then lists every folder/non-preset and crashes
                     * mrdrums on load. */
                    if (type === 'file') {
                        param.fileRoot      = slot.fileRoot      ?? (cp as { root?: string }).root      ?? '/data/UserData';
                        param.fileFilter    = slot.fileFilter    ?? parseFilter((cp as { filter?: unknown }).filter);
                        param.fileStartPath = slot.fileStartPath ?? (cp as { start_path?: string }).start_path ?? param.fileRoot;
                        if (slot.fileRequireContains) param.fileRequireContains = slot.fileRequireContains;
                    }
                    s.knobParams.push(param);
                }
            }
            /* Each bank owns exactly one knob page: pages are fixed
             * knobPage*KNOBS_PER_PAGE slices and the bank name is looked up by
             * knobPage, so a bank with a partial/single row must pad to a full
             * page or every later bank's name desyncs from its params. */
            const rem = (s.knobParams.length - bankStart) % KNOBS_PER_PAGE;
            if (rem !== 0) for (let i = rem; i < KNOBS_PER_PAGE; i++) s.knobParams.push(null);
        }
        mlog('loadHierarchy: config for ' + s.moduleId + ', ' + s.moduleConfig.banks.length + ' banks');
        s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
        s.enumFmt    = new Array(s.knobParams.length).fill(undefined) as (boolean | undefined)[];
        s.fileValues = new Array(s.knobParams.length).fill(null) as (string | null)[];
        s.dirty = true;
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

    const hasNavEntries = (lvl: HierLevel | null): boolean =>
        Array.isArray(lvl?.params) && lvl!.params.some(p => typeof p === 'object' && (p as HierParam).level != null);
    const navLevel: HierLevel | null =
        hasNavEntries(rootLevel)
            ? rootLevel
            : (rootLevel?.children ? (allLevels[rootLevel.children] ?? rootLevel) : rootLevel);

    function toKey(k: string | HierParam): string | null {
        return typeof k === 'string' ? k : (k.key ?? null);
    }

    /* Level → display label map from navLevel.params navigation entries */
    const levelLabel: Record<string, string> = {};
    if (Array.isArray(navLevel?.params)) {
        for (const p of navLevel!.params!) {
            if (typeof p === 'object' && p.level && p.label) levelLabel[p.level] = p.label;
        }
    }

    /* Preset detection */
    listParam   = rootLevel.list_param;
    presetParam = buildPresetParam(s, listParam, rootLevel.count_param, rootLevel.name_param);
    const presetSeparate = presetParam != null && (rootLevel.knobs ?? []).length >= KNOBS_PER_PAGE;

    /* Dedicated Preset page before Main when Main is full */
    if (presetParam && presetSeparate) addPage('Preset', [listParam!]);

    /* Main page from root.knobs (with preset prepended if there's room) */
    let rootKeys = (rootLevel.knobs ?? []).map(toKey).filter((k): k is string => k !== null);
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

    /* Sub-levels from root.params — recurse into navigation-only levels */
    function levelNameToPrefix(name: string): string {
        const words = name.split(/\s+/).filter(Boolean);
        if (words.length === 0) return '';
        if (words.length === 1) return words[0].slice(0, 6);
        return (words[0].slice(0, 4) + words.slice(1).map(w => w[0].toUpperCase()).join('')).slice(0, 6);
    }

    const visitedLevels = new Set<string>();

    function addLevelOrExpand(levelKey: string, prefix: string | null, depth: number): void {
        if (depth > 2 || visitedLevels.has(levelKey)) return;
        visitedLevels.add(levelKey);
        const lvl = allLevels[levelKey];
        if (!lvl) return;
        const name  = lvl.name || levelLabel[levelKey] || levelKey;
        const label = prefix ? prefix + '/' + name : name;
        if (Array.isArray(lvl.knobs) && lvl.knobs.length > 0) {
            const keys = lvl.knobs.map(toKey).filter((k): k is string => k !== null);
            if (keys.length > 0) addLevel(label, keys);
        } else if (Array.isArray(lvl.params)) {
            const nextPrefix = levelNameToPrefix(name);
            for (const sub of lvl.params) {
                if (typeof sub !== 'object' || !sub.level) continue;
                addLevelOrExpand(sub.level, nextPrefix, depth + 1);
            }
        }
    }

    if (Array.isArray(navLevel?.params)) {
        for (const entry of navLevel!.params!) {
            if (typeof entry !== 'object' || !entry.level) continue;
            addLevelOrExpand(entry.level, null, 0);
        }
    }
    }  /* end hierarchy path (else of the chain_params fallback) */

    /* Build s.knobParams and s.bankNames from bankEntries */
    s.bankNames = bankEntries.map(e => e.name);
    for (const entry of bankEntries) {
        for (const key of entry.keys) {
            if (!key) { s.knobParams.push(null); continue; }
            if (key === listParam && presetParam) { s.knobParams.push(presetParam); continue; }

            const cp  = cpMap[key]       ?? {};
            const def = paramDefs[key]   ?? knobInline[key] ?? {};
            const type    = cp.type    || def.type    || 'float';
            if (type === 'filepath') {
                s.knobParams.push({
                    key,
                    label:      String((cp as { name?: string }).name ?? (def as { label?: string }).label ?? key),
                    shortLabel: null,
                    type:       'file',
                    min: 0, max: 0, step: 0,
                    options:    null,
                    renderStyle: 'arc',
                    automatable: false,
                    fileRoot:      String((cp as { root?: string }).root      ?? '/data/UserData'),
                    fileFilter:    parseFilter((cp as { filter?: unknown }).filter),
                    fileStartPath: String((cp as { start_path?: string }).start_path ?? (cp as { root?: string }).root ?? '/data/UserData'),
                });
                continue;
            }
            const options = cp.options ?? def.options ?? null;
            const hasRange = cp.min != null || cp.max != null || def.min != null || def.max != null;
            let min  = cp.min  != null ? cp.min  : (def.min  != null ? def.min  : 0);
            let max  = cp.max  != null ? cp.max  : (def.max  != null ? def.max  : 1);
            let step = cp.step != null ? cp.step : (def.step != null ? def.step : (type === 'float' ? 0.02 : 1));
            if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
            // C4: no metadata anywhere → movy guessed float 0..1 (numeric types
            // only). Flag it so the first value read can infer the real int type
            // and widen the range (see meta-infer.ts / store.ts).
            const metaGuessed = !hasRange && (type === 'float' || type === 'int');
            s.knobParams.push({
                key,
                label:      cp.name || def.label || key,
                shortLabel: null,
                type:       type as KnobParam['type'],
                options, min, max, step,
                renderStyle: inferRenderStyle(type as KnobParam['type'], min, max),
                // Config-less fallback: the `g_` global-naming convention is the
                // only signal available here. Modules with a movy config use
                // bank.global instead (see the config path above).
                automatable: (type === 'float' || type === 'int') && max > min && !key.startsWith('g_'),
                ...(metaGuessed ? { metaGuessed: true } : {}),
            });
        }
    }

    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    s.enumFmt    = new Array(s.knobParams.length).fill(undefined) as (boolean | undefined)[];
    s.fileValues = new Array(s.knobParams.length).fill(null) as (string | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params, ' + bankEntries.length + ' banks');
    s.dirty = true;
}
