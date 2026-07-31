/* Generic (no movy config) page assembly: a module's ui_hierarchy levels — and
 * the chain_params fallback for modules that publish none — become the ordered
 * knob pages. hierarchy.ts owns fetching and dispatch; this file owns layout. */
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { mlog } from '../log.js';
import { KNOBS_PER_PAGE } from './constants.js';
import { buildLevelPages, knobKeys } from './hierarchy-walk.js';
import type { WalkLevel } from './hierarchy-walk.js';
import { makeExtrasPicker } from './level-extras.js';
import { buildPresetParam } from './preset-param.js';
import type { RawMeta } from './param-build.js';
import { buildGenericParam } from './param-build.js';

export interface GenericLevel {
    name?: string;
    knobs?: (string | RawMeta)[];
    params?: (string | RawMeta)[];
    list_param?: string; count_param?: string; name_param?: string;
    children?: string;
}

export function buildGenericPages(
    s: ModelState,
    cpMap: Record<string, RawMeta>,
    cpOrder: string[],
    paramDefs: Record<string, RawMeta>,
    knobInline: Record<string, RawMeta>,
    allLevels: Record<string, GenericLevel>,
): void {
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
            // Page 1 keeps the plain level name: params[] extras make many
            // single-page levels multi-page, and suffixing page 1 would rename
            // every module's first page for no reason.
            addPage(
                i === 0 ? label : label + ' - ' + (i + 1),
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

    /* The picker is stateful — ask each level exactly once, root included. */
    const extras = makeExtrasPicker(cpMap, allKnobKeys, listParam);
    const rootExtras = extras(rootLevel as WalkLevel);
    if (rootKeys.length > 0 || rootExtras.length > 0) {
        addLevel('Main', [...rootKeys, ...rootExtras]);
    }

    /* Every level below root comes from the shared walk. */
    const rootLevelKey = allLevels['root'] ? 'root' : Object.keys(allLevels)[0];
    for (const page of buildLevelPages(allLevels, rootLevelKey, { extras })) {
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
