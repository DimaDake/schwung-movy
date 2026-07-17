/* Page layout planner. Rearranges a page's knob cells so recognised groups sit
 * together on one line: envelopes span their 2–4 stage cells (see envelope.ts),
 * and each module LFO spans exactly two cells — Shape + one partner — so its
 * waveform graphic always has its knobs on the same row. Each cell keeps its
 * page-relative param index so touch/value stay bound to the physical knob. */

import type { KnobParam } from '../types/param.js';
import { detectEnvelopes, type EnvRole } from './envelope.js';
import { detectLfoViz } from './lfo-viz.js';
import { detectFilterViz } from './filter-viz.js';

export interface PageCell { line: 0 | 1; col: 0 | 1 | 2 | 3; idx: number }
export interface EnvLine { line: 0 | 1; name: string; startCol: number; cellCount: number; roles: EnvRole[] }

/* An LFO waveform placement: Shape at startCol, its partner at startCol+1. The
 * partner is the only non-shape param drawn "under" the graphic, so only it is
 * encoded — rate → cycle count, depth → amplitude, phase → shift. */
export interface LfoLine {
    line: 0 | 1; startCol: number;
    shape: number; partnerRole: 'phase' | 'rate' | 'depth';
    phase: number | null; rate: number | null; depth: number | null;
    deform: number | null; mode: number | null; retrig: number | null;
    inferred: boolean; shapeOptions: string[] | null;
}
/* A filter placement: cutoff at startCol, resonance at startCol+1. Carries the
 * mode-source hints resolved lazily against live values in filter-vm.ts. */
export interface FilterLine {
    line: 0 | 1; startCol: number;
    cutoff: number; resonance: number;
    cutQual: string; resQual: string;
    modeIdx: number | null;
    staticMode: import('./filter-mode.js').FilterMode | null;
    slopeIdx: number | null;
}
export interface PageLayout { cells: PageCell[]; envelopes: EnvLine[]; lfos: LfoLine[]; filters: FilterLine[] }

/* Physical knob (slot = line*4 + col) → page-relative param index, honoring the
 * rearrange so a knob always drives the param shown at its position. */
export function pageSlotMap(params: (KnobParam | null)[]): number[] {
    const map = new Array(8).fill(-1);
    for (const c of planPageLayout(params).cells) map[c.line * 4 + c.col] = c.idx;
    return map;
}

export function planPageLayout(params: (KnobParam | null)[]): PageLayout {
    const rowCells: (number[] | null)[] = [null, null];   // cells claimed per line, in order
    const envelopes: EnvLine[] = [];
    const lfos: LfoLine[] = [];
    const filters: FilterLine[] = [];
    const used = new Set<number>();
    const claimed = new Set<number>();

    /* Claim a line for a contiguous group of cells; returns the line or -1. */
    const assign = (cells: number[], desired: 0 | 1): 0 | 1 | -1 => {
        const line: 0 | 1 = used.has(desired) ? ((desired ^ 1) as 0 | 1) : desired;
        if (used.has(line)) return -1;
        used.add(line); rowCells[line] = cells;
        for (const i of cells) claimed.add(i);
        return line;
    };

    // Envelopes first (2–4 cells), then LFO groups (Shape + partner).
    for (const e of detectEnvelopes(params)) {
        if (used.size >= 2) break;
        const idxs = e.roles.map(r => e[r] as number);
        const line = assign(idxs, (Math.floor(Math.min(...idxs) / 4)) as 0 | 1);
        if (line >= 0) envelopes.push({ line: line as 0 | 1, name: e.name, startCol: 0, cellCount: idxs.length, roles: e.roles });
    }
    for (const g of detectLfoViz(params)) {
        if (used.size >= 2) break;
        // Partner preference: phase > rate > depth (only the partner is encoded).
        const partnerRole = g.phase != null ? 'phase' : g.rate != null ? 'rate' : g.depth != null ? 'depth' : null;
        if (!partnerRole) continue;
        const partner = (partnerRole === 'phase' ? g.phase : partnerRole === 'rate' ? g.rate : g.depth) as number;
        const line = assign([g.shape, partner], (Math.floor(g.shape / 4)) as 0 | 1);
        if (line >= 0) lfos.push({
            line: line as 0 | 1, startCol: 0, shape: g.shape, partnerRole,
            phase: g.phase, rate: g.rate, depth: g.depth,
            deform: g.deform, mode: g.mode, retrig: g.retrig,
            inferred: g.inferred, shapeOptions: g.shapeOptions,
        });
    }

    // Filter groups last: cutoff then resonance on one line (see filter-viz.ts).
    // Only a pair whose cells aren't already an envelope/LFO stage is placed.
    for (const g of detectFilterViz(params)) {
        if (used.size >= 2) break;
        if (claimed.has(g.cutoff) || claimed.has(g.resonance)) continue;
        const line = assign([g.cutoff, g.resonance], (Math.floor(Math.min(g.cutoff, g.resonance) / 4)) as 0 | 1);
        if (line >= 0) filters.push({
            line: line as 0 | 1, startCol: 0, cutoff: g.cutoff, resonance: g.resonance,
            cutQual: g.cutQual, resQual: g.resQual, modeIdx: g.modeIdx,
            staticMode: g.staticMode, slopeIdx: g.slopeIdx,
        });
    }

    const leftover: number[] = [];
    params.forEach((p, i) => { if (p && !claimed.has(i)) leftover.push(i); });

    const cells: PageCell[] = [];
    let li = 0;
    for (let line = 0 as 0 | 1; line <= 1; line = (line + 1) as 0 | 1) {
        let col = 0;
        const rc = rowCells[line];
        if (rc) for (const idx of rc) cells.push({ line, col: (col++) as 0 | 1 | 2 | 3, idx });
        while (col <= 3 && li < leftover.length) cells.push({ line, col: (col++) as 0 | 1 | 2 | 3, idx: leftover[li++] });
        if (line === 1) break;
    }
    return { cells, envelopes, lfos, filters };
}
