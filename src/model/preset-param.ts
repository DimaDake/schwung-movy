import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';

/* Build the name-polled preset knob from a list/count/name param triple.
 * Names come from a bulk `preset_names` JSON array, else per-index
 * `preset_name_N`, else live polling of `nameKey`. Returns null when there's
 * no list+count or the count is empty — callers then fall back (config: a plain
 * indexed knob; generic: no preset knob). Shared by the hierarchy and config
 * paths so both render identical named presets. */
export function buildPresetParam(
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
        /* A preset rewrites the module's other params, so undoing it needs the
         * whole module back — see KnobSlot.capturesModuleState. */
        capturesModuleState: true,
        automatable: false,
    };
}
