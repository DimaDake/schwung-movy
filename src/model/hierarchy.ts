import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { loadModuleConfig } from '../modules/loader.js';
import { mlog } from '../log.js';

export function loadHierarchy(s: ModelState): void {
    s.knobParams   = [];
    s.knobValues   = [];
    s.moduleConfig = null;
    s.hierarchyKey = s.activeModuleName;

    mlog('loadHierarchy: slot=' + s.activeSlot + ' module=' + s.activeModuleName);
    s.moduleId = shadow_get_param(s.activeSlot, 'synth_module') || '';

    const cpMap: Record<string, { key?: string; type?: string; min?: number; max?: number; step?: number; options?: string[]; name?: string }> = {};
    const chainParamsRaw = shadow_get_param(s.activeSlot, 'synth:chain_params');
    if (chainParamsRaw) {
        try {
            const arr = JSON.parse(chainParamsRaw) as Array<{ key?: string }>;
            for (const cp of arr) { if (cp.key) cpMap[cp.key] = cp; }
            mlog('loadHierarchy: chain_params ' + arr.length + ' entries');
        } catch (e) { mlog('chain_params parse error: ' + e); }
    }

    const raw = shadow_get_param(s.activeSlot, 'synth:ui_hierarchy');
    if (!raw) {
        mlog('loadHierarchy: ui_hierarchy null — using test params');
        s.knobParams = [
            { key: 'test_a', label: 'TestA', shortLabel: null, type: 'float', min: 0, max: 1,   step: 0.02, options: null },
            { key: 'test_b', label: 'TestB', shortLabel: null, type: 'int',   min: 0, max: 127, step: 1,    options: null },
        ];
        s.knobValues = [0.5, 64];
        s.dirty = true;
        return;
    }

    /* Parse ui_hierarchy for label/type fallbacks */
    const paramDefs: Record<string, { key?: string; type?: string; min?: number; max?: number; step?: number; options?: string[]; label?: string }> = {};
    try {
        const hier = JSON.parse(raw) as { levels?: Record<string, { params?: Array<{ key?: string }> }> };
        if (hier.levels) {
            for (const lvl of Object.values(hier.levels)) {
                if (!lvl.params) continue;
                for (const p of lvl.params) { if (p?.key) paramDefs[p.key] = p; }
            }
        }
    } catch (e) { mlog('ui_hierarchy parse error: ' + e); }

    s.moduleConfig = loadModuleConfig(s.moduleId);

    if (s.moduleConfig) {
        for (const bank of s.moduleConfig.banks) {
            for (const row of bank.rows) {
                for (const slot of row) {
                    if (!slot?.key) { s.knobParams.push(null); continue; }
                    const cp   = cpMap[slot.key]   ?? {};
                    const hier = paramDefs[slot.key] ?? {};
                    const type = slot.type || cp.type || hier.type || 'float';
                    const options = cp.options ?? hier.options ?? null;
                    let min  = cp.min  != null ? cp.min  : (hier.min  != null ? hier.min  : 0);
                    let max  = cp.max  != null ? cp.max  : (hier.max  != null ? hier.max  : 1);
                    let step = cp.step != null ? cp.step : (hier.step != null ? hier.step : (type === 'float' ? 0.01 : 1));
                    if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                    s.knobParams.push({
                        key:        slot.key,
                        label:      slot.full || cp.name || hier.label || slot.key,
                        shortLabel: slot.short ?? null,
                        type: type as KnobParam['type'],
                        options, min, max, step,
                    });
                }
            }
        }
        mlog('loadHierarchy: config loaded for ' + s.moduleId + ', ' + s.moduleConfig.banks.length + ' banks');
    } else {
        let rootLevel: { knobs?: unknown[]; params?: unknown[] } | null = null;
        try {
            const hier = JSON.parse(raw) as { levels?: Record<string, { knobs?: unknown[]; params?: unknown[] }> };
            rootLevel = hier.levels && (hier.levels['root'] || Object.values(hier.levels)[0]) || null;
        } catch {}

        if (rootLevel) {
            const knobSources = rootLevel.knobs || rootLevel.params || [];
            for (const knob of knobSources) {
                const key   = typeof knob === 'string' ? knob : (knob as { key?: string }).key;
                const label = typeof knob === 'string' ? knob : ((knob as { label?: string }).label || key);
                if (!key) continue;
                const def     = (typeof knob === 'object' && (knob as { type?: string }).type) ? knob as typeof paramDefs[string] : (paramDefs[key] ?? {});
                const cp      = cpMap[key] ?? {};
                const type    = def.type || cp.type || 'float';
                const options = cp.options ?? def.options ?? null;
                let min  = cp.min  != null ? cp.min  : (def.min  != null ? def.min  : 0);
                let max  = cp.max  != null ? cp.max  : (def.max  != null ? def.max  : 1);
                let step = cp.step != null ? cp.step : (def.step != null ? def.step : (type === 'float' ? 0.02 : 1));
                if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                s.knobParams.push({ key, label: def.label || (label as string), shortLabel: null, type: type as KnobParam['type'], options, min, max, step });
            }
        }
    }

    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    mlog('loadHierarchy: ' + s.knobParams.filter(Boolean).length + ' params loaded');
    s.dirty = true;
}
