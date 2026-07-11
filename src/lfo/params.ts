/* LFO parameter model: names, ranges, target-list builder, and formatters for
 * the two schwung slot LFOs surfaced on movy's track-chain LFO page. Kept pure
 * (only reads shadow_get_param) so it is unit-testable and shared by the model
 * and the render/scene code. */

export const LFO_SHAPES = ['Sine', 'Tri', 'Saw', 'Square', 'S&H', 'Swishy'];

/* 27-entry division table, exact order/labels from schwung's lfo_common.h. */
export const LFO_DIVISIONS = [
    '16bar', '15bar', '14bar', '13bar', '12bar', '11bar', '10bar', '9bar',
    '8bar', '7bar', '6bar', '5bar', '4bar', '3bar', '2bar',
    '1/1', '1/1T', '1/2', '1/2T', '1/4', '1/4T', '1/8', '1/8T',
    '1/16', '1/16T', '1/32', '1/32T',
];

export const RATE_HZ_MIN = 0.1;
export const RATE_HZ_MAX = 20.0;
/* ~40 detents span 0.1–20 Hz multiplicatively (≈1.14×/detent): fine at low Hz,
 * coarse at high — perceptually even, so the knob is usable across the range. */
export const RATE_HZ_FACTOR = Math.pow(RATE_HZ_MAX / RATE_HZ_MIN, 1 / 40);

export const LFO_BANK_COUNT = 2;

export function lfoPrefix(lfoIdx: number): string { return 'lfo' + (lfoIdx + 1) + ':'; }

/* Short display tag for a target component (matches the schwung-side idea of a
 * compact component label). */
export function compLabel(target: string): string {
    switch (target) {
        case 'synth':    return 'Syn';
        case 'fx1':      return 'FX1';
        case 'fx2':      return 'FX2';
        case 'midi_fx1': return 'MF1';
        case 'midi_fx2': return 'MF2';
        case 'lfo1':     return 'LFO1';
        case 'lfo2':     return 'LFO2';
        default:         return target.slice(0, 4);
    }
}

/* Components whose params an LFO can target, in display order. */
const TARGET_COMPONENTS = ['synth', 'fx1', 'fx2', 'midi_fx1', 'midi_fx2'];

export interface TargetOption {
    label:  string;          // shortened "Syn:Cutoff" (or "None")
    target: string | null;   // component key, or null for None
    param:  string | null;   // param key, or null
}

/* "Comp:Param" shortened toward ~11 chars for the enum box; the overlay has
 * room for more but we keep one form. Param name is trimmed of whitespace and
 * truncated (the component tag is already short). */
export function shortenTarget(compTag: string, paramName: string): string {
    const maxParam = Math.max(1, 11 - compTag.length - 1); // 1 for ':'
    let p = paramName.replace(/\s+/g, '');
    if (p.length > maxParam) p = p.slice(0, maxParam);
    return compTag + ':' + p;
}

/* Flat target list for `lfoIdx` on `track`: None, then each loaded component's
 * float/int/enum chain_params (schwung's own modulatable filter), then the
 * other LFO's modulatable params. Rebuilt each time the overlay opens so it
 * always reflects currently-loaded modules. */
export function buildTargetOptions(track: number, lfoIdx: number): TargetOption[] {
    const opts: TargetOption[] = [{ label: 'None', target: null, param: null }];
    for (const comp of TARGET_COMPONENTS) {
        const raw = shadow_get_param(track, comp + ':chain_params');
        if (!raw) continue;
        let arr: Array<{ key?: string; name?: string; label?: string; type?: string }>;
        try { arr = JSON.parse(raw); } catch { continue; }
        for (const p of arr) {
            if (!p.key) continue;
            if (p.type !== 'float' && p.type !== 'int' && p.type !== 'enum') continue;
            opts.push({ label: shortenTarget(compLabel(comp), p.name || p.label || p.key), target: comp, param: p.key });
        }
    }
    const otherIdx = lfoIdx === 0 ? 1 : 0;
    const otherKey = 'lfo' + (otherIdx + 1);
    for (const [key, name] of [['depth', 'Depth'], ['rate_hz', 'Rate'], ['phase_offset', 'Phase']] as const) {
        opts.push({ label: shortenTarget(compLabel(otherKey), name), target: otherKey, param: key });
    }
    return opts;
}

/* Option index matching the stored target/param (0 = None / unmatched). */
export function targetIndex(opts: TargetOption[], target: string, param: string): number {
    if (!target) return 0;
    const i = opts.findIndex(o => o.target === target && o.param === param);
    return i >= 0 ? i : 0;
}

export function formatDepth(v: number): string {
    const pct = Math.round(v * 100);
    return (pct > 0 ? '+' : '') + pct + '%';
}

export function formatPhase(v: number): string {
    return Math.round(v * 360) + '°';
}
