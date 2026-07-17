/* Detects LFO waveform-visualization groups on a page: a Shape cell plus one
 * adjacent partner cell that render as a single waveform graphic instead of two
 * knobs (the LFO analogue of the envelope group, see envelope.ts). Explicit
 * config `lfo:` tags win; otherwise groups are inferred from parameter names.
 * Pure: indices only, no rendering. Adjacency + live values resolve in the VM. */

import type { KnobParam } from '../types/param.js';
import { isShapeEnum } from './lfo-shapes.js';

export interface LfoVizGroup {
    shape:   number;                 // page-relative indices
    phase:   number | null;
    rate:    number | null;          // span-partner candidate; never drawn
    depth:   number | null;          // span-partner candidate; never drawn
    deform:  number | null;          // drawn (waveform skew)
    mode:    number | null;          // polarity: 0 unipolar / 1 bipolar
    retrig:  number | null;
    inferred: boolean;               // shape id from option name (true) vs raw value
    shapeOptions: string[] | null;   // for inferred groups, to map value → shape id
}

type Role = 'shape' | 'phase' | 'rate' | 'depth' | 'deform' | 'polarity' | 'retrig';

function words(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
const isLfoToken  = (w: string) => /^lfo\d*$/.test(w);
const isBareLfo   = (w: string) => w === 'lfo';
/* Unit/format suffix words carry no LFO identity: lfo_rate_hz and lfo_rate_div
 * must group with lfo_shape (all qualifier ''), not split into 'hz'/'div'. */
const LFO_NOISE   = new Set(['hz', 'khz', 'div', 'ms', 'sec']);
/* Words that name a role — stripped from the key to leave the LFO's qualifier. */
const ROLE_VOCAB = new Set([
    'shape', 'wave', 'waveform', 'form', 'type',
    'phase', 'rate', 'speed', 'freq', 'depth', 'magnitude', 'amount', 'amt', 'dpt',
    'deform', 'symmetry', 'unipolar', 'bipolar', 'polar', 'polarity',
    'retrig', 'retrigger', 'trigger', 'trigmode', 'keytrigger', 'keytrig', 'mode',
]);
const has = (ws: string[], ...set: string[]) => ws.some(w => set.includes(w));
/* Options that read as clock divisions (1/4, 1/8T, 3/16) → a rate enum. */
const isDivisionEnum = (opts: string[] | null): boolean =>
    !!opts && opts.filter(o => /\d\/\d/.test(o)).length * 2 >= opts.length;

/* Classify one param → {role, qualifier}, or null when it is not an LFO role.
 * Requires an lfo token in the words so vibrato/chorus rates don't get pulled
 * in. Polarity checks vocabulary (unipolar/bipolar), never Poly|Mono. */
function classify(p: KnobParam): { role: Role; qualifier: string } | null {
    const kw = words(p.key), all = [...kw, ...words(p.label)];
    if (!all.some(isLfoToken)) return null;
    const isEnum = p.type === 'enum';
    let role: Role | null = null;
    if (isEnum && has(all, 'shape', 'wave', 'waveform', 'form', 'type') && isShapeEnum(p.options)) role = 'shape';
    else if (has(all, 'phase')) role = 'phase';
    else if (has(all, 'deform', 'symmetry')) role = 'deform';
    else if (isEnum && has(all, 'unipolar', 'bipolar', 'polar', 'polarity')) role = 'polarity';
    else if (has(all, 'retrig', 'retrigger', 'trigger', 'trigmode', 'keytrigger', 'keytrig')) role = 'retrig';
    else if (has(all, 'rate', 'speed', 'freq') || (isEnum && isDivisionEnum(p.options))) role = 'rate';
    else if (has(all, 'depth', 'magnitude', 'amount', 'amt', 'dpt')) role = 'depth';
    if (!role) return null;
    const qualifier = kw.filter(w => !ROLE_VOCAB.has(w) && !isBareLfo(w) && !LFO_NOISE.has(w)).join('');
    return { role, qualifier };
}

/* Explicit `lfo:` config tags → one group (config guarantees layout). */
function fromTags(params: (KnobParam | null)[]): LfoVizGroup[] {
    const at: Partial<Record<string, number>> = {};
    params.forEach((p, i) => {
        if (p?.lfo && at[p.lfo] === undefined) at[p.lfo] = i;
    });
    if (at.shape === undefined || at.phase === undefined) return [];
    return [{
        shape: at.shape, phase: at.phase,
        rate: at.rate ?? null, depth: at.depth ?? null, deform: at.deform ?? null,
        mode: at.mode ?? null, retrig: at.retrig ?? null,
        inferred: false, shapeOptions: null,
    }];
}

/* Name inference → one group per LFO qualifier that has a Shape. */
function fromNames(params: (KnobParam | null)[]): LfoVizGroup[] {
    const byQual = new Map<string, Partial<Record<Role, number>>>();
    params.forEach((p, i) => {
        if (!p) return;
        const c = classify(p);
        if (!c) return;
        const g = byQual.get(c.qualifier) ?? {};
        if (g[c.role] === undefined) { g[c.role] = i; byQual.set(c.qualifier, g); }
    });
    const out: LfoVizGroup[] = [];
    for (const g of byQual.values()) {
        if (g.shape === undefined) continue;
        const sp = params[g.shape];
        out.push({
            shape: g.shape,
            phase: g.phase ?? null, rate: g.rate ?? null, depth: g.depth ?? null,
            deform: g.deform ?? null, mode: g.polarity ?? null, retrig: g.retrig ?? null,
            inferred: true, shapeOptions: sp?.options ?? null,
        });
    }
    return out.sort((a, b) => a.shape - b.shape);
}

export function detectLfoViz(params: (KnobParam | null)[]): LfoVizGroup[] {
    const tagged = fromTags(params);
    return tagged.length ? tagged : fromNames(params);
}
