import type { KnobParam } from '../types/param.js';
import type { ModelState } from './state.js';
import { KNOBS_PER_PAGE } from './constants.js';
import { mlog } from '../log.js';

export function formatValue(p: KnobParam, v: number | null | undefined): string {
    if (v === null || v === undefined) return '...';
    if (p.type === 'enum') {
        if (p.options && p.options[Math.round(v)]) return p.options[Math.round(v)].substring(0, 5);
        return String(Math.round(v));
    }
    if (p.type === 'int') return String(Math.round(v));
    const range = (p.max - p.min) || 1;
    return Math.round((v - p.min) / range * 100) + '%';
}

export function applyKnobDelta(s: ModelState, physK: number, delta: number): void {
    const gi = s.knobPage * KNOBS_PER_PAGE + physK;
    const p  = s.knobParams[gi];
    if (!p) return;

    if (s.knobValues[gi] === null || s.knobValues[gi] === undefined) {
        const raw = shadow_get_param(s.activeSlot, 'synth:' + p.key);
        if (raw === null && !p.key.startsWith('test_')) return;
        const v = parseFloat(raw ?? '');
        s.knobValues[gi] = (raw === null || isNaN(v)) ? p.min : v;
    }

    let newVal = (s.knobValues[gi] as number) + delta * p.step;
    newVal = Math.max(p.min, Math.min(p.max, newVal));
    if (p.type === 'int' || p.type === 'enum') newVal = Math.round(newVal);
    s.knobValues[gi] = newVal;

    const valStr = (p.type === 'float') ? newVal.toFixed(4) : String(Math.round(newVal));
    mlog('set slot=' + s.activeSlot + ' gi=' + gi + ' key=synth:' + p.key + ' val=' + valStr);
    const ok = p.key.startsWith('test_') ? true : shadow_set_param(s.activeSlot, 'synth:' + p.key, valStr);
    mlog('set_param returned ' + ok);
    s.dirty = true;
}

export function refreshKnobValues(s: ModelState): void {
    for (let gi = 0; gi < s.knobParams.length; gi++) {
        const p = s.knobParams[gi];
        if (!p) continue;
        const raw = shadow_get_param(s.activeSlot, 'synth:' + p.key);
        if (raw !== null) {
            const v = parseFloat(raw);
            if (!isNaN(v)) s.knobValues[gi] = v;
        }
    }
}

export function pollModuleName(s: ModelState): void {
    const name = shadow_get_param(s.activeSlot, 'synth:name')
              || shadow_get_param(s.activeSlot, 'synth_module')
              || '—';
    if (name !== s.activeModuleName) {
        s.activeModuleName = name;
        s.hierarchyKey = '';
        s.dirty = true;
    }
}
