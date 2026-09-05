/* The eight knob cells of the MIX page, built from a plain value record.
 *
 * Pure: same values in, same cells out. Kept apart from the model so the page's
 * appearance can be asserted without driving knob gestures, and so the model
 * file stays about state — the same split `lfo/cells.ts` uses. */

import type { AutomationView, ParamVM, ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from '../seq/param-vm.js';
import type { TrackKind } from '../track/ref.js';
import { volumeFrac } from './db-ladder.js';
import {
    FIELD_AT, FIELD_RANGE, formatDb, formatPan, formatSend, PAN_MAX, PAN_MIN, type MixVals,
} from './mix-io.js';

/* Pan sits on a plain linear arc: -1..+1 mapped to 0..1 of the travel, with
 * centre at half. */
function panFrac(pan: number): number {
    return (pan - PAN_MIN) / (PAN_MAX - PAN_MIN);
}

export function buildMixCells(v: MixVals, kind: TrackKind): (ParamVM | null)[] {
    const vol = cell({
        shortName: 'VOL', fullName: 'Volume', type: 'float', renderStyle: 'arc',
        displayValue: formatDb(v.gain), normalizedValue: volumeFrac(v.gain),
        automatable: kind === 'movy',
    });
    /* A schwung-hosted track renders inside the shim: movy never sees its audio,
     * and schwung has no `slot:pan`. Its fader is real — that is `slot:volume`,
     * which Move's own mixer reads — but pan and both sends are unreachable, not
     * unimplemented. A drawn knob that does nothing reads as broken, so the
     * three cells are blank and their LEDs stay dark. */
    if (kind === 'host') {
        return [vol, null, null, null, null, null, null, null];
    }
    return [
        vol,
        cell({ shortName: 'PAN', fullName: 'Pan', type: 'float', renderStyle: 'arc',
            displayValue: formatPan(v.pan), normalizedValue: panFrac(v.pan), automatable: true }),
        cell({ shortName: 'SND1', fullName: 'Send 1', type: 'float', renderStyle: 'arc',
            displayValue: formatSend(v.send[0]), normalizedValue: volumeFrac(v.send[0]),
            automatable: true }),
        cell({ shortName: 'SND2', fullName: 'Send 2', type: 'float', renderStyle: 'arc',
            displayValue: formatSend(v.send[1]), normalizedValue: volumeFrac(v.send[1]),
            automatable: true }),
        null, null, null, null,
    ];
}

export interface MixPageState {
    vals: MixVals;
    kind: TrackKind;
    /** Knob touch order; the last entry owns the header toast. */
    touched: number[];
    /** Lanes, locks and live turns. Absent on a page built for a test. */
    auto?: AutomationView;
}

/* Show what the AUTOMATION is doing, not the base value — the same treatment a
 * module's page gets. Without it a send can be automated and the page says
 * nothing about it: no lane marker, no locked value on a held step, no arc
 * following a live take. "Automatable" and "usable" are not the same claim. */
function decorate(cells: (ParamVM | null)[], v: MixVals, auto: AutomationView): void {
    for (let k = 0; k < cells.length; k++) {
        const cell = cells[k];
        const field = FIELD_AT[k];
        if (!cell || field === undefined) continue;
        const lane = auto.laneForKey(field);
        if (lane < 0) continue;
        cell.assigned = true;
        cell.automated = (auto.activeLanes & (1 << lane)) !== 0;
        const held = auto.held && auto.heldValues.has(lane);
        const live = !auto.held && auto.liveValues.has(lane);
        if (!held && !live) continue;
        const raw = (held ? auto.heldValues.get(lane) : auto.liveValues.get(lane)) as number;
        const r = FIELD_RANGE[field];
        const value = r.min + (raw / 127) * (r.max - r.min);
        cell.touched = true;
        cell.displayValue = field === 'pan' ? formatPan(value)
                          : field === 'gain' ? formatDb(value) : formatSend(value);
        cell.normalizedValue = field === 'pan' ? panFrac(value) : volumeFrac(value);
    }
    void v;
}

/** The whole page as a ViewModel, so the existing chain/knob renderers and the
 *  router plumbing drive it exactly like a module's page. */
export function buildMixVM(st: MixPageState): ViewModel {
    const cells = buildMixCells(st.vals, st.kind);
    if (st.auto) decorate(cells, st.vals, st.auto);
    const primary = st.touched.length > 0 ? st.touched[st.touched.length - 1] : -1;
    const primaryCell = primary >= 0 && primary < 8 ? cells[primary] : null;
    let toast: ViewModel['toast'] = null;
    if (primaryCell) {
        primaryCell.touched = true;
        toast = { fullName: primaryCell.fullName, value: primaryCell.displayValue, browseHint: false };
    }
    return {
        moduleName: 'MIX',
        bankName: '',
        bankIndex: 0,
        bankCount: 1,
        rows: [cells.slice(0, 4), cells.slice(4, 8)],
        touchedSlot: primaryCell ? primary : null,
        toast,
        overlay: null,
        isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, drumPadName: '', isPadScoped: false,
        /* Unlike the LFO page these params ARE automatable, so the held-step
         * dimming and the pool-full toast have to work here. */
        automationHeld: st.auto?.held ?? false,
        automationPoolFull: st.auto?.poolFull ?? false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
