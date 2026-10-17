/* Machine-level preferences — the one piece of movy state no set owns.
 *
 * Everything else movy persists is keyed by the active Move set's UUID. The
 * quantization default has to survive into a set that has never been opened
 * before, so it needs storage above that: this file sits one level up from
 * setsDir(), where the filesystem shows the distinction.
 *
 * Durability is deliberately far cheaper than seq-state's. That file gets
 * shadow rotation and a checksummed envelope because losing it loses the
 * user's music; losing this one loses a number they retype once. A verified
 * write is enough, and a read that fails falls back rather than throwing. */

import { safeWrite } from './persist-store.js';
import { platform } from '../platform/index.js';

export const PREFS_PATH = '/data/UserData/schwung/modules/tools/movy/prefs.json';

/* 0 %, not 100 %: movy has always recorded raw with quantize as a manual
 * press, so installing this release must change nothing until the user picks
 * a default of their own. */
export const FACTORY_DEFAULT_QUANT = 0;

const clampPct = (v: unknown): number =>
    typeof v === 'number' && isFinite(v)
        ? Math.max(0, Math.min(100, Math.round(v)))
        : FACTORY_DEFAULT_QUANT;

type PrefsFile = {
    defaultQuant?: unknown; fileDirs?: unknown; moduleBlacklist?: unknown;
    fullVelocity?: unknown; masterVolume?: unknown;
};

function readPrefs(): PrefsFile {
    const raw = platform.readFile(PREFS_PATH);
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

/* Full velocity (Shift+Step 10): every pad note leaves at 127.
 *
 * Machine-level, not per set, because it is about how this player plays — flat
 * fingers, a pad that reads light, drums that want no dynamics — and not about
 * one piece of music. A user who wants it wants it in every set, and wanted it
 * again after the reopen that used to silently clear it. */
export function readPrefFullVelocity(): boolean {
    return readPrefs().fullVelocity === true;
}

export function writePrefFullVelocity(on: boolean): void {
    writePrefs((p) => { p.fullVelocity = on; });
}

/* Master volume (the volume knob with no track held). Machine-
 * level, like the Move volume it replaces: it is how loud this box plays, not
 * part of a piece of music, so a Set must not carry it. -12 dB until the user
 * turns it: a first launch at unity would be the loudest moment the box has. */
export const FACTORY_MASTER_VOLUME = 0.2512;

export function readPrefMasterVolume(): number {
    const v = readPrefs().masterVolume;
    return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : FACTORY_MASTER_VOLUME;
}

export function writePrefMasterVolume(amp: number): void {
    writePrefs((p) => { p.masterVolume = Math.max(0, Math.min(1, amp)); });
}

/* Modules that must keep every instance on one render lane (chain_pin).
 *
 * A hazard list, not a setting: it is edited by hand in prefs.json when a
 * module is found to race, and has no UI. It ships empty because nothing has
 * been measured racing.
 *
 * Read only; there is deliberately no writer. A movy that could add to its own
 * hazard list would need to be sure a crash was that module's fault, and the
 * isolation canary is exactly the machinery that turned out not to be worth its
 * cost (2026-08-23-per-chain-module-isolation-plan.md). */
export function readPrefModuleBlacklist(): string[] {
    const raw = readPrefs().moduleBlacklist;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const v of raw) {
        // A comma would split one name into two on the wire — refuse rather
        // than silently blacklist a module nobody named.
        if (typeof v === 'string' && v !== '' && v.indexOf(',') < 0) out.push(v);
    }
    return out;
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
