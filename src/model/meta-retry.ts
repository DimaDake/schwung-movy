/* Some modules publish their preset list and enum option sets AFTER load —
 * osirus scans its ROM asynchronously, reporting preset_count 0 and
 * rom_index ["(loading)"] until it finishes. loadHierarchy reads both once, so
 * without this the Preset knob is dropped forever and the enum shows the
 * placeholder for the life of the session. */
import type { ModelState } from './state.js';
import { META_RETRY_LIMIT } from './constants.js';
import { mlog } from '../log.js';

/* A not-yet-ready module publishes a single parenthesised option — "(loading)",
 * "(scanning)". A real one-option enum is vanishingly rare and would cost only
 * one wasted probe. */
export function isPlaceholderOptions(options: string[] | null | undefined): boolean {
    return !!options && options.length === 1 && /^\(.*\)$/.test(String(options[0]).trim());
}

function presetPending(s: ModelState): boolean {
    return s.presetDeclared && !s.knobParams.some(p => p?.renderStyle === 'preset');
}

function placeholderEnum(s: ModelState): boolean {
    return s.knobParams.some(p => p?.type === 'enum' && isPlaceholderOptions(p.options));
}

/* One probe per call, driven by the existing name-poll cadence. Returns true
 * when it spent this tick's IPC on a probe, so the caller can skip its own read
 * and keep the tick within the budget perf.mjs enforces. */
export function retryUnsettledMeta(s: ModelState): boolean {
    if (s.metaRetries >= META_RETRY_LIMIT) return false;
    const wantPreset = presetPending(s);
    if (!wantPreset && !placeholderEnum(s) && s.degenerateKeys.length === 0) {
        s.metaRetries = META_RETRY_LIMIT;    // settled — latch off for this module
        return false;
    }
    s.metaRetries++;

    if (wantPreset) {
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':preset_count');
        if (raw && parseInt(raw) > 0) {
            mlog('meta-retry: preset list settled (' + raw + ')');
            s.hierarchyKey = '';             // processTick rebuilds on the next tick
        }
        return true;
    }

    /* Enum options live in the chain_params blob, so settling is detected by
     * re-reading it and looking for a placeholder that has become a real list. */
    const raw = shadow_get_param(s.activeSlot, s.componentKey + ':chain_params');
    if (raw) {
        try {
            const arr = JSON.parse(raw) as Array<{ key?: string; options?: string[]; min?: number; max?: number }>;
            const enumSettled = arr.some(cp => cp.key
                && s.knobParams.some(p => !!p && p.key === cp.key && isPlaceholderOptions(p.options))
                && !isPlaceholderOptions(cp.options));
            /* A key we dropped as unturnable may have gained a real range —
             * osirus's bank_index goes 0..0 → 0..1 once its ROM lists the banks
             * (device-measured, scripts/probe-async-meta.mjs). */
            const rangeSettled = arr.some(cp => cp.key != null
                && s.degenerateKeys.indexOf(cp.key) >= 0
                && cp.min != null && cp.max != null && cp.max > cp.min);
            if (enumSettled || rangeSettled) {
                mlog('meta-retry: ' + (enumSettled ? 'enum options' : 'param range') + ' settled');
                s.hierarchyKey = '';
            }
        } catch { /* a malformed republish is just another unsettled poll */ }
    }
    return true;
}
