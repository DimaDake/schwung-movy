import type { ViewModel, AutomationView, EnvelopeVM, LfoVizVM } from '../types/viewmodel.js';
import type { ModelState } from './state.js';
import { formatValue, paramIoKey } from './store.js';
import { planPageLayout } from './envelope.js';
import { buildLfoViz } from './lfo-vm.js';
import { KNOBS_PER_PAGE, KNOBS_PER_ROW } from './constants.js';
import { dedupShortNames } from '../renderer/shorten.js';
import { basename } from './path.js';

/* No-automation default so callers that don't care (browser tests, non-seq
 * views) need not build a snapshot. */
const NO_AUTOMATION: AutomationView = {
    assignedLanes: 0, activeLanes: 0, held: false, poolFull: false,
    heldValues: new Map(), liveValues: new Map(), laneForKey: () => -1,
};

export function buildViewModel(s: ModelState, auto: AutomationView = NO_AUTOMATION): ViewModel {
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

    const layout = planPageLayout(s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE));
    const rows: ViewModel['rows'] = [[null, null, null, null], [null, null, null, null]];
    const envelopeLines: (EnvelopeVM | null)[] = [null, null];
    for (const e of layout.envelopes)
        envelopeLines[e.line] = { name: e.name, startCol: e.startCol, cellCount: e.cellCount, roles: e.roles.join('') };

    // LFO modulation marks — read from the cached target set (refreshed on the
    // poll cadence in processTick), so this does no per-render IPC.
    const isModulated = (p: import('../types/param.js').KnobParam): boolean =>
        s.modulatedKeys.size > 0 && s.modulatedKeys.has(paramIoKey(s, p));

    for (const cell of layout.cells) {
        const localIdx   = cell.idx;                          // page-relative param index
        const screenSlot = cell.line * KNOBS_PER_ROW + cell.col;  // physical knob position
        const gi    = pageStart + localIdx;
        const p     = s.knobParams[gi];
        if (!p) continue;
        const v  = s.knobValues[gi];
        const renorm = (val: number) => (p.min === p.max)
            ? 0 : Math.max(0, Math.min(1, (val - p.min) / (p.max - p.min)));
        const nv = (v === null || v === undefined) ? 0 : renorm(v);
        const enumIdx = (p.type === 'enum' && typeof v === 'number') ? Math.round(v) : 0;
        const dv = p.type === 'file'
            ? (s.fileValues[gi] ? basename(s.fileValues[gi] as string) : '—')
            : p.nameKey
                ? (shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))
                : formatValue(p, v);
        const lane = auto.laneForKey(p.key);
        const automated = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
        // An automation edit drives BOTH the value text (inverted, like a knob
        // touch) and the arc/envelope position, so editing automation looks like
        // normal value editing — without touching the base value. Held step:
        // show that step's locked value. Live record: follow the knob while it's
        // being turned (cleared on release → snaps to base).
        let touched = s.touchedSlots.includes(screenSlot);
        let displayValue = dv;
        let arcValue = nv;
        if (auto.held && lane >= 0 && auto.heldValues.has(lane)) {
            const hv = auto.heldValues.get(lane) as number;
            touched = true; displayValue = formatValue(p, hv); arcValue = renorm(hv);
        } else if (!auto.held && lane >= 0 && auto.liveValues.has(lane)) {
            const lv = auto.liveValues.get(lane) as number;
            touched = true; displayValue = formatValue(p, lv); arcValue = renorm(lv);
        }
        rows[cell.line][cell.col] = {
            shortName:       shortNames[localIdx],
            fullName:        p.label,
            type:            p.type,
            normalizedValue: arcValue,
            displayValue,
            touched,
            isLongEnum:      p.type === 'enum' && (p.options?.length ?? 0) > 6,
            options:         p.options,
            enumIndex:       enumIdx,
            renderStyle:     p.renderStyle,
            automated,
            automatable:     p.automatable,
            assigned:        lane >= 0,
            modulated:       isModulated(p),
        };
    }

    // LFO waveform groups: Shape + adjacent span partner render as one graphic
    // (see model/lfo-vm.ts). Values read off the page live.
    const pageParams = s.knobParams.slice(pageStart, pageStart + KNOBS_PER_PAGE);
    const pageValues = s.knobValues.slice(pageStart, pageStart + KNOBS_PER_PAGE);
    const lfoViz = buildLfoViz(pageParams, pageValues, layout.cells);

    // Toast follows the physical knob last touched → its displayed param (the
    // rearrange means screen slot ≠ page index).
    const slotMap = new Array(KNOBS_PER_PAGE).fill(-1);
    for (const c of layout.cells) slotMap[c.line * KNOBS_PER_ROW + c.col] = c.idx;
    const primary = s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    let toast: ViewModel['toast'] = null;
    if (primary >= 0 && slotMap[primary] >= 0) {
        const gi = pageStart + slotMap[primary];
        const p  = s.knobParams[gi];
        if (p) {
            let tv: string;
            if (p.type === 'file') {
                tv = s.fileValues[gi] ? basename(s.fileValues[gi] as string) : '—';
            } else if (p.nameKey) {
                tv = shadow_get_param(s.activeSlot, s.componentKey + ':' + p.nameKey) ?? formatValue(p, s.knobValues[gi]);
            } else {
                tv = formatValue(p, s.knobValues[gi]);
            }
            toast = { fullName: p.label, value: tv, browseHint: p.type === 'file' };
        }
    }

    return {
        moduleName:     s.activeModuleName,
        bankName,
        bankIndex:      s.knobPage,
        bankCount:      nBanks,
        rows,
        envelopeLines,
        touchedSlot:    primary >= 0 ? primary : null,
        toast,
        overlay: s.enumOverlay
            ? { slot: s.enumOverlay.slot, options: s.enumOverlay.options, selected: s.enumOverlay.selected }
            : s.fileOverlay
            ? { slot: s.fileOverlay.slot, options: s.fileOverlay.items.map(p => basename(p).slice(0, 12)), selected: s.fileOverlay.selected }
            : null,
        isEmpty:        s.moduleId === '' && s.activeModuleName === '—',
        drumPadCount:       s.drumPadCount,
        drumCurrentPad:     s.drumCurrentPad,
        drumCurrentPhysPad: s.drumCurrentPhysPad,
        isPadSpecific:      (s.moduleConfig?.banks[s.knobPage]?.padSpecific) ?? false,
        automationHeld:     auto.held,
        automationPoolFull: auto.poolFull,
        stepPagePresent:    false,
        stepPageSelected:   false,
        lfoViz:             lfoViz.length ? lfoViz : undefined,
    };
}
