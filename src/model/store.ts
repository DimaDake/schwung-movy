import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE, ENUM_DELTA_DIV, ARC_DELTA_SCALE, REFRESH_SUPPRESS_TICKS } from './constants.js';
import { moduleReadKey } from '../chain/config.js';
import { mlog } from '../log.js';

export function formatValue(p: KnobParam, v: number | null | undefined): string {
    if (p.type === 'file') return '...';
    if (v === null || v === undefined) return '...';
    if (p.type === 'enum') {
        if (p.options && p.options[Math.round(v)]) return p.options[Math.round(v)].substring(0, 5);
        return String(Math.round(v));
    }
    if (p.type === 'int') return String(Math.round(v));
    const range = (p.max - p.min) || 1;
    return Math.round((v - p.min) / range * 100) + '%';
}

export interface KnobParamInfo {
    gi: number;
    key: string;
    target: string;      // componentKey, e.g. "synth" / "fx1"
    value: number;       // current manual value (defaults to min if unknown)
    min: number;
    max: number;
    type: string;
    automatable: boolean;
}

/* Per-knob param facts the automation layer needs. Automatable = numeric range,
 * not a file/global param (globals like g_* aren't reachable as target:param in
 * the chain's knob mapping; see the device spike). */
export function knobParamInfo(s: ModelState, physK: number): KnobParamInfo | null {
    const gi = s.knobPage * KNOBS_PER_PAGE + physK;
    const p = s.knobParams[gi];
    if (!p) return null;
    const v = s.knobValues[gi];
    const automatable = (p.type === 'float' || p.type === 'int')
        && typeof p.min === 'number' && typeof p.max === 'number' && p.max > p.min
        && !p.key.startsWith('g_');
    return {
        gi, key: p.key, target: s.componentKey,
        value: (v === null || v === undefined) ? p.min : (v as number),
        min: p.min, max: p.max, type: p.type, automatable,
    };
}

export function applyKnobDelta(s: ModelState, physK: number, delta: number): void {
    const gi = s.knobPage * KNOBS_PER_PAGE + physK;
    const p  = s.knobParams[gi];
    if (!p) return;
    if (p.type === 'file') return;

    if (s.knobValues[gi] === null || s.knobValues[gi] === undefined) {
        const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.key);
        if (raw === null && !p.key.startsWith('test_')) return;
        const v = parseFloat(raw ?? '');
        s.knobValues[gi] = (raw === null || isNaN(v)) ? p.min : v;
    }

    const arcScale = p.renderStyle === 'arc' ? ARC_DELTA_SCALE : 1;
    const scaled = p.type === 'enum' ? delta / ENUM_DELTA_DIV : delta * p.step * arcScale;
    let newVal = (s.knobValues[gi] as number) + scaled;
    newVal = Math.max(p.min, Math.min(p.max, newVal));
    if (p.type === 'int') newVal = Math.round(newVal);
    // enum: store as float for fractional accumulation; read sites use Math.round
    s.knobValues[gi] = newVal;

    const valStr = (p.type === 'float') ? newVal.toFixed(4) : String(Math.round(newVal));
    mlog('set slot=' + s.activeSlot + ' gi=' + gi + ' key=' + s.componentKey + ':' + p.key + ' val=' + valStr);
    const ok = p.key.startsWith('test_') ? true : shadow_set_param(s.activeSlot, s.componentKey + ':' + p.key, valStr);
    mlog('set_param returned ' + ok);
    s.dirty = true;
}

export function refreshOneParam(s: ModelState, tickCount: number): void {
    if (s.knobParams.length === 0) return;
    if (tickCount - s.lastDeltaTick < REFRESH_SUPPRESS_TICKS) return;

    const i = s.refreshParamCursor % s.knobParams.length;
    s.refreshParamCursor = (i + 1) % s.knobParams.length;

    const p = s.knobParams[i];
    if (!p) return;

    // Automation lanes are driven by playback; reading the synth back would
    // overwrite the UI-owned base value and repaint on every automation step.
    if (s.noRefreshKeys.has(p.key)) return;

    if (p.type === 'file') {
        const path = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.key);
        if (path !== s.fileValues[i]) {
            s.fileValues[i] = path;
            s.dirty = true;
        }
        return;
    }

    const raw = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.key);
    if (raw === null) return;
    const newVal = parseFloat(raw);
    if (!isNaN(newVal) && newVal !== s.knobValues[i]) {
        s.knobValues[i] = newVal;
        s.dirty = true;
    }
}

export function pollModuleName(s: ModelState): void {
    const name = shadow_get_param(s.activeSlot, s.componentKey + ':name')
              || shadow_get_param(s.activeSlot, moduleReadKey(s.componentKey))
              || '—';
    if (name !== s.activeModuleName) {
        s.activeModuleName = name;
        s.hierarchyKey = '';
        s.dirty = true;
    }
}
