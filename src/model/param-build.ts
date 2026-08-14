/* Param metadata → KnobParam. Split out of hierarchy.ts, which owns the page
 * structure; this file owns what a single knob looks like once its metadata has
 * been gathered from chain_params and/or ui_hierarchy. */
import type { KnobParam } from '../types/param.js';
import { isFaderParam } from './fader.js';
import { isActionParam, isToggleParam } from './toggle.js';
import { cellStyleFor } from './step-labels.js';

/* One param's metadata as published by a module — either a chain_params entry
 * or a ui_hierarchy params[]/knobs[] entry. Both shapes are partial and the
 * fields overlap, so one permissive interface serves both. */
export interface RawMeta {
    key?: string; label?: string; name?: string; level?: string;
    type?: string; min?: number; max?: number; step?: number; options?: string[];
    automatable?: boolean; behavior?: string;
    knob_acceleration?: string; knobAcceleration?: string;
    root?: string; filter?: unknown; start_path?: string;
    filepath_param?: string;   // wav_position → the file param it indexes
    ui_type?: string;          // render type when it differs from the data type
    view_group?: string;       // markers sharing a group draw on one graphic
    visible_if?: unknown;      // { param, equals } — see visible-if.ts
}

export function inferBehavior(explicit: unknown, options: string[] | null): KnobParam['behavior'] | undefined {
    if (explicit === 'trigger') return 'trigger';
    const normalized = (options ?? []).map(v => String(v).trim().toLowerCase());
    return normalized.includes('idle') && normalized.includes('trigger') ? 'trigger' : undefined;
}

export function inferAcceleration(value: unknown): KnobParam['knobAcceleration'] | undefined {
    return value === 'wide' ? 'wide' : undefined;
}

export function parseFilter(filter: unknown): string[] {
    if (!filter) return [];
    const vals = Array.isArray(filter) ? filter as unknown[] : [filter];
    return (vals as string[])
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map(v => v.toLowerCase().startsWith('.') ? v.toLowerCase() : '.' + v.toLowerCase());
}

/* Generic (no movy config) path: chain_params metadata `cp` wins over the
 * hierarchy's own `def`, which wins over movy's guesses. */
export function buildGenericParam(key: string, cp: RawMeta, def: RawMeta): KnobParam {
    const rawUiType = cp.ui_type || def.ui_type || '';
    /* `wav_position` is a float with a picture attached. Carrying it as a TYPE
     * meant every `type === 'float'` branch skipped it — including the one that
     * encodes the value for writing, which rounded it to an integer. */
    const declared = cp.type || def.type || 'float';
    const uiType = rawUiType || (declared === 'wav_position' ? 'wav_position' : '');
    const type = declared === 'wav_position' ? 'float' : declared;
    if (type === 'filepath') {
        return {
            key,
            label:      String(cp.name ?? def.label ?? key),
            shortLabel: null,
            type:       'file',
            min: 0, max: 0, step: 0,
            options:    null,
            renderStyle: 'arc',
            automatable: false,
            fileRoot:      String(cp.root ?? '/data/UserData'),
            fileFilter:    parseFilter(cp.filter),
            fileStartPath: String(cp.start_path ?? cp.root ?? '/data/UserData'),
        };
    }
    const options  = cp.options ?? def.options ?? null;
    const hasRange = cp.min != null || cp.max != null || def.min != null || def.max != null;
    let min  = cp.min  != null ? cp.min  : (def.min  != null ? def.min  : 0);
    let max  = cp.max  != null ? cp.max  : (def.max  != null ? def.max  : 1);
    let step = cp.step != null ? cp.step : (def.step != null ? def.step : (type === 'float' ? 0.02 : 1));
    if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
    // C4: no metadata anywhere → movy guessed float 0..1 (numeric types
    // only). Flag it so the first value read can infer the real int type
    // and widen the range (see meta-infer.ts / store.ts).
    const metaGuessed = !hasRange && (type === 'float' || type === 'int');
    const behavior = inferBehavior(cp.behavior ?? def.behavior, options);
    return {
        key,
        label:      cp.name || def.label || key,
        shortLabel: null,
        type:       type as KnobParam['type'],
        options, min, max, step,
        ...cellStyleFor(key, type as KnobParam['type'], min, max),
        // Config-less fallback: the `g_` global-naming convention is the
        // only signal available here. Modules with a movy config use
        // bank.global instead (see the config path in hierarchy.ts).
        automatable: behavior === 'trigger' ? false : (cp.automatable ?? def.automatable ??
            ((type === 'float' || type === 'int') && max > min && !key.startsWith('g_'))),
        behavior,
        knobAcceleration: inferAcceleration(
            cp.knob_acceleration ?? cp.knobAcceleration ??
            def.knob_acceleration ?? def.knobAcceleration,
        ),
        ...(uiType ? { uiType } : {}),
        ...(cp.view_group || def.view_group
            ? { viewGroup: String(cp.view_group ?? def.view_group) } : {}),
        ...(cp.filepath_param || def.filepath_param
            ? { filepathParam: String(cp.filepath_param ?? def.filepath_param) } : {}),
        ...(metaGuessed ? { metaGuessed: true } : {}),
    };
}

/* The name-driven cell styles, applied AFTER the param is built so each rule
 * can read the RESOLVED label and options — which is where half the naming
 * lives. Shared by the generic and config paths so the two cannot drift.
 *
 * `explicitRender` means a hand-written config named the style itself; a
 * template that states its layout outranks anything inferred here. */
export function applyAutoStyle(p: KnobParam, explicitRender = false): KnobParam {
    /* Before the switch: an action is boolean-shaped, and drawing it as one
     * would leave it stuck on after a single use. */
    if (!p.behavior && isActionParam(p)) {
        p.behavior = 'trigger';
        p.automatable = false;
        return p;
    }
    if (explicitRender) return p;
    if (isToggleParam(p)) { p.renderStyle = 'switch'; return p; }
    if (p.renderStyle === 'arc' && isFaderParam(p)) p.renderStyle = 'vbar';
    return p;
}
