/* Dump a chain slot's params before a module swap.
 *
 * A module load is destructive: schwung tears the outgoing module down and the
 * new one comes up with defaults, so the inverse needs the old module AND
 * everything it was holding. Nothing else records that, and after the swap it
 * is gone — so the dump has to happen on the way in.
 *
 * The key list comes from `chain_params`, which is the module's own statement
 * of what it exposes. Values come from a direct read: movy's knobValues mirror
 * covers only params the hierarchy puts on a page, and a module can publish
 * more than it shows. Module swaps are rare and already slow, so a burst of
 * reads here is affordable in a way it would never be on a knob turn. */

import { mlog } from '../log.js';

/** Params a module holds that movy could not restore anyway — read-only or
 *  derived, and writing them back either fails or means nothing. */
function restorable(cp: { key?: string; type?: string; readonly?: boolean }): boolean {
    if (!cp.key) return false;
    if (cp.readonly) return false;
    /* Metadata channels, not settings: these describe the module rather than
     * configure it, and schwung republishes them on load. */
    return !/^(ui_hierarchy|chain_params|preset_names?|preset_name_\d+|preset_count|name|module)$/
        .test(cp.key);
}

export function dumpModuleParams(slot: number, componentKey: string): [string, string][] {
    if (typeof shadow_get_param !== 'function') return [];
    const raw = shadow_get_param(slot, componentKey + ':chain_params');
    if (!raw) return [];
    let arr: Array<{ key?: string; type?: string; readonly?: boolean }>;
    try {
        arr = JSON.parse(raw);
    } catch (e) {
        mlog('undo: chain_params parse failed — module undo will be partial: ' + e);
        return [];
    }
    const out: [string, string][] = [];
    for (const cp of arr) {
        if (!restorable(cp)) continue;
        const v = shadow_get_param(slot, componentKey + ':' + cp.key);
        if (v !== null) out.push([cp.key as string, v]);
    }
    mlog('undo: dumped ' + out.length + ' params from ' + componentKey);
    return out;
}
