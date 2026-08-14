/* Config path of loadHierarchy: a movy ModuleConfig (src/modules/*.json) owns
 * the page layout, so the module's own ui_hierarchy is consulted only for
 * metadata gaps. Split out of hierarchy.ts to keep both paths readable. */
import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { mlog } from '../log.js';
import { KNOBS_PER_PAGE } from './constants.js';
import { buildPresetParam } from './preset-param.js';
import type { RawMeta } from './param-build.js';
import { inferBehavior, inferAcceleration, parseFilter } from './param-build.js';
import { cellStyleFor } from './step-labels.js';

interface CfgLevel { count_param?: string; name_param?: string }

export function buildConfigPages(
    s: ModelState,
    cpMap: Record<string, RawMeta>,
    paramDefs: Record<string, RawMeta>,
    allLevels: Record<string, CfgLevel>,
): void {
    // Root level of the runtime hierarchy supplies preset count/name param
    // keys for `render: 'preset'` slots (no per-module hardcoding).
    const cfgRoot = allLevels['root'] || Object.values(allLevels)[0] || null;
    const cfg = s.moduleConfig!;
    for (const bank of cfg.banks) {
        const bankStart = s.knobParams.length;
        for (const row of bank.rows) {
            for (const slot of row) {
                if (!slot?.key) { s.knobParams.push(null); continue; }
                /* Named preset knob: reuse the generic name-polling builder,
                 * pulling count/name keys from the hierarchy root unless the
                 * slot overrides them. Falls through to a plain knob when no
                 * preset list is resolvable (indexed value shown). */
                if (slot.render === 'preset') {
                    const pp = buildPresetParam(
                        s, slot.key,
                        slot.presetCountKey ?? cfgRoot?.count_param,
                        slot.presetNameKey  ?? cfgRoot?.name_param,
                    );
                    if (pp) {
                        if (slot.short) pp.shortLabel = slot.short;
                        if (slot.full)  pp.label      = slot.full;
                        s.knobParams.push(pp);
                        continue;
                    }
                }
                const cp   = cpMap[slot.key]   ?? {};
                const hier = paramDefs[slot.key] ?? {};
                // Precedence is split by what the field means, not by param kind:
                //
                //  - Presentation (type, options): CONFIG-FIRST (slot -> hier -> cp).
                //    The UI config declares how a param is shown — file/enum types
                //    and option lists the DSP doesn't report. This is what makes the
                //    mrdrums Sample/Preset slots render as a file browser: the module
                //    reports pad_sample_path as a plain value, so if `type` were
                //    module-first it would never become 'file' and the browse block
                //    below (and its filter/start dir) would never run — the browser
                //    then lists everything and crashes mrdrums on load.
                //
                //  - Range (min, max): MODULE-FIRST (cp -> hier -> slot). The DSP owns
                //    real ranges (weird-dreams cutoff 20..18000); a config value only
                //    fills a gap the module leaves. INVARIANT: config min/max must
                //    match or fill gaps in the DSP — it can NOT intentionally narrow a
                //    range the DSP reports (that value is ignored). A UI-only tighter
                //    cap would need a separate displayMin/Max field, not min/max.
                //
                // `step` participates only weakly: applyKnobDelta (store.ts) recomputes
                // the per-detent step from the range for floats (sensitivity is
                // normalized to ~1% of range) and uses this value only as an int floor
                // or the max<=min fallback — so its source rarely changes knob feel.
                // Resolve through string: KnobSlot.type is a required literal
                // union that would otherwise mask the hier/cp fallback and the
                // 'filepath' compare. A module reporting 'filepath' is normalized
                // to movy's 'file' render type.
                const rawType = (slot.type || hier.type || cp.type || 'float') as string;
                let type = (rawType === 'filepath' ? 'file' : rawType) as KnobParam['type'];
                const options = slot.options ?? hier.options ?? cp.options ?? null;
                let min  = cp.min  != null ? cp.min  : (hier.min  != null ? hier.min  : (slot.min  != null ? slot.min  : 0));
                let max  = cp.max  != null ? cp.max  : (hier.max  != null ? hier.max  : (slot.max  != null ? slot.max  : 1));
                let step = cp.step != null ? cp.step : (hier.step != null ? hier.step : (slot.step != null ? slot.step : (type === 'float' ? 0.01 : 1)));
                if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                const style = slot.render
                    ? { renderStyle: slot.render }
                    : cellStyleFor(slot.key, type as KnobParam['type'], min, max);
                const behavior = inferBehavior(slot.behavior ?? hier.behavior ?? cp.behavior, options);
                const param: KnobParam = {
                    key:        slot.key,
                    label:      slot.full || cp.name || hier.label || slot.key,
                    shortLabel: slot.short ?? null,
                    type:       type as KnobParam['type'],
                    options, min, max, step, ...style,
                    env:        slot.env,
                    lfo:        slot.lfo,
                    filter:     slot.filter,
                    // Global-bank params aren't reachable as chain target:params
                    // (device spike), so they can't be automated. Only OUR config
                    // may override per slot (it knows which per-voice keys the host
                    // resolves); module-supplied metadata must stay subordinate to
                    // the guard or a module re-enables a dot the host can't honour.
                    automatable: behavior === 'trigger' ? false
                        : slot.automatable ?? (bank.global ? false
                            : (cp.automatable ?? hier.automatable ??
                                ((type === 'float' || type === 'int') && max > min))),
                    behavior,
                    knobAcceleration: inferAcceleration(
                        slot.knobAcceleration ?? cp.knob_acceleration ?? cp.knobAcceleration ??
                        hier.knob_acceleration ?? hier.knobAcceleration,
                    ),
                    /* A preset always rewrites the module's other params, so it
                     * implies the flag; anything else has to say so. */
                    capturesModuleState: slot.capturesModuleState ?? (style.renderStyle === 'preset'),
                    /* Module-declared, never config-declared: the template names
                     * layout, the module names which file a marker indexes. */
                    ...(cp.filepath_param ? { filepathParam: String(cp.filepath_param) } : {}),
                    ...(cp.view_group ? { viewGroup: String(cp.view_group) } : {}),
                };
                /* File slots carry browse metadata. The module config (mrdrums.json)
                 * is authoritative; chain_params (root/filter/start_path) is the
                 * device fallback. Without this the browser loses its filter and
                 * start dir — it then lists every folder/non-preset and crashes
                 * mrdrums on load. */
                if (type === 'file') {
                    param.fileRoot      = slot.fileRoot      ?? (cp as { root?: string }).root      ?? '/data/UserData';
                    param.fileFilter    = slot.fileFilter    ?? parseFilter((cp as { filter?: unknown }).filter);
                    param.fileStartPath = slot.fileStartPath ?? (cp as { start_path?: string }).start_path ?? param.fileRoot;
                    if (slot.fileRequireContains) param.fileRequireContains = slot.fileRequireContains;
                }
                s.knobParams.push(param);
            }
        }
        /* Each bank owns exactly one knob page: pages are fixed
         * knobPage*KNOBS_PER_PAGE slices and the bank name is looked up by
         * knobPage, so a bank with a partial/single row must pad to a full
         * page or every later bank's name desyncs from its params. */
        const rem = (s.knobParams.length - bankStart) % KNOBS_PER_PAGE;
        if (rem !== 0) for (let i = rem; i < KNOBS_PER_PAGE; i++) s.knobParams.push(null);
    }
    mlog('loadHierarchy: config for ' + s.moduleId + ', ' + cfg.banks.length + ' banks');
    // Each config bank is exactly one page, so a group per bank.
    s.bankGroups = cfg.banks.map((_, i) => i);
    s.knobValues = new Array(s.knobParams.length).fill(null) as (number | null)[];
    s.enumFmt    = new Array(s.knobParams.length).fill(undefined) as (boolean | undefined)[];
    s.fileValues = new Array(s.knobParams.length).fill(null) as (string | null)[];
    s.dirty = true;
    return;
}
