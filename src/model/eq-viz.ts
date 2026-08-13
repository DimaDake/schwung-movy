/* Detects an EQ band group on a page: two or three gain knobs naming low/mid/
 * high under one qualifier, which page-layout.ts then seats on a single line in
 * frequency order so the response curve can be drawn across them — the EQ
 * analogue of the envelope and filter groups.
 * Pure: indices only, no rendering. Live values resolve in eq-vm.ts. */

import type { KnobParam } from '../types/param.js';

export type EqBand = 'low' | 'mid' | 'high';
export const EQ_BANDS: EqBand[] = ['low', 'mid', 'high'];

export interface EqGroup {
    low: number | null;
    mid: number | null;
    high: number | null;
    bands: EqBand[];      // present bands, low→high
}

const BAND: Record<string, EqBand> = {
    low: 'low', lows: 'low', lo: 'low', bass: 'low', bottom: 'low',
    mid: 'mid', mids: 'mid', middle: 'mid', body: 'mid',
    high: 'high', highs: 'high', hi: 'high', treble: 'high', top: 'high', air: 'high',
};
/* A cutoff or crossover is a FREQUENCY, not a band gain: "Low Cut" removes
 * lows rather than boosting them, and dragonfly-hall's low_xo/high_xo set where
 * the bands meet. Both would draw an EQ curve that means nothing. */
const NOT_A_BAND = /^(cut|cutoff|pass|filter|freq|frequency|xo|xover|crossover|shelf|hz|khz|q|res|reso|resonance)$/;
const GAINY = new Set(['gain', 'level', 'lvl', 'boost', 'trim', 'eq', 'db', 'amount', 'amt', 'vol']);
/* Prefixes accepted ONLY when glued to a gain word. OTT-X keys its three bands
 * lgain/mgain/hgain, so each key token became a different qualifier and the
 * group never formed. A bare 'l'/'m'/'h' is far too loose to be a band on its
 * own; 'l' + 'gain' is not. */
const GLUED: Record<string, EqBand> = {
    l: 'low', lo: 'low', low: 'low',
    m: 'mid', mid: 'mid',
    h: 'high', hi: 'high', high: 'high',
};

const words = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/* An EQ band gain is a boost/cut in dB: bipolar and roughly symmetric about
 * zero. That one test rejects every false positive the words let through —
 * crossover frequencies (200..1200), per-band Q (0.3..8) and branchage's random
 * low/high BOUNDS (0..127) are all unipolar. */
function isGainRange(p: KnobParam): boolean {
    if (p.type === 'enum' || p.type === 'file') return false;
    if (!(p.min < 0 && p.max > 0)) return false;
    return Math.abs(Math.abs(p.min) - Math.abs(p.max)) <= 0.51 * Math.abs(p.max);
}

function bandOf(p: KnobParam): { band: EqBand; qualifier: string } | null {
    if (!isGainRange(p)) return null;
    const ws = [...words(p.key), ...words(p.label)];
    if (ws.some((w) => NOT_A_BAND.test(w))) return null;
    const hits = new Set<EqBand>();
    const glued = new Set<string>();
    for (const w of ws) {
        if (BAND[w]) { hits.add(BAND[w]); continue; }
        for (const pre of Object.keys(GLUED)) {
            if (w.length > pre.length && w.startsWith(pre) && GAINY.has(w.slice(pre.length))) {
                hits.add(GLUED[pre]); glued.add(w); break;
            }
        }
    }
    /* Two band words in one name means it spans them ("Low/Mid Hz") — not a
     * single band's gain. */
    if (hits.size !== 1) return null;
    const qualifier = ws.filter((w) => !BAND[w] && !GAINY.has(w) && !glued.has(w)).join('');
    return { band: [...hits][0], qualifier };
}

export function detectEqViz(params: (KnobParam | null)[]): EqGroup[] {
    const byQual = new Map<string, Partial<Record<EqBand, number>>>();
    params.forEach((p, i) => {
        if (!p) return;
        const b = bandOf(p);
        if (!b) return;
        const g = byQual.get(b.qualifier) ?? {};
        if (g[b.band] === undefined) { g[b.band] = i; byQual.set(b.qualifier, g); }
    });
    const out: EqGroup[] = [];
    for (const g of byQual.values()) {
        const bands = EQ_BANDS.filter((b) => g[b] !== undefined);
        /* One band is just a knob — a curve needs at least two points to say
         * anything about the balance between them. */
        if (bands.length < 2) continue;
        out.push({ low: g.low ?? null, mid: g.mid ?? null, high: g.high ?? null, bands });
    }
    return out.sort((a, b) => {
        const ai = Math.min(...a.bands.map((x) => a[x] as number));
        const bi = Math.min(...b.bands.map((x) => b[x] as number));
        return ai - bi;
    });
}
