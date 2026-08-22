import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { mlog } from '../log.js';

/* Item-selector levels: a ui_hierarchy level that carries `items_param` +
 * `select_param` instead of knobs (dexed's .syx banks, obxd's .fxb banks,
 * sf2's soundfonts, nam's models/cabs). movy renders it as ONE knob cell
 * beside the preset cell. See plans/2026-08-22-item-selector-design.md.
 *
 * The module hands over labels and integers only — never a path. `items_param`
 * reads a JSON array of {label|name, index}; the choice is committed by writing
 * that index to `select_param`, and the DSP resolves it to a file itself. So
 * this is an enum whose options the module supplies, NOT a file param:
 * midiverb's unit_list has no filesystem behind it at all. */

export interface ItemsLevel {
    name?: string; label?: string;
    items_param?: string; select_param?: string;
    /* Only nav entries are read from here — the label a parent hangs on this
     * level, used when the level names itself nothing. */
    params?: unknown[];
}

interface RawItem { label?: string; name?: string; index?: number }

/* movy already calls a knob PAGE a "bank" (ModelState.bankNames), so the
 * feature is named for the contract instead — the user-facing label is
 * whatever the module declares ("SYX Banks", "Soundfont", "Cabinet"). */
export const ITEMS_RENDER = 'items';

function parseItems(raw: string | null): { labels: string[]; indices: number[] } | null {
    if (!raw) return null;
    let arr: RawItem[];
    try { arr = JSON.parse(raw) as RawItem[]; } catch { return null; }
    if (!Array.isArray(arr) || arr.length === 0) return null;

    const labels: string[] = [];
    const indices: number[] = [];
    for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (!it || typeof it !== 'object') return null;
        /* The host's own fallback chain (shadow_ui.js:10704). Labels are used
         * verbatim: dexed emits the raw filename with extension, obxd strips
         * `.fxb` and forces "Factory" first. That is what each module calls its
         * own items. */
        labels.push(String(it.label ?? it.name ?? ('Item ' + i)));
        /* An explicit index is part of the contract and nothing promises it is
         * dense, so the wire value is never the array position. */
        indices.push(typeof it.index === 'number' ? it.index : i);
    }
    return { labels, indices };
}

/* Build the selector cell for one level, or null when the level is not a
 * selector movy can drive.
 *
 * The readback probe IS the selectors-only rule: surge/clap `jump_to_category`
 * and minijv `do_save_to_slot` are write-only commands (that last one saves a
 * patch over a slot). A cell that cannot read back its own selection has no
 * state to show, and the value-refresh cursor re-asserting one would fire it
 * repeatedly. No allowlist, and a module that later makes its selection
 * readable gets a cell with no movy change. */
export function buildItemSelectParam(
    s: ModelState, levelKey: string, level: ItemsLevel, navLabel?: string,
): KnobParam | null {
    const itemsKey  = level.items_param;
    const selectKey = level.select_param;
    if (!itemsKey || !selectKey) return null;

    /* Read on load and on knob touch only — dexed's syx_bank_list rescans the
     * filesystem on EVERY read (dx7_plugin.cpp:1642), and movy's tick period is
     * its MIDI sampling interval. This must never reach the refresh cursor. */
    const items = parseItems(s.port.getParam(s.componentKey + ':' + itemsKey));
    if (!items) return null;

    const raw = s.port.getParam(s.componentKey + ':' + selectKey);
    if (raw === null) return null;
    const cur = parseInt(raw, 10);
    if (isNaN(cur) || items.indices.indexOf(cur) < 0) return null;

    /* The device signal for scripts/test-items.sh. Neither key appears in
     * chain_params, so this line is the only proof the real module served a
     * list movy could build a cell from — and `cur` is the only proof a chosen
     * item STUCK. Logged from here because `raw` is already in hand; reading it
     * again at the call site would cost an extra ~2.8ms IPC round trip. */
    mlog('items selector ' + selectKey + ' n=' + items.labels.length + ' cur=' + cur);

    return {
        key: selectKey,
        /* The level says "Soundfont"; the nav entry says "Choose Soundfont".
         * hierarchy-walk prefers the nav label for PAGE names — a single cell
         * wants the noun. */
        label: level.label ?? level.name ?? navLabel ?? levelKey,
        shortLabel: null,
        type: 'enum', min: 0, max: items.labels.length - 1, step: 1,
        options: items.labels,
        itemIndices: items.indices,
        itemsKey: itemsKey,
        renderStyle: ITEMS_RENDER,
        /* Choosing an item reloads a whole bank of patches, so its inverse is
         * lossy exactly like a preset's — undo needs the module back. Note this
         * snapshots the module's OWN state blob, which is why movy must never
         * persist the index itself: it is positional over a sorted directory
         * scan and shifts when a file is added (dexed restores by NAME first,
         * dx7_plugin.cpp:977). */
        capturesModuleState: true,
        automatable: false,
    };
}

/* Every selector a hierarchy declares, in level-declaration order. */
export function buildItemSelectors(
    s: ModelState, allLevels: Record<string, ItemsLevel>,
): KnobParam[] {
    /* A level's display name is usually carried by the nav entry pointing at
     * it, which is the only label some modules give — used as a last resort. */
    const navLabel: Record<string, string> = {};
    for (const lvl of Object.values(allLevels)) {
        for (const p of (lvl?.params ?? [])) {
            const e = p as { level?: string; label?: string };
            if (e && typeof e === 'object' && e.level && e.label) navLabel[e.level] = e.label;
        }
    }

    const out: KnobParam[] = [];
    for (const [key, lvl] of Object.entries(allLevels)) {
        if (!lvl?.items_param) continue;
        const p = buildItemSelectParam(s, key, lvl, navLabel[key]);
        if (p) out.push(p);
    }
    return out;
}

/* Screen position (index into `options`) for a value read off select_param.
 * Returns null when the module reports something not in the list. */
export function itemPositionOf(p: KnobParam, raw: string | null): number | null {
    if (!p.itemIndices || raw === null) return null;
    const n = parseInt(raw, 10);
    if (isNaN(n)) return null;
    const pos = p.itemIndices.indexOf(n);
    return pos < 0 ? null : pos;
}

/* The wire value for a screen position — the module's index, not the position. */
export function itemValueAt(p: KnobParam, pos: number): string {
    const idx = p.itemIndices?.[pos];
    return String(idx === undefined ? pos : idx);
}

/* Re-read the list for a selector that is about to be shown in the overlay, so
 * a bank uploaded from the schwung web UI while movy is open appears without a
 * reopen. Mutates the param in place and returns the position to preselect.
 * Only ever called on a knob TOUCH — the read rescans a directory. */
export function refreshItems(s: ModelState, p: KnobParam): number | null {
    if (!p.itemsKey) return null;
    const items = parseItems(s.port.getParam(s.componentKey + ':' + p.itemsKey));
    if (!items) return null;
    p.options     = items.labels;
    p.itemIndices = items.indices;
    p.max         = items.labels.length - 1;
    return itemPositionOf(p, s.port.getParam(s.componentKey + ':' + p.key));
}

export function isItemSelector(p: KnobParam | null | undefined): boolean {
    return !!p && p.renderStyle === ITEMS_RENDER;
}
