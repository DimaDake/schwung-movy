/* Low-cut / high-cut corner frequencies — the shelving pair that trims one or
 * both ends of a signal (reverb LoCut/HiCut, an HPF on a drum bus). A pair on a
 * page is seated on one line and drawn as a band-pass; a lone cut keeps its own
 * cell and draws just its corner.
 *
 * Distinct from filter-viz.ts, which is a cutoff+RESONANCE pair with a mode.
 * These have no resonance and no mode: the value IS the corner.
 * Pure: indices only, no rendering. */

import type { KnobParam } from '../types/param.js';

export type CutKind = 'lowcut' | 'highcut';

export interface CutGroup {
    lowcut: number | null;
    highcut: number | null;
}

/* "Low cut" removes LOWS → a high-pass corner, rising from the left.
 * "High cut" removes HIGHS → a low-pass corner, falling to the right. */
const LOWCUT_WORD  = /^(lowcut|locut|highpass|hipass|hpf|hp)$/;
const HIGHCUT_WORD = /^(highcut|hicut|lowpass|lopass|lpf|lp)$/;
const LOW  = new Set(['low', 'lo', 'bass']);
const HIGH = new Set(['high', 'hi', 'treble']);
const CUT  = new Set(['cut', 'cutoff', 'rolloff', 'roll']);
/* Words that mean the param is NOT a corner frequency:
 *   slope/db/poles — mono-voice's "HP Slope" is dB per octave, not a corner;
 *   mg/mod/env/... — aphex keys its filter MODULATION amounts hpf_mg/lpf_mg,
 *     which shape how something else moves the corner, not the corner itself;
 *   damp/gain/mix  — a tone or level control that merely mentions a band. */
const VETO = new Set([
    'slope', 'db', 'order', 'poles',
    'mg', 'mod', 'lfo', 'env', 'eg', 'depth', 'vel', 'key', 'track', 'kbd',
    'damp', 'damping', 'gain', 'level', 'mix', 'amount', 'amt',
    'res', 'reso', 'resonance', 'q',
]);

const words = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

export function cutKindOf(p: KnobParam): CutKind | null {
    if (p.type === 'enum' || p.type === 'file') return null;
    if (p.max <= p.min) return null;
    const ws = [...words(p.key), ...words(p.label)];
    if (ws.some((w) => VETO.has(w))) return null;
    for (const w of ws) {
        if (LOWCUT_WORD.test(w)) return 'lowcut';
        if (HIGHCUT_WORD.test(w)) return 'highcut';
    }
    /* Split spellings: "Low Cut", "Hi Cut". Needs a cut word AND exactly one
     * end named, so "Low/Mid Hz" (a crossover) never qualifies. */
    if (!ws.some((w) => CUT.has(w))) return null;
    const lo = ws.some((w) => LOW.has(w));
    const hi = ws.some((w) => HIGH.has(w));
    if (lo && !hi) return 'lowcut';
    if (hi && !lo) return 'highcut';
    return null;
}

/* The first low-cut and the first high-cut on a page, when BOTH are present —
 * that pair becomes one band-pass graphic. A lone cut is left for the per-cell
 * style, which needs no line of its own. */
export function detectCutPair(params: (KnobParam | null)[]): CutGroup[] {
    let lowcut: number | null = null;
    let highcut: number | null = null;
    params.forEach((p, i) => {
        if (!p) return;
        const k = cutKindOf(p);
        if (k === 'lowcut' && lowcut === null) lowcut = i;
        if (k === 'highcut' && highcut === null) highcut = i;
    });
    return (lowcut !== null && highcut !== null) ? [{ lowcut, highcut }] : [];
}
