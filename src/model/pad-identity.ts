/* The params that belong to one pad of a drum rack, with what the module
 * declares about each — the raw material for "what does this pad hold right
 * now" (a sample's path, a voice's algorithm or sound). Which of them actually
 * names a drum is the generators' call (ai/pad-labels.ts); this only finds a
 * pad's own keys, from the same three sources the rest of movy addresses a
 * pad by: the declared voice map, the declared concrete keys a pad scoping
 * resolves to, and the config's alias params made concrete for the pad. */

import type { ModelState } from './state.js';
import { aliasFromConcrete, concreteKey } from './pad-scope.js';

/* `alias` is the pad-scoped name the key was made from (`cv_algo` for
 * `pv3_algo`), null for a key that is the pad's own. */
export interface PadKeyDef { key: string; alias: string | null; type: string; options: string[] | null }

function defOf(s: ModelState, key: string, alias: string | null): PadKeyDef | null {
    const d = s.declared;
    for (const k of alias ? [key, alias] : [key]) {
        const m = d?.cp[k] ?? d?.defs[k];
        if (m && typeof m === 'object') {
            return { key, alias, type: String(m.type ?? ''), options: Array.isArray(m.options) ? m.options.map(String) : null };
        }
    }
    for (const bank of s.moduleConfig?.banks ?? []) {
        for (const row of bank.rows) for (const slot of row) {
            if (slot && (slot.key === key || slot.key === alias)) {
                return { key, alias, type: slot.type, options: slot.options ?? null };
            }
        }
    }
    return null;
}

/** Pad `pad`'s own params (1-based), each with its declared type and options. */
export function padKeyDefs(s: ModelState, pad: number): PadKeyDef[] {
    const cfg = s.drumConfig;
    if (!cfg || pad < 1 || pad > cfg.padCount) return [];
    const ps = cfg.padScoping;
    const keys = new Map<string, string | null>();
    for (const k of s.voiceKeys[pad - 1] ?? []) keys.set(k, null);
    if (ps) {
        const configKeys = (s.moduleConfig?.banks ?? []).flatMap((b) => b.rows.flat().map((x) => x?.key ?? ''));
        for (const k of [...(s.declared?.keys ?? []), ...configKeys]) {
            if (!k) continue;
            if (k.startsWith(ps.aliasPrefix)) {
                const c = concreteKey(ps, pad, k);
                if (c !== k) keys.set(c, k);
                continue;
            }
            const alias = aliasFromConcrete(ps, k);
            if (alias && concreteKey(ps, pad, alias) === k) keys.set(k, alias);
        }
    }
    const out: PadKeyDef[] = [];
    for (const [k, alias] of keys) {
        const d = defOf(s, k, alias);
        if (d) out.push(d);
    }
    return out;
}
