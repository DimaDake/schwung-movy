/* Filter-type (mode) vocabulary: normalizes an enum option string to a spectral
 * shape, decides whether an enum is a filter-mode picker (by its option words,
 * not its key — bare `mode` keys are ambiguous), and infers a static type from a
 * cutoff param's own name tokens when no mode enum exists. Pure string logic,
 * shared by the detector (filter-viz.ts) and the VM builder (filter-vm.ts). */

export type FilterMode = 'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'ap' | 'off';
const SPECTRAL = new Set<FilterMode>(['lp', 'hp', 'bp', 'notch', 'peak', 'ap']);

/* One option string → its filter shape, or null when it names no filter type.
 * Combined names ("HP+LP") read as band-pass; "BandStop" reads as a notch. */
export function normalizeFilterOption(opt: string): FilterMode | null {
    const s = opt.toLowerCase();
    const hasLP = /lowpass|low pass|\blp\b/.test(s);
    const hasHP = /highpass|high pass|\bhp\b/.test(s);
    if (hasLP && hasHP) return 'bp';                         // "HP+LP"
    if (/notch|bandstop|band stop/.test(s)) return 'notch';
    if (/bandpass|band pass|\bbpf?\b/.test(s)) return 'bp';
    if (hasHP) return 'hp';
    if (hasLP) return 'lp';
    if (/allpass|all ?pass|\bap\b/.test(s)) return 'ap';
    if (/peak|bell/.test(s)) return 'peak';
    if (/^\s*off\s*$/.test(s)) return 'off';
    return null;
}

/* True when an enum's options read as a filter-type picker: ≥2 spectral shapes
 * and ≥half its options normalize to a filter word. Guards bare `mode` keys
 * (ambiotica algorithms, On/Off toggles, clock divisions never qualify). */
export function isFilterModeEnum(options: string[] | null): boolean {
    if (!options || options.length === 0) return false;
    let spectral = 0, anyWord = 0;
    for (const o of options) {
        const m = normalizeFilterOption(o);
        if (m === null) continue;
        anyWord++;
        if (SPECTRAL.has(m)) spectral++;
    }
    return spectral >= 2 && anyWord * 2 >= options.length;
}

/* Selected option → its filter shape; unknown/off options fall back to LP so the
 * curve always draws something sensible. */
export function filterModeFromEnum(options: string[] | null, value: number): FilterMode {
    const opt = options?.[Math.round(value)];
    if (opt === undefined) return 'lp';
    const m = normalizeFilterOption(opt);
    return m && SPECTRAL.has(m) ? m : 'lp';
}

/* A dedicated 12/24 dB-style slope enum: ≥half its options carry a dB figure and
 * it is not itself a mode picker (surge bakes slope into the type name instead). */
export function isSlopeEnum(options: string[] | null): boolean {
    if (!options || options.length < 2 || isFilterModeEnum(options)) return false;
    return options.filter(o => /\d+\s*db/i.test(o)).length * 2 >= options.length;
}

/* 24 dB (steeper) → 1, else 0. */
export function slopeFromEnum(options: string[] | null, value: number): 0 | 1 {
    return /24/.test(options?.[Math.round(value)] ?? '') ? 1 : 0;
}

const HP_TOKENS = new Set(['hp', 'hpf', 'highpass', 'locut', 'lowcut']);
const LP_TOKENS = new Set(['lp', 'lpf', 'lowpass', 'hicut', 'highcut']);
const CUT_CTX   = new Set(['filter', 'cut', 'freq']);

/* Static filter type from a cutoff's own name tokens, when no mode enum exists.
 * "low cut"/"lo cut" = cut the lows = high-pass; "hi cut" = low-pass. A bare `bp`
 * needs filter context (bpf, or bp beside filter/cut/freq) so a dexed keyboard
 * breakpoint (op1_key_bp) never reads as band-pass. */
export function staticModeFromTokens(words: string[]): FilterMode | null {
    const w = new Set(words);
    const both = (a: string, b: string) => w.has(a) && w.has(b);
    if ([...HP_TOKENS].some(t => w.has(t)) || both('low', 'cut') || both('lo', 'cut')) return 'hp';
    if ([...LP_TOKENS].some(t => w.has(t)) || both('hi', 'cut') || both('high', 'cut')) return 'lp';
    if (w.has('bpf') || (w.has('bp') && [...CUT_CTX].some(t => w.has(t)))) return 'bp';
    return null;
}
