import type { ViewModel } from '../types/viewmodel.js';
import type { ModelState } from './state.js';
import { formatValue } from './store.js';
import { KNOBS_PER_PAGE, KNOBS_PER_ROW } from './constants.js';
import { dedupShortNames } from '../renderer/shorten.js';

export function buildViewModel(s: ModelState): ViewModel {
    const nBanks = Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE));

    let bankName = '';
    if (s.bankNames.length > 1 && s.bankNames[s.knobPage]) {
        bankName = s.bankNames[s.knobPage];
    } else if (s.moduleConfig && s.moduleConfig.banks[s.knobPage]) {
        bankName = s.moduleConfig.banks[s.knobPage].name;
    } else if (nBanks > 1) {
        bankName = s.knobPage === 0 ? 'Main' : 'Page ' + s.knobPage;
    }

    const pageStart   = s.knobPage * KNOBS_PER_PAGE;
    const pageEntries = Array.from({ length: KNOBS_PER_PAGE }, (_, i) => {
        const p = s.knobParams[pageStart + i];
        return p ? { label: p.label, shortLabel: p.shortLabel ?? null } : null;
    });
    const shortNames = dedupShortNames(pageEntries, 5);

    const rows: ViewModel['rows'] = [[], []];
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < KNOBS_PER_ROW; col++) {
            const physK = row * KNOBS_PER_ROW + col;
            const gi    = pageStart + physK;
            const p     = s.knobParams[gi];
            if (!p) { rows[row].push(null); continue; }
            const v  = s.knobValues[gi];
            const nv = (p.min === p.max || v === null || v === undefined)
                ? 0
                : Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
            const enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
            const dv = p.nameKey
                ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))
                : formatValue(p, v);
            rows[row].push({
                shortName:       shortNames[physK],
                fullName:        p.label,
                type:            p.type,
                normalizedValue: nv,
                displayValue:    dv,
                touched:         s.touchedSlots.includes(physK),
                isLongEnum:      p.type === 'enum' && (p.options?.length ?? 0) > 6,
                options:         p.options,
                enumIndex:       enumIdx,
                renderStyle:     p.renderStyle,
            });
        }
    }

    const primary = s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    let toast: ViewModel['toast'] = null;
    if (primary >= 0) {
        const gi = pageStart + primary;
        const p  = s.knobParams[gi];
        if (p) {
            const tv = p.nameKey
                ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, s.knobValues[gi]))
                : formatValue(p, s.knobValues[gi]);
            toast = { fullName: p.label, value: tv };
        }
    }

    return {
        moduleName:  s.activeModuleName,
        bankName,
        bankIndex:   s.knobPage,
        bankCount:   nBanks,
        rows,
        touchedSlot: primary >= 0 ? primary : null,
        toast,
        overlay:     s.enumOverlay
            ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
            : null,
        isEmpty:     s.moduleId === '' && s.activeModuleName === '—',
    };
}
