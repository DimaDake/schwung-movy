/* The eight knob cells of the MIX page, built from a plain value record.
 *
 * Pure: same values in, same cells out. Kept apart from the model so the page's
 * appearance can be asserted without driving knob gestures, and so the model
 * file stays about state — the same split `lfo/cells.ts` uses. */

import type { AutomationView, ParamVM, ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from '../seq/param-vm.js';
import type { TrackKind } from '../track/ref.js';
import { sendFrac, volumeFrac } from './db-ladder.js';
import {
    FIELD_AT, fieldFromFrac, sendField, formatDb, formatPan, formatSend,
    PAN_MAX, PAN_MIN, type MixVals,
} from './mix-io.js';
import { SEND_BUSES } from '../chain/config.js';

/* Pan maps linearly onto the bipolar bar's travel: -1..+1 becomes 0..1, so
 * centre lands at half — which is where the widget puts its detent. */
function panFrac(pan: number): number {
    return (pan - PAN_MIN) / (PAN_MAX - PAN_MIN);
}

export function buildMixCells(v: MixVals, kind: TrackKind): (ParamVM | null)[] {
    /* A fader, not an arc: this is a channel level, and the widget already
     * exists as the vertical partner of the pan dial's horizontal bar. */
    const vol = cell({
        shortName: 'VOL', fullName: 'Volume', type: 'float', renderStyle: 'vbar',
        displayValue: formatDb(v.gain), normalizedValue: volumeFrac(v.gain),
        automatable: kind === 'movy',
    });
    /* A schwung-hosted track renders inside the shim: movy never sees its audio,
     * and schwung has no `slot:pan`. Its fader is real — that is `slot:volume`,
     * which Move's own mixer reads — but pan and every send are unreachable, not
     * unimplemented. A drawn knob that does nothing reads as broken, so the
     * other cells are blank and their LEDs stay dark. */
    if (kind === 'host') {
        return [vol, null, null, null, null, null, null, null];
    }
    const cells: (ParamVM | null)[] = [
        vol,
        cell({ shortName: 'PAN', fullName: 'Pan', type: 'float', renderStyle: 'pan',
            displayValue: formatPan(v.pan), normalizedValue: panFrac(v.pan), automatable: true }),
        null, null, null, null, null, null,
    ];
    /* The sends land where FIELD_AT puts them — line 2, encoders 5-7 — rather
     * than at a written-out index, so the page and the knob routing cannot
     * disagree about which encoder a send is under. */
    for (let bus = 0; bus < SEND_BUSES; bus++) {
        const level = v.send[bus] ?? 0;
        cells[FIELD_AT.indexOf(sendField(bus))] = cell({
            shortName: 'SND' + (bus + 1), fullName: 'Send ' + (bus + 1),
            type: 'float', renderStyle: 'arc',
            /* A send's own travel, which ends at unity. Normalized against the
             * FADER's travel it drew four fifths of an arc at its maximum, and
             * read as a control that had stopped early. */
            displayValue: formatSend(level), normalizedValue: sendFrac(level),
            automatable: true,
        });
    }
    return cells;
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
        /* Already in the lane's own units — `buildAutomationView` denormalizes
         * every lane value once, and for a mix lane those units are the
         * control's POSITION. Re-denormalizing it here as if it were still
         * 0-127 pinned every automated mix knob near the bottom of its travel,
         * which is what "stuck on one side" was. */
        const frac = (held ? auto.heldValues.get(lane) : auto.liveValues.get(lane)) as number;
        const value = fieldFromFrac(field, frac);
        cell.touched = true;
        cell.displayValue = field === 'pan' ? formatPan(value)
                          : field === 'gain' ? formatDb(value) : formatSend(value);
        cell.normalizedValue = field === 'pan' ? panFrac(value)
                             : field === 'gain' ? volumeFrac(value) : sendFrac(value);
    }
    void v;
}

/** The whole page as a ViewModel, so the existing chain/knob renderers and the
 *  router plumbing drive it exactly like a module's page. */
export function buildMixVM(st: MixPageState): ViewModel {
    const cells = buildMixCells(st.vals, st.kind);
    if (st.auto) decorate(cells, st.vals, st.auto);
    /* EVERY held knob shows its value, not just the last one — two hands on the
     * page is two readouts, the same as a module's. Only the header toast is
     * singular, and it follows the knob touched most recently. */
    for (const k of st.touched) {
        const c = k >= 0 && k < 8 ? cells[k] : null;
        if (c) c.touched = true;
    }
    const primary = st.touched.length > 0 ? st.touched[st.touched.length - 1] : -1;
    const primaryCell = primary >= 0 && primary < 8 ? cells[primary] : null;
    let toast: ViewModel['toast'] = null;
    if (primaryCell) {
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
