/* The LFO half of a movy-hosted chain's saved state.
 *
 * A host track's LFOs belong to schwung's slot and ride Move's own set file. A
 * movy track's live in the chain instance movy created, and no component's
 * `:state` blob carries them — so without this they were gone the moment the
 * tool closed, and an assignment appeared to work right up until you left.
 *
 * The read is folded into the batch `chain-persist` already issues per track, so
 * this costs no extra round trip; the write is one `setMany`. */

import type { TrackPort } from './port.js';

/* Every field the chain host accepts under `lfoN:` (chain_host.c), minus
 * `active`, which it derives from target+param and refuses to be told. */
const LFO_KEYS = [
    'enabled', 'shape', 'sync', 'rate_hz', 'rate_div',
    'depth', 'polarity', 'phase_offset', 'target', 'target_param', 'retrigger',
] as const;

const LFO_COUNT = 2;

/** `lfo1:depth`, `lfo2:target`, … in a fixed order both directions agree on. */
export function lfoStateKeys(): string[] {
    const keys: string[] = [];
    for (let i = 1; i <= LFO_COUNT; i++) for (const k of LFO_KEYS) keys.push('lfo' + i + ':' + k);
    return keys;
}

/** Values positionally matching `lfoStateKeys()`, or null when this track's LFOs
 *  are both idle — an untouched track writes nothing into the set file. */
export function packLfoState(values: (string | null)[]): string[] | null {
    if (values.length !== lfoStateKeys().length) return null;
    const keys = lfoStateKeys();
    const used = keys.some((k, i) => {
        const v = values[i];
        if (v === null || v === '') return false;
        if (k.endsWith(':target') || k.endsWith(':target_param')) return true;
        return k.endsWith(':enabled') && v !== '0';
    });
    if (!used) return null;
    return values.map((v) => v ?? '');
}

/** Write a packed snapshot back. Call AFTER the track's modules are requested:
 *  a target only binds to a param whose module is on its way in. */
export function restoreLfoState(port: TrackPort, saved: unknown): boolean {
    if (!Array.isArray(saved)) return false;
    const keys = lfoStateKeys();
    if (saved.length !== keys.length) return false;
    const pairs: [string, string][] = [];
    for (let i = 0; i < keys.length; i++) {
        const v = saved[i];
        if (typeof v !== 'string') return false;
        pairs.push([keys[i], v]);
    }
    return port.setMany(pairs);
}
