import type { DrumConfig } from '../types/param.js';

export type PadScoping = NonNullable<DrumConfig['padScoping']>;

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Anchored matcher for a concrete-key template; `suffixPat` is a regex fragment
 * for the {suffix} position ("(.+)" to capture any, or an escaped literal). */
function templateRegex(tpl: string, padDigits: number, suffixPat: string): RegExp | null {
    const padIdx = tpl.indexOf('{pad}');
    const sufIdx = tpl.indexOf('{suffix}');
    if (padIdx < 0 || sufIdx < 0) return null;
    const pre  = escRe(tpl.slice(0, padIdx));
    const mid  = escRe(tpl.slice(padIdx + 5, sufIdx));
    const post = escRe(tpl.slice(sufIdx + 8));
    return new RegExp('^' + pre + '\\d{' + padDigits + '}' + mid + suffixPat + post + '$');
}

/* Build the concrete per-pad key for a pad-scoped alias (e.g. pad 3 + "pad_vol"
 * → "p03_vol"), so movy can address the focused pad directly instead of the
 * DSP-resolved alias. A key without the alias prefix, or no scoping config,
 * passes through unchanged. The format is fully data-driven (template + digits
 * from config) — no key-shape literal is baked in here. A suffixOverrides entry
 * substitutes its own template within its pad bound (see DrumConfig). */
export function concreteKey(ps: PadScoping | undefined, pad: number, key: string): string {
    if (!ps || !key.startsWith(ps.aliasPrefix)) return key;
    const suffix = key.slice(ps.aliasPrefix.length);
    const o = ps.suffixOverrides?.[suffix];
    const tpl = (o && (o.maxPad === undefined || pad <= o.maxPad))
        ? o.template : ps.concreteKeyTemplate;
    const padStr = String(pad).padStart(ps.padDigits, '0');
    return tpl.replace('{pad}', padStr).replace('{suffix}', suffix);
}

/* Inverse of concreteKey: map a concrete pad key back to its alias form
 * (p07_pan → pad_pan), or null if `key` doesn't match the concrete template.
 * chain_params enumerates only the alias params, so validating a persisted
 * per-pad automation lane means reverse-mapping it to the alias and checking
 * THAT exists — the concrete key itself is never listed. Assumes the template
 * places {pad} before {suffix} (true for every config). An override template is
 * matched only against its own literal suffix, so foreign keys sharing the
 * shape (v3_lvl vs the fx1 override) can't false-match. */
export function aliasFromConcrete(ps: PadScoping | undefined, key: string): string | null {
    if (!ps) return null;
    const m = templateRegex(ps.concreteKeyTemplate, ps.padDigits, '(.+)')?.exec(key);
    if (m) return ps.aliasPrefix + m[1];
    for (const suffix in ps.suffixOverrides ?? {}) {
        const o = ps.suffixOverrides![suffix];
        if (templateRegex(o.template, ps.padDigits, escRe(suffix))?.test(key)) {
            return ps.aliasPrefix + suffix;
        }
    }
    return null;
}
