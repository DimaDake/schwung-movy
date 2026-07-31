/* The params[] half of a ui_hierarchy level. Schwung's native UI renders each
 * level as a list of every param it declares; `knobs[]` is only the ≤8 that
 * level binds to the encoders. movy renders the knobs first and then these, so
 * a module's whole list view is reachable. */
import type { RawMeta } from './param-build.js';
import type { WalkLevel } from './hierarchy-walk.js';
import { paramKeys } from './hierarchy-walk.js';

/* A numeric param the module reports as unturnable (max <= min) is a stub —
 * osirus publishes bank_index 0..0 until its ROM enumerates the banks. A knob
 * for it would be dead; the async re-resolve rebuilds the pages if the module
 * later widens the range. Enums are exempt: their range comes from the option
 * list, not min/max. */
function renderable(cp: RawMeta | undefined): boolean {
    if (!cp) return true;                    // no metadata at all → meta-infer widens it
    if (cp.type === 'enum' || (cp.options?.length ?? 0) > 0) return true;
    return !(cp.min != null && cp.max != null && cp.max <= cp.min);
}

/* Returns a picker that yields a level's params[]-only keys, in declaration
 * order. It is STATEFUL: every key it hands out is remembered, so a key belongs
 * to exactly one page — the first level that declares it. Call it once per
 * level. */
export function makeExtrasPicker(
    cpMap: Record<string, RawMeta>, knobKeysEverywhere: Iterable<string>, listParam?: string,
    /* Keys dropped for a degenerate range are collected here: on device osirus
     * widens bank_index 0..0 → 0..1 seconds after load, so the metadata retry
     * needs to know which keys are worth re-checking. */
    degenerate?: string[],
): (lvl: WalkLevel) => string[] {
    const seen = new Set<string>(knobKeysEverywhere);
    return (lvl: WalkLevel): string[] => {
        const out: string[] = [];
        for (const k of paramKeys(lvl)) {
            // `ui_*` is the module's internal UI state, not a user-facing param
            // (same exclusion the no-hierarchy chain_params fallback makes).
            if (seen.has(k) || k === listParam || k.startsWith('ui_')) continue;
            if (!renderable(cpMap[k])) { degenerate?.push(k); continue; }
            seen.add(k);
            out.push(k);
        }
        return out;
    };
}
