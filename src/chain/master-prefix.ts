/* The MASTER page's keys: movy's own master chain (`mfx:`, an engine-root key,
 * master_chain.rs). No imports: `config.ts` reads the prefix. */

export const MASTER_PREFIX = 'mfx:';

/** `fx1` out of `mfx:fx1`; null for anything else. */
export function masterSuffix(componentKey: string): string | null {
    return componentKey.startsWith(MASTER_PREFIX) ? componentKey.slice(MASTER_PREFIX.length) : null;
}
