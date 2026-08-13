/* Which cells on a page draw a waveform silhouette instead of the abbreviated
 * option text. Unlike envelope/LFO/filter groups (see page-layout.ts) this is a
 * per-CELL style, not a multi-cell group, so it needs no layout rearrange — only
 * the indices those detectors already claimed, to stay out of their way.
 * Pure: indices only, no rendering. */

import type { KnobParam } from '../types/param.js';
import { claimedCells, type PageLayout } from './page-layout.js';
import { enumClassOf } from './enum-class.js';

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
