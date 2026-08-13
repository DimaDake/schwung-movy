/* Builds the EqVizVM list from the page layout's EQ placements. Each band gain
 * becomes a signed −1..1 so the renderer draws boost above and cut below the
 * 0 dB line. Mirrors filter-vm.ts; reads cached values only, no per-render IPC. */

import type { KnobParam } from '../types/param.js';
import type { EqVizVM } from '../types/viewmodel.js';
import type { EqLine } from './page-layout.js';

/* Signed position of a bipolar gain: 0 at the param's zero, ±1 at its rails.
 * Normalised against the rail the value is actually on, so an asymmetric range
 * (−6..+12) still reads as "half a cut" rather than a quarter of the span. */
function signedGain(p: KnobParam | null, v: number | null): number {
    if (!p || v === null || v === undefined) return 0;
    if (v >= 0) return p.max > 0 ? Math.min(1, v / p.max) : 0;
    return p.min < 0 ? -Math.min(1, v / p.min) : 0;
}

export function buildEqViz(
    lines: EqLine[], pageParams: (KnobParam | null)[], pageValues: (number | null)[],
): EqVizVM[] {
    return lines.map((l) => ({
        line: l.line,
        startCol: l.startCol,
        cellCount: l.cellCount,
        bands: l.bands,
        gains: l.idxs.map((i) => signedGain(pageParams[i] ?? null, pageValues[i] ?? null)),
    }));
}
