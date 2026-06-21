import type { DrumConfig } from '../types/param.js';

export type PadScoping = NonNullable<DrumConfig['padScoping']>;

/* Build the concrete per-pad key for a pad-scoped alias (e.g. pad 3 + "pad_vol"
 * → "p03_vol"), so movy can address the focused pad directly instead of the
 * DSP-resolved alias. A key without the alias prefix, or no scoping config,
 * passes through unchanged. The format is fully data-driven (template + digits
 * from config) — no key-shape literal is baked in here. */
export function concreteKey(ps: PadScoping | undefined, pad: number, key: string): string {
    if (!ps || !key.startsWith(ps.aliasPrefix)) return key;
    const suffix = key.slice(ps.aliasPrefix.length);
    const padStr = String(pad).padStart(ps.padDigits, '0');
    return ps.concreteKeyTemplate.replace('{pad}', padStr).replace('{suffix}', suffix);
}

/* Inverse of concreteKey: map a concrete pad key back to its alias form
 * (p07_pan → pad_pan), or null if `key` doesn't match the concrete template.
 * chain_params enumerates only the alias params, so validating a persisted
 * per-pad automation lane means reverse-mapping it to the alias and checking
 * THAT exists — the concrete key itself is never listed. Assumes the template
 * places {pad} before {suffix} (true for every config). */
export function aliasFromConcrete(ps: PadScoping | undefined, key: string): string | null {
    if (!ps) return null;
    const padIdx = ps.concreteKeyTemplate.indexOf('{pad}');
    const sufIdx = ps.concreteKeyTemplate.indexOf('{suffix}');
    if (padIdx < 0 || sufIdx < 0) return null;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pre  = esc(ps.concreteKeyTemplate.slice(0, padIdx));
    const mid  = esc(ps.concreteKeyTemplate.slice(padIdx + 5, sufIdx));
    const post = esc(ps.concreteKeyTemplate.slice(sufIdx + 8));
    const m = new RegExp('^' + pre + '\\d{' + ps.padDigits + '}' + mid + '(.+)' + post + '$').exec(key);
    return m ? ps.aliasPrefix + m[1] : null;
}
