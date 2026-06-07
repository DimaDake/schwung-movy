import type { ViewModel } from '../types/viewmodel.js';
import type { ModelState } from './state.js';
import { formatValue } from './store.js';
import { KNOBS_PER_PAGE, KNOBS_PER_ROW } from './constants.js';

export function buildViewModel(s: ModelState): ViewModel {
    const nBanks   = Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE));
    const bankName = s.moduleConfig && s.moduleConfig.banks[s.knobPage]
        ? s.moduleConfig.banks[s.knobPage].name
        : (nBanks > 1 ? 'PG' + (s.knobPage + 1) : '');

    const rows: ViewModel['rows'] = [[], []];
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < KNOBS_PER_ROW; col++) {
            const physK = row * KNOBS_PER_ROW + col;
            const gi    = s.knobPage * KNOBS_PER_PAGE + physK;
            const p     = s.knobParams[gi];
            if (!p) { rows[row].push(null); continue; }
            const v  = s.knobValues[gi];
            const nv = (p.min === p.max || v === null || v === undefined)
                ? 0
                : Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
            rows[row].push({
                shortName:       p.shortLabel || p.label.substring(0, 4).toUpperCase(),
                fullName:        p.label,
                type:            p.type,
                normalizedValue: nv,
                displayValue:    formatValue(p, v),
                touched:         (s.touchedSlot === physK),
            });
        }
    }

    let toast: ViewModel['toast'] = null;
    if (s.touchedSlot >= 0) {
        const gi = s.knobPage * KNOBS_PER_PAGE + s.touchedSlot;
        const p  = s.knobParams[gi];
        if (p) toast = { fullName: p.label, value: formatValue(p, s.knobValues[gi]) };
    }

    return {
        moduleName:  s.activeModuleName,
        bankName,
        bankIndex:   s.knobPage,
        bankCount:   nBanks,
        rows,
        touchedSlot: s.touchedSlot >= 0 ? s.touchedSlot : null,
        toast,
        overlay:     s.enumOverlay
            ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
            : null,
    };
}
