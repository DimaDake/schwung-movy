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
import { laneKeysForTrack } from '../seq/automation.js';

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
        /* ANY non-empty blob, not just JSON. schwung's own slot save takes the
         * same line — it JSON.parses the state and, on failure, keeps it as an
         * opaque string ("State is not JSON (e.g. key=value pairs)") — and its
         * recall writes back whatever it stored. Demanding JSON here (as
         * remote_ui.go does, for its own reason: it needs to FLATTEN the blob
         * into individual params) would send a module with a key=value state
         * down the lossy param-dump path for no reason. */
        if (raw) return raw;
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
const SELECTOR = /^(rom_index|bank_index|plugin_index|patchbank|bank|rom|kit)$/;
const SELECTOR_ORDER = (key: string): number => (/^(rom_index|rom)$/.test(key) ? 0 : 1);

/* Tier 1 — the preset itself. `list_param` from the module's own ui_hierarchy is
 * authoritative (it is `preset`, `program`, `plugin_index`, `preset_index` or
 * `mode` depending on the module); these names are the fallback for modules that
 * expose a preset without declaring one. The `_preset` suffix catches the
 * per-voice lists a multi-voice module publishes (weird-dreams `v1_preset` …
 * `cv_preset`), each of which rewrites its own voice's params. */
const PRESET = /(^|_)(preset|program|patchnumber)$|^(preset_index|current_preset)$/;

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

/**
 * Params a slot LFO is currently driving.
 *
 * These must not be captured OR restored, for three separate reasons:
 *
 *   1. Reading one yields a MODULATION SAMPLE — wherever the LFO happened to be
 *      in its cycle — not a setting the user chose. Restoring it would write an
 *      arbitrary phase point back as if it were their value.
 *   2. It can never hold. The LFO overwrites the param on the next DSP tick, so
 *      the verify pass would rewrite it every round and still give up reporting
 *      "would not hold their value".
 *   3. The user's actual value, the base the LFO swings around, does not live in
 *      the DSP at all — movy owns it (see refreshAt in model/store.ts, which
 *      skips these keys for exactly this reason). Nothing here could read it.
 *
 * An automation lane drives a param the same way and for the same reasons, so
 * its keys are excluded too — model/store.ts's refreshAt already treats the two
 * as one class ("Automation lanes / LFO-modulated params are engine-driven").
 *
 * The LFO half is read directly rather than taken from the model so undo/ stays
 * independent of model/; it mirrors refreshModulatedKeys and costs at most four
 * reads on an operation that already does hundreds.
 */
function engineDrivenKeys(slot: number, componentKey: string): Set<string> {
    const out = new Set<string>();
    if (componentKey.startsWith('master_fx')) return out;   // slot LFOs are track-only
    for (let i = 1; i <= 2; i++) {
        if (shadow_get_param(slot, 'lfo' + i + ':target') !== componentKey) continue;
        const tp = shadow_get_param(slot, 'lfo' + i + ':target_param');
        if (tp) out.add(tp);
    }
    /* Automation lanes: the registry keys on the same bare ioKey the dump does. */
    for (const k of laneKeysForTrack(slot)) out.add(k);
    return out;
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

/* The slot-LFO fields that POINT AT the module: schwung stores these outside
 * `<component>:state` (its own slot save writes `patch.lfos` separately), so
 * neither the state blob nor a param dump carries them. Swapping the module
 * therefore strands the assignment, and undoing the swap brought the module
 * back with nothing driving it. The LFO's own shape/rate/depth are untouched by
 * a swap and are deliberately not captured. */
const LFO_ASSIGN_KEYS = ['target', 'target_param', 'enabled'];

/** Capture which slot LFOs point at this component, for restore after a swap. */
export function captureLfoAssignments(slot: number, componentKey: string): [string, string][] {
    const out: [string, string][] = [];
    if (typeof shadow_get_param !== 'function') return out;
    if (componentKey.startsWith('master_fx')) return out;   // slot LFOs are track-only
    for (let i = 1; i <= 2; i++) {
        const prefix = 'lfo' + i + ':';
        if (shadow_get_param(slot, prefix + 'target') !== componentKey) continue;
        for (const k of LFO_ASSIGN_KEYS) {
            const v = shadow_get_param(slot, prefix + k);
            if (v !== null) out.push([prefix + k, v]);
        }
    }
    return out;
}

/**
 * Param values taken from a JSON state blob, or null when it is not JSON.
 *
 * The blob already carries every value the module publishes, so parsing it
 * costs ONE read where reading each param costs hundreds — 884 ms for Surge
 * XT's 302 params on device, in a single tick, which is a visible stall on the
 * first detent of a preset turn.
 *
 * It also keeps the repair this dump exists for. A module's blob is CONTENT
 * written by its own getter; the weird-dreams bug was in its parser. Taking the
 * values from the blob and writing them back one at a time bypasses the
 * parser entirely, which is exactly what corrects a module that cannot read its
 * own state.
 *
 * Value formatting mirrors schwung's own flattening of this blob
 * (remote_ui.go fetchAllParams): strings verbatim, numbers stringified,
 * booleans as 1/0, anything else skipped.
 */
function valuesFromState(raw: string | null): Record<string, string> | null {
    if (!raw || raw.charAt(0) !== '{') return null;
    let obj: Record<string, unknown>;
    try {
        obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return null;
    }
    const out: Record<string, string> = {};
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'string') out[k] = v;
        else if (typeof v === 'number') out[k] = String(v);
        else if (typeof v === 'boolean') out[k] = v ? '1' : '0';
    }
    return out;
}

export interface ModuleDump {
    params: [string, string][];
    /* How many leading entries are tier 0+1. module-apply writes those, waits
     * for the DSP to finish re-applying the preset, then writes the rest. */
    leadCount: number;
}

export function dumpModuleParams(
    slot: number, componentKey: string, stateBlob?: string | null,
): ModuleDump {
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

    const _t0 = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    /* Values come from the blob when it is JSON; a per-key read is the fallback
     * for anything it omits, and for modules whose state is not JSON. */
    const fromState = valuesFromState(stateBlob ?? null);
    const listParam = listParamOf(slot, componentKey);
    const modulated = engineDrivenKeys(slot, componentKey);
    const tiers: [string, string][][] = [[], [], []];
    const taken = new Set<string>();
    for (const cp of arr) {
        if (!restorable(cp)) continue;
        if (modulated.has(cp.key as string)) continue;
        const v = (fromState ? fromState[cp.key as string] : undefined)
            ?? shadow_get_param(slot, componentKey + ':' + cp.key);
        if (v === null || v === undefined) continue;
        taken.add(cp.key as string);
        tiers[paramTier(cp.key as string, listParam)].push([cp.key as string, v]);
    }
    /* A module can DECLARE its selector/preset param without publishing it in
     * chain_params — airwindows (the `clap` module) exposes only `param_0…5`
     * there while `plugin_index` picks which plugin those six belong to. Missing
     * it would restore six numbers into whatever plugin happened to be loaded. */
    if (listParam && !taken.has(listParam)) {
        const v = (fromState ? fromState[listParam] : undefined)
            ?? shadow_get_param(slot, componentKey + ':' + listParam);
        if (v !== null && v !== undefined) tiers[paramTier(listParam, listParam)].push([listParam, v]);
    }
    tiers[0].sort((a, b) => SELECTOR_ORDER(a[0]) - SELECTOR_ORDER(b[0]));
    const params = [...tiers[0], ...tiers[1], ...tiers[2]];
    const leadCount = tiers[0].length + tiers[1].length;
    mlog('undo: dumped ' + params.length + ' params from ' + componentKey
        + ' (' + leadCount + ' lead'
        + (modulated.size > 0 ? ', ' + modulated.size + ' engine-driven skipped' : '')
        + (fromState ? ', from state' : '')
        + ((typeof Date !== 'undefined' && Date.now) ? ', ' + (Date.now() - _t0) + ' ms' : '')
        + ')');
    return { params, leadCount };
}
