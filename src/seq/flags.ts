/* Flag values: the in-memory copy, prefs.json, and the engine.
 *
 * Three places hold the same number and they are kept in step here rather than
 * at the call site, because the engine is the one that keeps forgetting: a
 * re-dlopened engine is a brand new one with default flags and no idea what the
 * page says. `applyFlagsToEngine` is therefore called on every engine boot, not
 * once at startup.
 *
 * Cached, unlike the rest of prefs.ts, because the page reads every value on
 * every rendered frame and prefs.ts deliberately does not cache. Loaded once,
 * then only ever written through `setFlag`, so the cache cannot outlive the
 * file it mirrors. */

import { FLAGS, FLAGS_REV, clampFlag, flagDef } from './flags-def.js';
import {
    readPrefFlags, writePrefFlag, readPrefModuleBlacklist,
    readPrefFlagsRev, writePrefFlagsRev,
} from './prefs.js';
import { mlog } from '../log.js';

/** How to write an engine param. Handed over by engine.ts rather than imported
 *  from it — same arrangement as `syncPadRoute`, and for the same reason: this
 *  module is read by the page, and importing the engine back would make the two
 *  mutually dependent. Null until the engine has answered once, which is also
 *  the truth: before that there is nothing to write to. */
type EngineSet = (key: string, value: string) => void;
let sendToEngine: EngineSet | null = null;

let values: Record<string, number> | null = null;

function ensure(): Record<string, number> {
    if (values) return values;
    const stored = readPrefFlags();
    /* A stored value normally wins — that is what a preference is. The one
     * exception is a flag whose shipped default has CHANGED since this file was
     * written: it is taken once, so a device that formed an opinion under the
     * old default still gets the new one. Without this the flag is on by
     * default only for someone who has never opened the page. */
    const rev = readPrefFlagsRev();
    const v: Record<string, number> = {};
    let adopted = 0;
    for (const f of FLAGS) {
        const superseded = f.revisedAt !== undefined && rev < f.revisedAt;
        if (f.key in stored && !superseded) {
            v[f.key] = clampFlag(f, stored[f.key]);
        } else {
            v[f.key] = f.def;
            if (superseded && f.key in stored && stored[f.key] !== f.def) adopted++;
        }
    }
    values = v;
    if (rev < FLAGS_REV) {
        /* Written back so the adoption happens exactly once — a user who then
         * turns it off again must keep it off. */
        for (const f of FLAGS) {
            if (f.revisedAt !== undefined && rev < f.revisedAt) writePrefFlag(f.key, v[f.key]);
        }
        writePrefFlagsRev(FLAGS_REV);
        if (adopted > 0) mlog('flags: adopted ' + adopted + ' new default(s) at rev ' + FLAGS_REV);
    }
    return v;
}

export function flagValue(key: string): number {
    const def = flagDef(key);
    if (!def) return 0;
    return ensure()[key];
}

/** Returns the value actually stored, which is the clamped one. */
export function setFlag(key: string, value: number): number {
    const def = flagDef(key);
    if (!def) return 0;
    const next = clampFlag(def, value);
    const v = ensure();
    if (v[key] === next) return next;
    v[key] = next;
    writePrefFlag(key, next);
    sendToEngine?.(key, String(next));
    return next;
}

/** Push every flag to a (possibly brand new) engine, and remember how to reach
 *  it. Called from the engine-ready branch on EVERY boot: a re-dlopened engine
 *  has default flags and no idea what the page says, so a page reading
 *  "Parallel Render ON" over a serial engine is exactly what this prevents. */
export function applyFlagsToEngine(set: EngineSet): void {
    sendToEngine = set;
    const v = ensure();
    /* Lanes before parallel: turning parallel on spawns the pool at whatever
     * lane count is current, and `set_lanes` rebuilds it. Sending them the
     * other way round spawns one pool and immediately replaces it — harmless,
     * but it blocks the audio thread twice for no reason. */
    for (const f of FLAGS) {
        if (f.key !== 'chparallel') set(f.key, String(v[f.key]));
    }
    /* The hazard list, before parallel render can act on it. Sent even when
     * empty: the engine replaces the list wholesale, so an empty write is how a
     * module removed from prefs.json stops being pinned. */
    set('chblock', readPrefModuleBlacklist().join(','));
    set('chparallel', String(v['chparallel']));
}

/** Drop the cache — the file is the truth again on the next read. */
export function resetFlags(): void {
    values = null;
    sendToEngine = null;
}
