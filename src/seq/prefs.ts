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

type PrefsFile = { defaultQuant?: unknown; fileDirs?: unknown };

function readPrefs(): PrefsFile {
    if (typeof host_read_file !== 'function') return {};
    const raw = host_read_file(PREFS_PATH);
    if (!raw) return {};
    try {
        const obj = JSON.parse(raw) as unknown;
        return obj && typeof obj === 'object' ? obj as PrefsFile : {};
    } catch {
        return {};
    }
}

/* Read-modify-write. The file held exactly one setting when it was written
 * whole; now that unrelated preferences share it, saving one must not erase
 * the rest. Not cached — every caller here is a user gesture, and a stale cache
 * would outlive the file it mirrors. */
function writePrefs(patch: (p: PrefsFile) => void): void {
    const prefs = readPrefs();
    patch(prefs);
    safeWrite(PREFS_PATH, JSON.stringify(prefs));
}

export function readPrefDefaultQuant(): number {
    return clampPct(readPrefs().defaultQuant);
}

export function writePrefDefaultQuant(pct: number): void {
    writePrefs((p) => { p.defaultQuant = clampPct(pct); });
}

/* Bounded so a user who browses many modules cannot grow prefs.json without
 * limit; entries are re-inserted on write, so key order is recency and the
 * oldest fall off first. */
const MAX_FILE_DIRS = 64;

export function readPrefFileDir(key: string): string | null {
    const dirs = readPrefs().fileDirs;
    if (!dirs || typeof dirs !== 'object') return null;
    const v = (dirs as Record<string, unknown>)[key];
    return typeof v === 'string' && v !== '' ? v : null;
}

export function writePrefFileDir(key: string, dir: string): void {
    writePrefs((p) => {
        const src = p.fileDirs && typeof p.fileDirs === 'object'
            ? p.fileDirs as Record<string, unknown> : {};
        const dirs: Record<string, string> = {};
        for (const k in src) {
            if (k !== key && typeof src[k] === 'string') dirs[k] = src[k] as string;
        }
        dirs[key] = dir;
        const keys = Object.keys(dirs);
        for (let i = 0; i < keys.length - MAX_FILE_DIRS; i++) delete dirs[keys[i]];
        p.fileDirs = dirs;
    });
}
