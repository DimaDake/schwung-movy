/* Detects a cutoff+resonance pair on a page and the filter-type source that
 * shapes its response curve. The pair is reordered onto one line (cutoff then
 * resonance) by page-layout.ts and drawn as a filter-response graphic instead of
 * two knobs — the filter analogue of the envelope/LFO groups. Pure: page-
 * relative indices only; live values + off-page mode resolve in filter-vm.ts. */

import type { KnobParam } from '../types/param.js';
import { isFilterModeEnum, isSlopeEnum, staticModeFromTokens, type FilterMode } from './filter-mode.js';

export interface FilterGroup {
    cutoff: number;                  // page-relative indices
    resonance: number;
    cutQual: string;                 // qualifier tokens for same-pair mode binding
    resQual: string;
    modeIdx: number | null;          // same-page filter-mode enum bound to this pair
    staticMode: FilterMode | null;   // inferred from the cutoff's own name tokens
    slopeIdx: number | null;         // same-page 12/24 dB slope enum
}

function words(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
const has = (ws: string[], set: Set<string>) => ws.some(w => set.has(w));

const RESO_WORDS = new Set(['resonance', 'reso', 'res', 'q', 'peak']);
/* A bare `cut` reads as cutoff only beside a filter-type token; `freq` only with
 * an explicit filter cluster — so band_freq / mg_freq / osc freq stay plain. */
const CUT_CTX  = new Set(['lpf', 'hpf', 'bpf', 'lp', 'hp', 'bp', 'lo', 'hi', 'low', 'high', 'filter', 'freq', 'vcf']);
const FREQ_CTX = new Set(['filter', 'vcf']);
/* Enum role words stripped to leave a mode/slope enum's qualifier (keep the
 * filter-family token so filter_mode qualifies as "filter", filter1_type as
 * "filter1"). */
const ENUM_ROLE = new Set(['mode', 'type', 'slope']);

type Role = 'cutoff' | 'resonance';

/* Classify one param → {role, qualifier} or null. Qualifier = the matched text's
 * remaining words, so lpf_cut→"lpf", filter1_resonance→"filter1", pairing keeps
 * lpf/hpf and filter1/filter2 apart. */
function classify(p: KnobParam): { role: Role; qualifier: string } | null {
    if (p.type !== 'float' && p.type !== 'int') return null;
    for (const text of [p.key, p.label]) {
        const ws = words(text);
        let role: Role | null = null, skip = -1;
        if ((skip = ws.indexOf('cutoff')) >= 0) role = 'cutoff';
        else if ((skip = ws.indexOf('cut')) >= 0 && has(ws, CUT_CTX)) role = 'cutoff';
        else if ((skip = ws.indexOf('freq')) >= 0 && has(ws, FREQ_CTX)) role = 'cutoff';
        else {
            skip = ws.findIndex(w => RESO_WORDS.has(w));
            if (skip >= 0) role = 'resonance';
        }
        if (role) return { role, qualifier: ws.filter((_, j) => j !== skip).join('') };
    }
    return null;
}

/* Qualifier of a mode/slope enum (filter1_type → "filter1", mode → ""). */
function enumQualifier(p: KnobParam): string {
    return words(p.key).filter(w => !ENUM_ROLE.has(w)).join('');
}

/* Cutoff name tokens (key + label + qualifier) for static-type inference. */
function cutoffTokens(p: KnobParam, qualifier: string): string[] {
    return [...words(p.key), ...words(p.label), ...words(qualifier)];
}

export function detectFilterViz(params: (KnobParam | null)[]): FilterGroup[] {
    const cutoffs: { idx: number; qual: string }[] = [];
    const resos:   { idx: number; qual: string }[] = [];
    params.forEach((p, i) => {
        if (!p) return;
        const c = classify(p);
        if (c?.role === 'cutoff') cutoffs.push({ idx: i, qual: c.qualifier });
        else if (c?.role === 'resonance') resos.push({ idx: i, qual: c.qualifier });
    });

    // Same-page filter-mode and slope enums, with their qualifiers.
    const modeEnums: { idx: number; qual: string }[] = [];
    const slopeEnums: { idx: number; qual: string }[] = [];
    params.forEach((p, i) => {
        if (!p || p.type !== 'enum') return;
        if (isFilterModeEnum(p.options)) modeEnums.push({ idx: i, qual: enumQualifier(p) });
        else if (isSlopeEnum(p.options)) slopeEnums.push({ idx: i, qual: enumQualifier(p) });
    });

    const pairs: { cut: { idx: number; qual: string }; res: { idx: number; qual: string } }[] = [];
    const usedR = new Set<number>();
    // Pass 1: same-qualifier pairs (aphex lpf/hpf, surge filter1/filter2).
    for (const c of cutoffs) {
        const r = resos.find(r => !usedR.has(r.idx) && r.qual === c.qual);
        if (r) { usedR.add(r.idx); pairs.push({ cut: c, res: r }); }
    }
    // Pass 2: a single leftover cutoff+resonance pair when one side is unqualified
    // (osirus cutoff+filter1_resonance; minijv label-matched pair). A cross-pair
    // with two different non-empty qualifiers (hpf_cut+lpf_reso) is rejected.
    const freeC = cutoffs.filter(c => !pairs.some(pr => pr.cut === c));
    const freeR = resos.filter(r => !usedR.has(r.idx));
    if (freeC.length === 1 && freeR.length === 1) {
        const c = freeC[0], r = freeR[0];
        if (c.qual === r.qual || c.qual === '' || r.qual === '') pairs.push({ cut: c, res: r });
    }

    const pick = (list: { idx: number; qual: string }[], quals: string[]): number | null => {
        const q = list.find(e => e.qual !== '' && quals.includes(e.qual));
        if (q) return q.idx;
        return list.length === 1 ? list[0].idx : null;
    };

    const out = pairs.map(({ cut, res }): FilterGroup => {
        const quals = [cut.qual, res.qual];
        const modeIdx = pick(modeEnums, quals);
        const cutP = params[cut.idx] as KnobParam;
        return {
            cutoff: cut.idx, resonance: res.idx, cutQual: cut.qual, resQual: res.qual,
            modeIdx,
            staticMode: modeIdx === null ? staticModeFromTokens(cutoffTokens(cutP, cut.qual)) : null,
            slopeIdx: pick(slopeEnums, quals),
        };
    });
    return out.sort((a, b) => Math.min(a.cutoff, a.resonance) - Math.min(b.cutoff, b.resonance));
}
