/* The eight knob cells of an LFO page, built from a plain value record.
 *
 * Pure: same values in, same cells out. Kept apart from the model so the page's
 * appearance can be asserted without driving knob gestures, and so the model
 * file stays about state. */

import type { ParamVM, ViewModel } from '../types/viewmodel.js';
import { paramCell as cell } from '../seq/param-vm.js';
import type { LfoScope } from './scope.js';
import type { LfoVals } from './io.js';
import {
    LFO_SHAPES, LFO_DIVISIONS, LFO_BANK_COUNT, RATE_HZ_MIN, RATE_HZ_MAX,
    compLabel, shortenTarget, formatDepth, formatPhase,
} from './params.js';

/* Current target's compact label for the resting enum box. */
export function targetLabel(v: LfoVals): string {
    return v.target ? shortenTarget(compLabel(v.target), v.targetParam) : 'None';
}

export function rateDisplay(v: LfoVals): string {
    return v.sync ? LFO_DIVISIONS[v.rateDiv] : v.rateHz.toFixed(1) + ' Hz';
}

export function rateNorm(v: LfoVals): number {
    return v.sync
        ? v.rateDiv / (LFO_DIVISIONS.length - 1)
        : Math.log(v.rateHz / RATE_HZ_MIN) / Math.log(RATE_HZ_MAX / RATE_HZ_MIN);
}

export function buildCells(scope: LfoScope, v: LfoVals): (ParamVM | null)[] {
    // None → framed X box (drawn, not text); a real target → enum box label.
    const targetCell = v.target
        ? cell({ shortName: 'TARGET', fullName: 'Target', type: 'enum', isLongEnum: true,
            options: [targetLabel(v)], enumIndex: 0, displayValue: targetLabel(v) })
        : cell({ shortName: 'TARGET', fullName: 'Target', type: 'float', renderStyle: 'xbox',
            displayValue: 'None' });
    // Line 1: Rate, Sync, Mode, Target. Line 2: Shape, Phase, Retrigger,
    // Depth. Shape+Phase are drawn as the waveform graphic (see lfoViz);
    // Shape is a plain cycling enum (no overlay) — the wave shows it.
    return [
        cell({ shortName: 'RATE', fullName: 'Rate', type: 'float', renderStyle: 'arc',
            displayValue: rateDisplay(v), normalizedValue: rateNorm(v) }),
        cell({ shortName: 'SYNC', fullName: 'Sync', type: 'enum',
            options: ['FREE', 'SYNC'], enumIndex: v.sync, displayValue: v.sync ? 'SYNC' : 'FREE',
            normalizedValue: v.sync }),
        cell({ shortName: 'MODE', fullName: 'Mode', type: 'enum',
            options: ['UNI', 'BI'], enumIndex: v.polarity, displayValue: v.polarity ? 'BI' : 'UNI',
            normalizedValue: v.polarity }),
        targetCell,
        cell({ shortName: 'SHAPE', fullName: 'Shape', type: 'enum',
            options: LFO_SHAPES, enumIndex: v.shape, displayValue: LFO_SHAPES[v.shape],
            normalizedValue: v.shape / (LFO_SHAPES.length - 1) }),
        cell({ shortName: 'PHASE', fullName: 'Phase', type: 'float', renderStyle: 'arc',
            displayValue: formatPhase(v.phase), normalizedValue: v.phase }),
        /* Master LFOs have nothing to retrigger on — there are no notes on the
         * master bus, and the shim has no key for it. A blank cell (LED off) is
         * the honest answer; a drawn knob that does nothing reads as broken.
         *
         * Hand-built otherwise, so it names the style model/toggle.ts infers for
         * every module boolean — otherwise movy's own pages keep the old bar. */
        scope.hasRetrigger
            ? cell({ shortName: 'RETRIG', fullName: 'Retrigger', type: 'int', renderStyle: 'switch',
                displayValue: v.retrigger ? 'On' : 'Off', normalizedValue: v.retrigger })
            : null,
        cell({ shortName: 'DEPTH', fullName: 'Depth', type: 'float', renderStyle: 'arc',
            displayValue: formatDepth(v.depth), normalizedValue: (v.depth + 1) / 2 }),
    ];
}

/** The target-picker overlay, while the TARGET knob is held. */
export interface LfoOverlay {
    pos: number;
    kind: 'target';
    options: string[];
    selected: number;
    opts?: import('./params.js').TargetOption[];
}

export interface LfoPageState {
    bank: number;
    vals: LfoVals[];
    /** Knob touch order; the last entry owns the header toast. */
    touched: number[];
    overlay: LfoOverlay | null;
}

/** The whole page as a ViewModel — the renderers and router plumbing then drive
 *  it exactly like a module's page. */
export function buildLfoVM(scope: LfoScope, st: LfoPageState): ViewModel {
    const v = st.vals[st.bank];
    const cells = buildCells(scope, v);
    const primary = st.touched.length > 0 ? st.touched[st.touched.length - 1] : -1;
    const primaryCell = primary >= 0 && primary < 8 ? cells[primary] : null;
    let toast: ViewModel['toast'] = null;
    if (primaryCell) {
        primaryCell.touched = true;
        toast = { fullName: primaryCell.fullName, value: primaryCell.displayValue, browseHint: false };
    }
    const name = 'LFO ' + (st.bank + 1);
    return {
        moduleName: name,
        /* The master chain is not a track, and the default header would read
         * "T1 > LFO 1" — on the one page where mistaking whose LFO you are
         * editing is the whole failure mode. */
        headerOverride: scope.keyPrefix ? scope.label + ' > ' + name : undefined,
        bankName: '',
        bankIndex: st.bank,
        bankCount: LFO_BANK_COUNT,
        rows: [cells.slice(0, 4), cells.slice(4, 8)],
        touchedSlot: primaryCell ? primary : null,
        toast,
        // Target destinations, never waveforms — no glyph gutter.
        overlay: st.overlay
            ? { slot: st.overlay.pos, options: st.overlay.options, selected: st.overlay.selected, shapeIds: null }
            : null,
        isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, drumPadName: '', isPadScoped: false,
        // LFO editing is independent of automation — never hide/held.
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
        // Shape+Phase (line 2, cols 0-1) render as the LFO waveform graphic.
        lfoViz: [{ line: 1, startCol: 0, shape: v.shape, phase: v.phase, mode: v.polarity, retrigger: v.retrigger }],
    };
}
