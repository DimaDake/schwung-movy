/* Dump a chain slot's params before a module swap, in the order they must be
 * written back.
 *
 * A module load is destructive: schwung tears the outgoing module down and the
 * new one comes up with defaults, so the inverse needs the old module AND
 * everything it was holding. Nothing else records that, and after the swap it
 * is gone — so the dump has to happen on the way in.
 *
 * ORDER IS THE HARD PART. Some params rewrite others when they are set:
 *
 *   - A preset/program change makes the DSP overwrite most of the module's
 *     parameters, and it does so ASYNCHRONOUSLY (airwindows rewrites them a
 *     moment after the change lands). Written last, it would throw away every
 *     value we had just restored.
 *   - A selector goes further and changes what the other params even MEAN:
 *     `clap:plugin_index` (airwindows) picks the plugin behind `param_0…5`, and
 *     `osirus:rom_index`/`bank_index` (Virus) pick the ROM the preset list is
 *     read from. Written after the preset, the preset index would address the
 *     wrong bank.
 *
 * So the dump is emitted in three tiers — selector, preset, then everything
 * else — and module-apply.ts waits between them for the DSP to settle. The
 * ordinary params go last on purpose: they are the user's own edits, and they
 * must win over whatever the preset just re-applied.
 *
 * The key list comes from `chain_params`, which is the module's own statement of
 * what it exposes. Values come from a direct read: movy's knobValues mirror
 * covers only params the hierarchy puts on a page, and a module can publish
 * more than it shows. Module swaps are rare and already slow, so a burst of
 * reads here is affordable in a way it would never be on a knob turn. */

import { mlog } from '../log.js';

/* Reads can come back empty on a transient shim round-trip; schwung's own
 * getSlotStateWithRetry retries the same way before trusting an empty answer. */
const STATE_READ_TRIES = 4;

/**
 * The whole module's state as one opaque blob, or null if it has none.
 *
 * This is schwung's own save/restore channel: `<component>:state` is the JSON
 * of every param the module holds, and writing it back is — in schwung's
 * words — "the verified slot-load path". Its module presets and its per-slot
 * autosave are both built on it, generically, with no per-module code.
 *
 * For undo that is worth far more than replaying params one at a time: the DSP
 * applies the blob itself, so there is no preset-versus-parameter ordering to
 * get right, no settling to wait out, and params movy never sees are covered
 * too. The per-param replay stays as the fallback for modules that expose no
 * state.
 */
export function captureModuleState(slot: number, componentKey: string): string | null {
    if (typeof shadow_get_param !== 'function') return null;
    for (let i = 0; i < STATE_READ_TRIES; i++) {
        const raw = shadow_get_param(slot, componentKey + ':state');
        /* schwung treats a blob that is not a JSON object as "unsupported"
         * (remote_ui.go fetchAllParams), so this matches its own test. */
        if (raw && raw.charAt(0) === '{') return raw;
    }
    return null;
}

interface ChainParam { key?: string; type?: string; readonly?: boolean }

/** Params that describe the module rather than configure it. schwung
 *  republishes these on load, and writing them back means nothing. */
const METADATA = /^(ui_hierarchy|chain_params|preset_names?|preset_name_\d+|preset_count|program_count|plugin_count|mode_count|name|module)$/;

/* Params that FIRE something rather than hold a value. Replaying one would not
 * restore state, it would perform an action — `rnd_patch` randomises the user's
 * patch, `save_preset` overwrites a preset slot. The DSP gives no signal for
 * this (they are typed as ordinary ints, floats and enums), so the name is all
 * there is; movy's own configs mark them `behavior: 'trigger'` for the same
 * reason. Being too eager here only loses one value from a restore. Being too
 * lax destroys the user's patch. */
const ACTION = /(^|_)(rnd|save|reset|init|load|clear|randomi[sz]e)(_|$)/i;

/* Tier 0 — selectors: they change what the other params mean or where the
 * preset list is read from, so they go first. A ROM contains banks, so it is
 * ordered ahead of them; `SELECTOR_ORDER` is the rank within the tier. */
const SELECTOR = /^(rom_index|bank_index|plugin_index|patchbank|bank|rom)$/;
const SELECTOR_ORDER = (key: string): number => (/^(rom_index|rom)$/.test(key) ? 0 : 1);

/* Tier 1 — the preset itself. `list_param` from the module's own ui_hierarchy is
 * authoritative (it is `preset`, `program`, `plugin_index`, `preset_index` or
 * `mode` depending on the module); these names are the fallback for modules that
 * expose a preset without declaring one. */
const PRESET = /^(preset|program|patchnumber|preset_index|current_preset)$/;

export function paramTier(key: string, listParam: string): number {
    if (SELECTOR.test(key)) return 0;
    /* A declared list_param that is itself a selector was already caught above;
     * anything else declared is the preset list. */
    if (key === listParam || PRESET.test(key)) return 1;
    return 2;
}

function restorable(cp: ChainParam): boolean {
    if (!cp.key || cp.readonly) return false;
    if (METADATA.test(cp.key)) return false;
    if (ACTION.test(cp.key)) return false;
    return true;
}

/** The module's declared preset-list param, or '' when it declares none. */
function listParamOf(slot: number, componentKey: string): string {
    const raw = shadow_get_param(slot, componentKey + ':ui_hierarchy');
    if (!raw) return '';
    try {
        const h = JSON.parse(raw) as { levels?: { root?: { list_param?: string } } };
        return h.levels?.root?.list_param ?? '';
    } catch {
        return '';
    }
}

export interface ModuleDump {
    params: [string, string][];
    /* How many leading entries are tier 0+1. module-apply writes those, waits
     * for the DSP to finish re-applying the preset, then writes the rest. */
    leadCount: number;
}

export function dumpModuleParams(slot: number, componentKey: string): ModuleDump {
    const empty: ModuleDump = { params: [], leadCount: 0 };
    if (typeof shadow_get_param !== 'function') return empty;
    const raw = shadow_get_param(slot, componentKey + ':chain_params');
    if (!raw) return empty;
    let arr: ChainParam[];
    try {
        arr = JSON.parse(raw) as ChainParam[];
    } catch (e) {
        mlog('undo: chain_params parse failed — module undo will be partial: ' + e);
        return empty;
    }

    const listParam = listParamOf(slot, componentKey);
    const tiers: [string, string][][] = [[], [], []];
    const taken = new Set<string>();
    for (const cp of arr) {
        if (!restorable(cp)) continue;
        const v = shadow_get_param(slot, componentKey + ':' + cp.key);
        if (v === null) continue;
        taken.add(cp.key as string);
        tiers[paramTier(cp.key as string, listParam)].push([cp.key as string, v]);
    }
    /* A module can DECLARE its selector/preset param without publishing it in
     * chain_params — airwindows (the `clap` module) exposes only `param_0…5`
     * there while `plugin_index` picks which plugin those six belong to. Missing
     * it would restore six numbers into whatever plugin happened to be loaded. */
    if (listParam && !taken.has(listParam)) {
        const v = shadow_get_param(slot, componentKey + ':' + listParam);
        if (v !== null) tiers[paramTier(listParam, listParam)].push([listParam, v]);
    }
    tiers[0].sort((a, b) => SELECTOR_ORDER(a[0]) - SELECTOR_ORDER(b[0]));
    const params = [...tiers[0], ...tiers[1], ...tiers[2]];
    const leadCount = tiers[0].length + tiers[1].length;
    mlog('undo: dumped ' + params.length + ' params from ' + componentKey
        + ' (' + leadCount + ' lead)');
    return { params, leadCount };
}
