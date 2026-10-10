/* Whose master the MASTER page's FX and LFO slots drive (design §5.3 of
 * docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md):
 * schwung's (`master_fx:`, behind a shadow slot) or movy's own (`mfx:`, behind
 * the engine root). The same key layout under two prefixes, so binding is a
 * prefix swap — `master-binding.ts` makes it, once at init, before any model
 * is built over these keys. No imports: `config.ts` reads the prefixes. */

export const SHIM_MASTER_PREFIX = 'master_fx:';
export const MOVY_MASTER_PREFIX = 'mfx:';
let bound = SHIM_MASTER_PREFIX;

export function masterPrefix(): string { return bound; }

export function setMasterPrefix(prefix: string): void { bound = prefix; }

/** `fx1` out of `master_fx:fx1` or `mfx:fx1`; null for anything else. */
export function masterSuffix(componentKey: string): string | null {
    if (componentKey.startsWith(SHIM_MASTER_PREFIX)) return componentKey.slice(SHIM_MASTER_PREFIX.length);
    if (componentKey.startsWith(MOVY_MASTER_PREFIX)) return componentKey.slice(MOVY_MASTER_PREFIX.length);
    return null;
}
