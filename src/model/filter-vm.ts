/* Builds the FilterVizVM list from the page layout's filter placements. Each is
 * a cutoff+resonance pair already seated on one line (cutoff at startCol) by
 * page-layout.ts. Resolves the live cutoff/resonance positions and the filter
 * type: a same-page mode enum wins, else a same-qualifier mode enum elsewhere in
 * the chain (cached value), else a static type from the cutoff's own name, else
 * LP. Mirrors lfo-vm.ts; no per-render IPC (reads cached values only). */

import type { KnobParam } from '../types/param.js';
import type { FilterVizVM } from '../types/viewmodel.js';
import type { FilterLine } from './page-layout.js';
import { filterModeFromEnum, isFilterModeEnum, slopeFromEnum, isSlopeEnum, normalizeFilterOption, type FilterMode } from './filter-mode.js';

const ENUM_ROLE = new Set(['mode', 'type', 'slope']);
function words(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
const enumQualifier = (p: KnobParam) => words(p.key).filter(w => !ENUM_ROLE.has(w)).join('');

/* Which params could supply an off-page filter mode, and under what qualifier.
 * Derived purely from the module's metadata, so it is fixed for the life of a
 * loaded hierarchy — but the search below runs on every frame of every knob
 * turn, and re-deriving it walked all ~180 of helm's params doing regex work per
 * enum. Keyed on the knobParams array itself: loadHierarchy assigns a fresh
 * array (meta-retry settles by forcing a rebuild, never by mutating in place),
 * so a stale entry cannot outlive the metadata it came from. */
type ModeCandidate = { idx: number; qual: string };
const candidateCache = new WeakMap<object, ModeCandidate[]>();

function modeCandidates(allParams: (KnobParam | null)[]): ModeCandidate[] {
    let found = candidateCache.get(allParams);
    if (found) return found;
    found = [];
    for (let i = 0; i < allParams.length; i++) {
        const p = allParams[i];
        if (!p || p.type !== 'enum' || !isFilterModeEnum(p.options)) continue;
        const qual = enumQualifier(p);
        if (qual !== '') found.push({ idx: i, qual });
    }
    candidateCache.set(allParams, found);
    return found;
}

export function buildFilterViz(
    lines: FilterLine[], pageParams: (KnobParam | null)[], pageValues: (number | null)[],
    allParams: (KnobParam | null)[], allValues: (number | null)[],
): FilterVizVM[] {
    const raw = (vals: (number | null)[], idx: number | null): number => {
        const v = idx == null ? null : vals[idx];
        return (v === null || v === undefined) ? 0 : (v as number);
    };
    const norm01 = (idx: number): number => {
        const p = pageParams[idx];
        const v = raw(pageValues, idx);
        return p && p.max !== p.min ? Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min))) : 0;
    };

    // Off-page mode: a filter-mode enum elsewhere in the chain whose qualifier
    // matches this pair (chordism/osirus/surge keep MODE on a separate page).
    const offPageMode = (quals: string[]): FilterMode | null => {
        for (const c of modeCandidates(allParams)) {
            if (quals.includes(c.qual)) {
                return filterModeFromEnum(allParams[c.idx]!.options, raw(allValues, c.idx));
            }
        }
        return null;
    };

    const out: FilterVizVM[] = [];
    for (const g of lines) {
        const quals = [g.cutQual, g.resQual];
        const modeP = g.modeIdx != null ? pageParams[g.modeIdx] : null;
        let mode: FilterMode | null;
        if (modeP) {
            // A same-page mode enum drives the shape directly; a type the curve
            // can't draw (Forge Comb, unrecognised) → skip so cutoff/resonance
            // render as ordinary knobs instead of a misleading LP curve.
            mode = normalizeFilterOption(modeP.options?.[Math.round(raw(pageValues, g.modeIdx))] ?? '');
            if (mode === null) continue;
        } else {
            mode = offPageMode(quals) ?? g.staticMode ?? 'lp';
        }

        const vm: FilterVizVM = {
            line: g.line, startCol: g.startCol,
            cutoff: norm01(g.cutoff), resonance: norm01(g.resonance), mode,
        };
        const slope = resolveSlope(g, pageParams, pageValues, modeP);
        if (slope !== undefined) vm.slope = slope;
        out.push(vm);
    }
    return out;
}

/* Slope from a dedicated 12/24 dB enum (chordism), or baked into a mode option
 * name (surge "LP 24 dB"). Undefined when the module exposes no slope. */
function resolveSlope(
    g: FilterLine, pageParams: (KnobParam | null)[], pageValues: (number | null)[], modeP: KnobParam | null,
): 0 | 1 | undefined {
    if (g.slopeIdx != null) {
        const p = pageParams[g.slopeIdx];
        if (p && isSlopeEnum(p.options)) {
            const v = pageValues[g.slopeIdx];
            return slopeFromEnum(p.options, (v === null || v === undefined) ? 0 : v);
        }
    }
    if (modeP && g.modeIdx != null) {
        const v = pageValues[g.modeIdx];
        const opt = modeP.options?.[Math.round((v === null || v === undefined) ? 0 : v)] ?? '';
        if (/\d+\s*db/i.test(opt)) return /24/.test(opt) ? 1 : 0;
    }
    return undefined;
}
