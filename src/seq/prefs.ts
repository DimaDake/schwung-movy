/* Machine-level preferences — the one piece of movy state no set owns.
 *
 * Everything else movy persists is keyed by the active Move set's UUID. The
 * quantization default has to survive into a set that has never been opened
 * before, so it needs storage above that: this file sits one level up from
 * SETS_DIR, where the filesystem shows the distinction.
 *
 * Durability is deliberately far cheaper than seq-state's. That file gets
 * shadow rotation and a checksummed envelope because losing it loses the
 * user's music; losing this one loses a number they retype once. A verified
 * write is enough, and a read that fails falls back rather than throwing. */

import { safeWrite } from './persist-store.js';

export const PREFS_PATH = '/data/UserData/schwung/modules/tools/movy/prefs.json';

/* 0 %, not 100 %: movy has always recorded raw with quantize as a manual
 * press, so installing this release must change nothing until the user picks
 * a default of their own. */
export const FACTORY_DEFAULT_QUANT = 0;

const clampPct = (v: unknown): number =>
    typeof v === 'number' && isFinite(v)
        ? Math.max(0, Math.min(100, Math.round(v)))
        : FACTORY_DEFAULT_QUANT;

export function readPrefDefaultQuant(): number {
    if (typeof host_read_file !== 'function') return FACTORY_DEFAULT_QUANT;
    const raw = host_read_file(PREFS_PATH);
    if (!raw) return FACTORY_DEFAULT_QUANT;
    try {
        return clampPct(JSON.parse(raw).defaultQuant);
    } catch {
        return FACTORY_DEFAULT_QUANT;
    }
}

export function writePrefDefaultQuant(pct: number): void {
    safeWrite(PREFS_PATH, JSON.stringify({ defaultQuant: clampPct(pct) }));
}
