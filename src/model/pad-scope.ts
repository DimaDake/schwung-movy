import type { DrumConfig } from '../types/param.js';

type PadScoping = NonNullable<DrumConfig['padScoping']>;

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
