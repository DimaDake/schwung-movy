/* Which cells on a page draw a waveform silhouette instead of the abbreviated
 * option text. Unlike envelope/LFO/filter groups (see page-layout.ts) this is a
 * per-CELL style, not a multi-cell group, so it needs no layout rearrange — only
 * the indices those detectors already claimed, to stay out of their way.
 * Pure: indices only, no rendering. */

import type { KnobParam } from '../types/param.js';
import type { PageLayout } from './page-layout.js';
import { enumClassOf } from './enum-class.js';

/* Cells already drawn by a multi-cell graphic. An LFO's Shape param is drawn as
 * part of the LFO waveform, so re-styling its cell would draw it twice.
 * Envelope stages are numeric, never enums, so they cannot collide here. */
function claimedCells(layout: PageLayout): Set<number> {
    const out = new Set<number>();
    for (const l of layout.lfos) {
        out.add(l.shape);
        for (const i of [l.phase, l.rate, l.depth, l.deform, l.mode, l.retrig]) {
            if (i !== null) out.add(i);
        }
    }
    for (const f of layout.filters) {
        out.add(f.cutoff);
        out.add(f.resonance);
        if (f.modeIdx !== null) out.add(f.modeIdx);
        if (f.slopeIdx !== null) out.add(f.slopeIdx);
    }
    return out;
}

export function waveCellIndices(
    params: (KnobParam | null)[], layout: PageLayout,
): Set<number> {
    const claimed = claimedCells(layout);
    const out = new Set<number>();
    params.forEach((p, i) => {
        if (!p || p.type !== 'enum' || claimed.has(i)) return;
        /* A module config's explicit `render:` stays authoritative, as it is
         * everywhere else the model picks a style. */
        if (p.renderStyle !== 'arc') return;
        if (enumClassOf(p).uniqueShape) out.add(i);
    });
    return out;
}
