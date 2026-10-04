/* mix-schwung-cells.ts — the MIX page's `PageParamSource` (SP-55).
 *
 * Five real fields behind ONE composite engine param (`mix-io.ts`'s own
 * header: "the engine parses `gain,pan,muted[,send1..sendN]` as ONE value").
 * Schwung's contract wants one key per cell, so each cell's `get`/`set`
 * reads the whole composite and answers/writes just its own field — the
 * same read-modify-write `mix-model.ts`'s `edit()` already does, reached
 * through `applyMixFieldAbs` (`mix-apply.ts`) for the write half.
 *
 * NATIVE FIRST (the wave's own rule): every cell is a plain `float`, 0..1 —
 * the control's POSITION, matching `mix-io.ts`'s `LANE_RANGE` (the same
 * units automation already uses for these fields) rather than each field's
 * own raw unit (an amplitude, a dB span). `format()` prints the raw unit
 * back for the readout; the ARC itself walks the position. Movy's own vbar/
 * pan/arc-with-unity-notch widgets are not reproduced — a restyle, deferred
 * like SP-53's LENGTH/TRANSPOSE, not a correctness gap.
 *
 * KNOB RATE: one CC unit is one detent (`rawPerDetent: 1`). Schwung steps a
 * float by `MIN_STEP_RANGE_FRAC × ARC_DELTA_SCALE` of its range per detent —
 * the same fraction movy's own MIX page moves per CC unit (`stepAmpDb`,
 * `stepPan`) — and the range here is the control's POSITION, which is already
 * dB-linear for VOL and the sends. So at one unit per detent the two pages
 * cross the travel in the same wrist movement; at the virtual source's
 * default of 8 (the int rate of Set/Clip Params) this page took 1600 units for
 * a sweep the movy page did in 200. The declared `step` does not enter into
 * it: Schwung's float step is range-normalised and ignores it.
 */

import { createVirtualSource, type VirtualCellSpec } from '../renderer/schwung-virtual-source.js';
import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { applyMixFieldAbs } from './mix-apply.js';
import {
    FIELD_AT, fieldFrac, fieldFromFrac, formatDb, formatPan, formatSend,
    readMix, type MixFieldName, type MixVals,
} from './mix-io.js';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, Number(v) || 0));

/** `readMix(track)` answers a whole `MixVals`; this is the one place that
 *  resolves ONE field out of it (`gain`/`pan` are plain numbers, a send is
 *  an array slot) — every cell's `get`/`format` goes through it. */
function valueOf(v: MixVals, field: MixFieldName): number {
    if (field === 'gain') return v.gain;
    if (field === 'pan') return v.pan;
    return v.send[Number(field.slice(4)) - 1] ?? 0;
}

const LABELS: Record<MixFieldName, { name: string; short: string; format(value: number): string }> = {
    gain:  { name: 'Volume', short: 'VOL',   format: formatDb },
    pan:   { name: 'Pan',    short: 'PAN',   format: formatPan },
    send1: { name: 'Send 1', short: 'SEND1', format: formatSend },
    send2: { name: 'Send 2', short: 'SEND2', format: formatSend },
    send3: { name: 'Send 3', short: 'SEND3', format: formatSend },
};

function cellFor(track: number, field: MixFieldName): VirtualCellSpec {
    const label = LABELS[field];
    return {
        key: field, name: label.name, shortName: label.short,
        type: 'float', min: 0, max: 1, step: 1 / 64, rawPerDetent: 1,
        get: () => fieldFrac(field, valueOf(readMix(track), field)).toFixed(4),
        set: (v: string) => applyMixFieldAbs(track, field, fieldFromFrac(field, clamp01(Number(v)))),
        format: (raw) => raw === null ? null : label.format(fieldFromFrac(field, clamp01(Number(raw)))),
    };
}

function buildCells(track: number): VirtualCellSpec[] {
    return FIELD_AT.filter((f): f is MixFieldName => f !== undefined)
                   .map((field) => cellFor(track, field));
}

/* One source per track — `schwung-grid.ts`'s own page cache (keyed by
 * track+component) already guarantees this factory runs once per track, so
 * nothing here needs its own memoization. */
export function mixSchwungSource(track: number): PageParamSource {
    return createVirtualSource('mix', buildCells(track));
}
