/* Generic (no movy config) page assembly: a module's ui_hierarchy levels — and
 * the chain_params fallback for modules that publish none — become the ordered
 * knob pages. hierarchy.ts owns fetching and dispatch; this file owns layout. */
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { mlog } from '../log.js';
import { KNOBS_PER_PAGE } from './constants.js';
import { buildLevelPages, knobKeys, levelOwnDefs } from './hierarchy-walk.js';
import type { WalkLevel } from './hierarchy-walk.js';
import { makeExtrasPicker } from './level-extras.js';
import { buildPresetParam } from './preset-param.js';
import { buildItemSelectors } from './items-param.js';
import type { RawMeta } from './param-build.js';
import { applyAutoStyle, buildGenericParam } from './param-build.js';

export interface GenericLevel {
    name?: string;
    knobs?: (string | RawMeta)[];
    params?: (string | RawMeta)[];
    list_param?: string; count_param?: string; name_param?: string;
    items_param?: string; select_param?: string;
    children?: string;
}

export function buildGenericPages(
    s: ModelState,
    cpMap: Record<string, RawMeta>,
    cpOrder: string[],
    /* Hierarchy-wide flattened fallback (hierarchy.ts's absorbHierarchy) —
     * last-write-wins across levels. Still needed: a level can list a key by
     * BARE STRING (no object) to deliberately reuse another level's canonical
     * declaration (filter's root lists lfo_rate_div in its knobs but only the
     * "lfo" level declares its short_name), and that inheritance has to keep
     * working. Only consulted when the page's OWN level does not redeclare the
     * key itself — see `entry.defs` below and SP-25. */
    paramDefs: Record<string, RawMeta>,
    knobInline: Record<string, RawMeta>,
    allLevels: Record<string, GenericLevel>,
): void {
    /* ── Generic no-config path: parse all levels ────────────────────────── */
    const rootLevel = allLevels['root'] || Object.values(allLevels)[0] || null;

    /* Bank page accumulator: each entry is KNOBS_PER_PAGE keys (null = empty
     * slot), plus the OWN defs of the one level this page was built from — a
     * level's own object-keyed params[]/knobs[] entries, never the flattened
     * fallback above. The same param key can appear on more than one page,
     * each declaring it with its OWN object entry (jp8000's Performance/Setup/
     * Arp pages each redeclare key_mode/arp_mode with a DIFFERENT short_name);
     * the flattened map remembers only whichever level absorbHierarchy visited
     * last, which silently hands one page a def some OTHER page declared
     * (SP-25). A page's own level is asked FIRST; `paramDefs`/`knobInline`
     * only apply when it said nothing about that key at all. */
    const bankEntries: Array<{ name: string; keys: (string | null)[]; group: number; defs: Record<string, RawMeta> }> = [];
    /* Pages from the same level share a group id — see ModelState.bankGroups. */
    let nextGroup = 0;

    function addPage(name: string, keys: (string | null)[], group: number, defs: Record<string, RawMeta>): void {
        const padded = keys.slice(0, KNOBS_PER_PAGE);
        while (padded.length < KNOBS_PER_PAGE) padded.push(null);
        bankEntries.push({ name, keys: padded, group, defs });
    }

    function addLevel(label: string, keys0: string[], defs: Record<string, RawMeta>): void {
        /* Drop what the module says does not apply right now (visible_if).
         * Filtering HERE rather than at render time keeps every downstream
         * consumer honest at once: the param never gets a cell, so the knob
         * cannot edit it, automation cannot bind it, and knob-leds sees a null
         * cell and darkens the LED. */
        const keys = keys0.filter(k => !s.hiddenKeys.has(k));
        const group = nextGroup++;
        const pages = Math.max(1, Math.ceil(keys.length / KNOBS_PER_PAGE));
        for (let i = 0; i < pages; i++) {
            // Page 1 keeps the plain level name: params[] extras make many
            // single-page levels multi-page, and suffixing page 1 would rename
            // every module's first page for no reason.
            addPage(
                i === 0 ? label : label + ' - ' + (i + 1),
                keys.slice(i * KNOBS_PER_PAGE, (i + 1) * KNOBS_PER_PAGE),
                group,
                defs,
            );
        }
    }

    /* The preset param and its list key are consumed by the final build loop;
     * declared here so both the hierarchy path and the chain_params fallback
     * (which leaves them unset) can share that loop. */
    let presetParam: KnobParam | null = null;
    let listParam: string | undefined;

    /* Synthesized like presetParam: the key names select_param, and the final
     * build loop swaps in this object rather than deriving one from
     * chain_params (a selector has no chain_params entry). */
    const selectors = buildItemSelectors(s, allLevels);
    const selMap: Record<string, KnobParam> = {};
    for (const p of selectors) selMap[p.key] = p;

    if (!rootLevel) {
        /* B1: modules that publish chain_params but no ui_hierarchy would show an
         * empty page. Build pages straight from the chain_params publish order.
         * Filepath entries become file knobs in the final build loop below, so no
         * orphan-filepath injection here (which would double-add them); ui_* keys
         * are internal UI state, not user-facing params. */
        const fallbackKeys = cpOrder.filter(k => !k.startsWith('ui_'));
        // No ui_hierarchy at all here (that's what routed to this branch), so
        // there is no level to own a def — chain_params (cpMap) is the only
        // source buildGenericParam has below.
        if (fallbackKeys.length > 0) addLevel('Main', fallbackKeys, {});
    } else {

    /* root's own defs — the preset/selector keys on the pages below are both
     * intercepted by presetParam/selMap in the final build loop, never read
     * from this, but every other root-owned key is. */
    const rootDefs = levelOwnDefs(rootLevel as WalkLevel);

    /* Preset detection */
    listParam   = rootLevel.list_param;
    s.presetDeclared = !!(rootLevel.list_param && rootLevel.count_param);
    presetParam = buildPresetParam(s, listParam, rootLevel.count_param, rootLevel.name_param);
    const presetSeparate = presetParam != null && (rootLevel.knobs ?? []).length >= KNOBS_PER_PAGE;

    /* Dedicated Preset page before Main when Main is full */
    if (presetParam && presetSeparate) {
        addPage('Preset', [...selectors.map(p => p.key), listParam!], nextGroup++, rootDefs);
    }

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

    /* Item selectors (dexed banks, sf2 soundfonts, nam models/cabs) sit
     * immediately left of the preset cell: a level with items_param declares no
     * knobs, so without this it renders nothing at all. */
    if (!presetSeparate && selectors.length > 0) {
        // Spliced as one block, not one at a time: repeated inserts at the same
        // index would reverse a module's declaration order (nam: models, cabs).
        const at = listParam ? rootKeys.indexOf(listParam) : -1;
        rootKeys.splice(at < 0 ? 0 : at, 0, ...selectors.map(p => p.key));
    }

    /* The picker is stateful — ask each level exactly once, root included. */
    const extras = makeExtrasPicker(cpMap, allKnobKeys, listParam, s.degenerateKeys);
    const rootExtras = extras(rootLevel as WalkLevel);
    if (rootKeys.length > 0 || rootExtras.length > 0) {
        addLevel('Main', [...rootKeys, ...rootExtras], rootDefs);
    }

    /* Every level below root comes from the shared walk, each page carrying
     * the defs of the one level it was built from. */
    const rootLevelKey = allLevels['root'] ? 'root' : Object.keys(allLevels)[0];
    for (const page of buildLevelPages(allLevels, rootLevelKey, { extras })) {
        addLevel(page.name, page.keys, page.defs);
    }
    }  /* end hierarchy path (else of the chain_params fallback) */

    /* Build s.knobParams and s.bankNames from bankEntries */
    s.bankNames  = bankEntries.map(e => e.name);
    s.bankGroups = bankEntries.map(e => e.group);
    for (const entry of bankEntries) {
        for (const key of entry.keys) {
            if (!key) { s.knobParams.push(null); continue; }
            if (key === listParam && presetParam) { s.knobParams.push(presetParam); continue; }
            if (selMap[key]) { s.knobParams.push(selMap[key]); continue; }

            s.knobParams.push(applyAutoStyle(buildGenericParam(
                key, cpMap[key] ?? {}, entry.defs[key] ?? paramDefs[key] ?? knobInline[key] ?? {},
            )));
        }
    }

    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    s.enumFmt    = new Array(s.knobParams.length).fill(undefined) as (boolean | undefined)[];
    s.fileValues = new Array(s.knobParams.length).fill(null) as (string | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params, ' + bankEntries.length + ' banks');
    s.dirty = true;
}
