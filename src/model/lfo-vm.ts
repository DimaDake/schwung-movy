/* Builds the LfoVizVM list for a page: resolves each detected group's Shape +
 * adjacent span partner to a (line, startCol), maps the live shape option to a
 * drawable id, and reads phase / polarity / retrigger / deform off the page.
 * Rate and depth are span-partner candidates only — never drawn — so the wave
 * stays a fixed-size specimen of the shape (see the shape-truth-only rule). */

import type { KnobParam } from '../types/param.js';
import type { LfoVizVM } from '../types/viewmodel.js';
import type { PageCell } from './envelope.js';
import { detectLfoViz, type LfoVizGroup } from './lfo-viz.js';
import { shapeIdOrGeneric } from './lfo-shapes.js';

const RETRIG_ON  = /note reset|one shot|keytrigger|retrig|^on$/i;
const RETRIG_OFF = /free|freerun|^off$|random/i;

export function buildLfoViz(
    params: (KnobParam | null)[], values: (number | null)[], cells: PageCell[],
): LfoVizVM[] {
    const cellOf = (idx: number | null) => (idx == null ? null : cells.find(c => c.idx === idx) ?? null);
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

    const out: LfoVizVM[] = [];
    for (const g of detectLfoViz(params)) {
        const sc = cellOf(g.shape);
        if (!sc) continue;
        // Span partner adjacent to Shape: prefer rate, then phase, then depth.
        const adj = (idx: number | null) => {
            const c = cellOf(idx);
            return c && c.line === sc.line && Math.abs(c.col - sc.col) === 1 ? c : null;
        };
        const pc = adj(g.rate) ?? adj(g.phase) ?? adj(g.depth);
        if (!pc) continue;

        const vm: LfoVizVM = {
            line: sc.line, startCol: Math.min(sc.col, pc.col),
            shape: shapeId(g, raw(g.shape)),
            phase: norm01(g.phase),
            mode: polarity(g, params[g.mode ?? -1] ?? null, raw(g.mode)),
            retrigger: retrigger(params[g.retrig ?? -1] ?? null, raw(g.retrig), g.retrig != null),
        };
        const d = deform(params[g.deform ?? -1] ?? null, raw(g.deform), g.deform != null);
        if (d !== undefined) vm.deform = d;
        out.push(vm);
    }
    return out;
}

function shapeId(g: LfoVizGroup, value: number): number {
    return g.inferred ? shapeIdOrGeneric(g.shapeOptions?.[Math.round(value)]) : Math.round(value);
}

/* 0 = unipolar, 1 = bipolar. Read from the option name (unipolar/bipolar), or an
 * On/Off "unipolar" toggle (On = unipolar); explicit tags keep the raw value. */
function polarity(g: LfoVizGroup, p: KnobParam | null, value: number): number {
    if (g.mode == null) return 1;
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
