import type { DrumConfig } from '../types/param.js';

export type PadScoping = NonNullable<DrumConfig['padScoping']>;

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Anchored matcher for a concrete-key template; `suffixPat` is a regex fragment
 * for the {suffix} position ("(.+)" to capture any, or an escaped literal). */
function templateRegex(tpl: string | undefined, padDigits: number | undefined, suffixPat: string): RegExp | null {
    if (!tpl || padDigits === undefined) return null;   // padKeys-only config
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
    /* An explicit per-pad key wins over any template: a module whose voices are
     * separate circuits names its params after the VOICE (bd_c_tune, ohh_pitch),
     * which no pad-number template can produce. See DrumConfig.padScoping. */
    const table = ps.padKeys?.[suffix];
    if (table && pad - 1 < table.length) {
        /* A listed null is a decision, not a gap: this voice has no such knob,
         * so the alias stays unresolved and the caller renders it unavailable.
         * Falling back to the template here would address a key the module
         * never had. */
        return table[pad - 1] ?? key;
    }
    const o = ps.suffixOverrides?.[suffix];
    const tpl = (o && (o.maxPad === undefined || pad <= o.maxPad))
        ? o.template : ps.concreteKeyTemplate;
    /* No template configured (a padKeys-only module, pad past the list): leave
     * the alias as-is — unavailable beats addressing another pad's param. */
    if (!tpl) return key;
    const padStr = String(pad).padStart(ps.padDigits ?? 0, '0');
    return tpl.replace('{pad}', padStr).replace('{suffix}', suffix);
}

/* Inverse of concreteKey: map a concrete pad key back to its alias form
 * (p07_pan → pad_pan), or null if `key` doesn't match the concrete template.
 * chain_params enumerates only the alias params, so validating a persisted
 * per-pad automation lane means reverse-mapping it to the alias and checking
 * THAT exists — the concrete key itself is never listed. Assumes the template
 * places {pad} before {suffix} (true for every config). An override template is
 * matched only against its own literal suffix, so foreign keys sharing the
 * shape (v3_lvl vs the fx1 override) can't false-match.
 *
 * padKeys entries are deliberately NOT reversed here. A template invents keys
 * the module never declares, so a lane on one can only be validated through its
 * alias; a padKeys entry IS a declared param (bd_c_tune is in chain_params), so
 * its lane validates by its own key. Mapping it back to `pad_pitch` — which the
 * module does not declare — would make every per-voice lane look stale and get
 * purged. */
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
