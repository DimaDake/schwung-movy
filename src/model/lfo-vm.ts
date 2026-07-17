/* Builds the LfoVizVM list from the page layout's arranged LFO placements. Each
 * placement is Shape + one partner cell (phase/rate/depth) already sat together
 * on a line by page-layout.ts. Only the partner is drawn "under" the graphic, so
 * only it is encoded: rate → 1..2 cycle count, depth → amplitude (floored so the
 * shape stays visible), phase → shift. Deform/polarity/retrigger feed the wave
 * live from wherever they sit; rate/depth are never encoded off-partner. */

import type { KnobParam } from '../types/param.js';
import type { LfoVizVM } from '../types/viewmodel.js';
import type { LfoLine } from './page-layout.js';
import { shapeIdOrGeneric } from './lfo-shapes.js';

const RETRIG_ON  = /note reset|one shot|keytrigger|retrig|^on$/i;
const RETRIG_OFF = /free|freerun|^off$|random/i;
const DEPTH_FLOOR = 0.35;   // min amplitude when depth is the partner — never flat

export function buildLfoViz(
    lfos: LfoLine[], params: (KnobParam | null)[], values: (number | null)[],
): LfoVizVM[] {
    const raw = (idx: number | null): number => {
        const v = idx == null ? null : values[idx];
        return (v === null || v === undefined) ? 0 : (v as number);
    };
    const norm01 = (idx: number | null): number => {
        const p = idx == null ? null : params[idx];
        const v = raw(idx);
        return p && p.max !== p.min
            ? Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)))
            : Math.max(0, Math.min(1, v));
    };

    return lfos.map((g) => {
        const vm: LfoVizVM = {
            line: g.line, startCol: g.startCol,
            shape: g.inferred ? shapeIdOrGeneric(g.shapeOptions?.[Math.round(raw(g.shape))]) : Math.round(raw(g.shape)),
            phase: norm01(g.phase),
            mode: polarity(g.mode, params[g.mode ?? -1] ?? null, raw(g.mode)),
            retrigger: retrigger(params[g.retrig ?? -1] ?? null, raw(g.retrig), g.retrig != null),
            cycles: g.partnerRole === 'rate' ? 1 + norm01(g.rate) : 2,
        };
        if (g.partnerRole === 'depth') vm.ampScale = DEPTH_FLOOR + (1 - DEPTH_FLOOR) * norm01(g.depth);
        const d = deform(params[g.deform ?? -1] ?? null, raw(g.deform), g.deform != null);
        if (d !== undefined) vm.deform = d;
        return vm;
    });
}

/* 0 = unipolar, 1 = bipolar. Read from the option name (unipolar/bipolar), or an
 * On/Off "unipolar" toggle (On = unipolar); explicit tags keep the raw value. */
function polarity(idx: number | null, p: KnobParam | null, value: number): number {
    if (idx == null) return 1;
    const opt = (p?.options?.[Math.round(value)] ?? '').toLowerCase();
    if (opt.includes('uni')) return 0;
    if (opt.includes('bi')) return 1;
    const key = ((p?.key ?? '') + ' ' + (p?.label ?? '')).toLowerCase();
    if (key.includes('unipolar')) return value ? 0 : 1;
    return Math.round(value);
}

/* Enum trigger modes map by name (Keytrigger/Note Reset → on; Freerun/Random →
 * off); numeric keytrigger flags map by truthiness. */
function retrigger(p: KnobParam | null, value: number, present: boolean): number {
    if (!present) return 0;
    const opt = p?.options?.[Math.round(value)];
    if (opt !== undefined) return RETRIG_ON.test(opt) && !RETRIG_OFF.test(opt) ? 1 : 0;
    return Math.round(value) ? 1 : 0;
}

/* −1..1 skew across the param range (Osirus symmetry 0..127, Surge deform). */
function deform(p: KnobParam | null, value: number, present: boolean): number | undefined {
    if (!present || !p || p.max === p.min) return present ? 0 : undefined;
    return Math.max(-1, Math.min(1, 2 * (value - p.min) / (p.max - p.min) - 1));
}
