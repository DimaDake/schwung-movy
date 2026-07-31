/* The params[] half of a ui_hierarchy level. Schwung's native UI renders each
 * level as a list of every param it declares; `knobs[]` is only the ≤8 that
 * level binds to the encoders. movy renders the knobs first and then these, so
 * a module's whole list view is reachable. */
import type { RawMeta } from './param-build.js';
import type { WalkLevel } from './hierarchy-walk.js';
import { paramKeys } from './hierarchy-walk.js';

/* Types movy has a control for. A module may publish others for its own web UI
 * — pushnpull's `view` is a `canvas` (a drawing surface), granny's
 * `sample_name` a `string` — and those have no knob semantics at all: on an
 * encoder they show a meaningless 0..1 arc and write nonsense to the DSP. A
 * MISSING type is fine: that is the metaGuessed path, which infers a numeric
 * range from the first value read. */
const KNOB_TYPES = ['int', 'float', 'enum', 'filepath'];

type Verdict = 'render' | 'skip' | 'wait';

/* `wait` = a numeric the module currently reports as unturnable (max <= min).
 * That is a stub, not a permanent fact: osirus publishes bank_index 0..0 until
 * its ROM enumerates the banks, then 0..1 (device-measured). A knob for it
 * would be dead now, so it is held back and re-checked by meta-retry.ts.
 * Enums are exempt — their range comes from the option list, not min/max. */
function verdict(cp: RawMeta | undefined): Verdict {
    if (!cp) return 'render';
    if (cp.type != null && KNOB_TYPES.indexOf(cp.type) < 0) return 'skip';
    if (cp.type === 'enum' || (cp.options?.length ?? 0) > 0) return 'render';
    return (cp.min != null && cp.max != null && cp.max <= cp.min) ? 'wait' : 'render';
}

/* Returns a picker that yields a level's params[]-only keys, in declaration
 * order. It is STATEFUL: every key it hands out is remembered, so a key belongs
 * to exactly one page — the first level that declares it. Call it once per
 * level. */
export function makeExtrasPicker(
    cpMap: Record<string, RawMeta>, knobKeysEverywhere: Iterable<string>, listParam?: string,
    /* Keys held back for a not-yet-real range land here, for meta-retry.ts to
     * re-check. Keys skipped for their TYPE deliberately do not: no amount of
     * waiting turns a canvas into a knob. */
    waiting?: string[],
): (lvl: WalkLevel) => string[] {
    const seen = new Set<string>(knobKeysEverywhere);
    return (lvl: WalkLevel): string[] => {
        const out: string[] = [];
        for (const k of paramKeys(lvl)) {
            // `ui_*` is the module's internal UI state, not a user-facing param
            // (same exclusion the no-hierarchy chain_params fallback makes).
            if (seen.has(k) || k === listParam || k.startsWith('ui_')) continue;
            const v = verdict(cpMap[k]);
            if (v === 'skip') continue;
            if (v === 'wait') { waiting?.push(k); continue; }
            seen.add(k);
            out.push(k);
        }
        return out;
    };
}
