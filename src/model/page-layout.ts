/* Page layout planner. Rearranges a page's knob cells so recognised groups sit
 * together on one line: envelopes span their 2–4 stage cells (see envelope.ts),
 * and each module LFO spans exactly two cells — Shape + one partner — so its
 * waveform graphic always has its knobs on the same row. Each cell keeps its
 * page-relative param index so touch/value stay bound to the physical knob. */

import type { KnobParam } from '../types/param.js';
import { detectEnvelopes, type EnvRole } from './envelope.js';
import { detectLfoViz } from './lfo-viz.js';
import { detectFilterViz } from './filter-viz.js';
import { detectEqViz } from './eq-viz.js';
import { detectCutPair } from './cut-viz.js';
import { detectWavViz } from './wav-viz.js';

export interface PageCell { line: 0 | 1; col: 0 | 1 | 2 | 3; idx: number }
export interface EnvLine {
    line: 0 | 1; name: string; startCol: number; cellCount: number; roles: EnvRole[];
    /* Page-relative indices of the stages this graphic draws. Carried so a
     * per-cell style can tell a stage that is already on screen as part of an
     * envelope from a LONE stage that needs its own glyph (env-stage.ts). */
    idxs: number[];
}

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
/* An EQ placement: the group's 2-3 band gains seated on one line in FREQUENCY
 * order (low, mid, high) starting at startCol, so the curve reads left-to-right
 * as the spectrum regardless of the order the module declared them. */
export interface EqLine {
    line: 0 | 1; startCol: number; cellCount: number;
    bands: import('./eq-viz.js').EqBand[];
    idxs: number[];   // page-relative param index per band, same order as bands
}
/* A low-cut + high-cut placement: the two corners seated on one line, lowcut
 * first, drawn as a single band-pass across both cells. A LONE cut is not here
 * — it needs no line of its own and renders as a per-cell style. */
export interface CutLine {
    line: 0 | 1; startCol: number; cellCount: number;
    lowcut: number; highcut: number;
}
/* A sample waveform placement: the position marker and, when present, its file
 * companion, seated together so the envelope has room to be a picture. */
export interface WavLine {
    line: 0 | 1; startCol: number; cellCount: number;
    position: number; idxs: number[];
}
export interface PageLayout {
    cells: PageCell[]; envelopes: EnvLine[]; lfos: LfoLine[];
    filters: FilterLine[]; eqs: EqLine[]; cuts: CutLine[]; wavs: WavLine[];
    /* A lone position marker that could not claim a line: drawn as a one-cell
     * waveform wherever the page already put it, so the layout is untouched. */
    wavCell: number | null;
}

/* Physical knob (slot = line*4 + col) → page-relative param index, honoring the
 * rearrange so a knob always drives the param shown at its position. */
export function pageSlotMap(params: (KnobParam | null)[]): number[] {
    const map = new Array(8).fill(-1);
    for (const c of planPageLayout(params).cells) map[c.line * 4 + c.col] = c.idx;
    return map;
}

/* Cells a multi-cell graphic already draws. Any per-CELL style (the waveform
 * silhouette, the waveform toggle, the lone envelope stage) has to stay out of
 * these or it would draw the same param twice. */
export function claimedCells(layout: PageLayout): Set<number> {
    const out = new Set<number>();
    for (const e of layout.envelopes) for (const i of e.idxs) out.add(i);
    for (const l of layout.lfos) {
        out.add(l.shape);
        for (const i of [l.phase, l.rate, l.depth, l.deform, l.mode, l.retrig]) {
            if (i !== null) out.add(i);
        }
    }
    for (const q of layout.eqs) for (const i of q.idxs) out.add(i);
    for (const c of layout.cuts) { out.add(c.lowcut); out.add(c.highcut); }
    for (const wv of layout.wavs) for (const i of wv.idxs) out.add(i);
    for (const f of layout.filters) {
        out.add(f.cutoff);
        out.add(f.resonance);
        if (f.modeIdx !== null) out.add(f.modeIdx);
        if (f.slopeIdx !== null) out.add(f.slopeIdx);
    }
    return out;
}

export function planPageLayout(params: (KnobParam | null)[]): PageLayout {
    const rowCells: (number[] | null)[] = [null, null];   // cells claimed per line, in order
    const envelopes: EnvLine[] = [];
    const lfos: LfoLine[] = [];
    const filters: FilterLine[] = [];
    const eqs: EqLine[] = [];
    const cuts: CutLine[] = [];
    const wavs: WavLine[] = [];
    let wavCell: number | null = null;
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
        if (line >= 0) envelopes.push({
            line: line as 0 | 1, name: e.name, startCol: 0,
            cellCount: idxs.length, roles: e.roles, idxs,
        });
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

    /* EQ groups last: a band gain is never an envelope stage or a filter
     * cutoff, so nothing above can have taken these cells — but the line budget
     * is shared, and an envelope is the more important picture when both want
     * the same row. */
    for (const g of detectEqViz(params)) {
        if (used.size >= 2) break;
        const idxs = g.bands.map(b => g[b] as number);
        if (idxs.some(i => claimed.has(i))) continue;
        const line = assign(idxs, (Math.floor(Math.min(...idxs) / 4)) as 0 | 1);
        if (line >= 0) eqs.push({
            line: line as 0 | 1, startCol: 0, cellCount: idxs.length,
            bands: g.bands, idxs,
        });
    }

    /* Sample waveform first among the late groups: it is the only graphic whose
     * whole purpose is resolution, so it gets a line before the cut pair does. */
    for (const g of detectWavViz(params)) {
        /* Seat the sample and its marker together, the way an envelope gathers
         * its stages — file first, so the waveform reads left-to-right with the
         * marker over it. Modules routinely put them on different rows
         * (mrdrums: sample on row 0, start on row 1). */
        const idxs = g.file === null ? [g.position] : [g.file, g.position];
        if (idxs.some(i => claimed.has(i))) continue;
        /* Take a line only if it is the group's OWN line. Envelopes are placed
         * first and may already hold it (mrdrums: attack+decay on row 1, the
         * start point beside them) — and displacing the other row to make space
         * would rewrite a layout the module deliberately chose. When that
         * happens the waveform still draws, just in the one cell it already
         * occupies, via wavCell below. */
        const want = (Math.floor(Math.min(...idxs) / 4)) as 0 | 1;
        /* No line to be had — both are spoken for, or this group's own line is.
         * The marker still draws, one cell wide, where the page already put it. */
        if (used.size >= 2 || used.has(want)) { wavCell = g.position; continue; }
        const line = assign(idxs, want);
        if (line < 0) continue;
        /* Stretch into whatever the page is not using. A waveform is the one
         * graphic whose whole value is horizontal resolution, so it takes the
         * FREE cells — but never a cell another param needs: the other params
         * must still all fit in what is left of the two lines. */
        const total = params.filter(Boolean).length;
        const room = 8 - total + idxs.length;
        const cellCount = Math.max(idxs.length, Math.min(4, room));
        wavs.push({
            line: line as 0 | 1, startCol: 0, cellCount,
            position: g.position, idxs,
        });
    }

    /* Low-cut + high-cut pairs last, seated lowcut-first so the band-pass reads
     * left-to-right as the spectrum. A lone cut is deliberately NOT placed: it
     * draws in whatever cell it lands in, so it never spends a line. */
    for (const c of detectCutPair(params)) {
        if (used.size >= 2) break;
        const idxs = [c.lowcut as number, c.highcut as number];
        if (idxs.some(i => claimed.has(i))) continue;
        const line = assign(idxs, (Math.floor(Math.min(...idxs) / 4)) as 0 | 1);
        if (line >= 0) cuts.push({
            line: line as 0 | 1, startCol: 0, cellCount: 2,
            lowcut: idxs[0], highcut: idxs[1],
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
    return { cells, envelopes, lfos, filters, eqs, cuts, wavs, wavCell };
}
