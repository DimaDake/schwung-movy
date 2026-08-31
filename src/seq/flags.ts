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

import { FLAGS, FLAGS_REV, clampFlag, flagDef, resolveHost } from './flags-def.js';
import {
    readPrefFlags, writePrefFlag, readPrefModuleBlacklist,
    readPrefFlagsRev, writePrefFlagsRev,
} from './prefs.js';
import { markUiStateDirty } from './ui-dirty.js';
import { mlog } from '../log.js';

/** How to write an engine param. Handed over by engine.ts rather than imported
 *  from it — same arrangement as `syncPadRoute`, and for the same reason: this
 *  module is read by the page, and importing the engine back would make the two
 *  mutually dependent. Null until the engine has answered once, which is also
 *  the truth: before that there is nothing to write to. */
type EngineSet = (key: string, value: string) => void;
let sendToEngine: EngineSet | null = null;

let values: Record<string, number> | null = null;

/* The SET's half of the store. A `perSet` flag is not a preference about this
 * Move — it is part of the set, and it travels with it. */
let perSet: Record<string, number> | null = null;

/* Before any set has been loaded there is nothing to defer to, so a per-set flag
 * reads as it would in a set that predates it — the conservative answer, and the
 * behaviour movy had before the flag existed. `{}` rather than `null` is what
 * says that: `null` means "a Set movy has never seen", which is new work and
 * takes the shipped default. Boot is neither. */
function ensurePerSet(): Record<string, number> {
    if (!perSet) perSet = perSetFlagsFrom({});
    return perSet;
}

/** What the per-set flags are, given `o` — the `flags` object out of a set's
 *  ui-state blob, or null for a set movy has never seen.
 *
 *  Pure, because the answer is needed BEFORE it is adopted: moving tracks 1-4
 *  between hosts has to release what is sounding while the old ports still
 *  resolve (`track/host-mode.ts`). */
export function perSetFlagsFrom(o: Record<string, unknown> | null): Record<string, number> {
    const v: Record<string, number> = {};
    for (const f of FLAGS) {
        if (!f.perSet) continue;
        if (o && typeof o[f.key] === 'number') v[f.key] = clampFlag(f, o[f.key] as number);
        /* No object at all is a set movy has never seen: new work, so the
         * shipped default. An object WITHOUT the key is a set saved before the
         * field existed, and it keeps behaving as it did. */
        else if (o) v[f.key] = f.legacy !== undefined ? f.legacy : f.def;
        else v[f.key] = f.def;
    }
    return v;
}

/** Adopt the incoming set's per-set flags. Callers that move tracks between
 *  hosts must go through `track/host-mode.ts`, which orders this against the
 *  note-offs it invalidates. */
export function loadPerSetFlags(o: Record<string, unknown> | null): void {
    perSet = perSetFlagsFrom(o);
}

/** What `serializeUiState` writes into the set. */
export function perSetFlagsSnapshot(): Record<string, number> {
    const v = ensurePerSet();
    const out: Record<string, number> = {};
    for (const f of FLAGS) if (f.perSet) out[f.key] = v[f.key];
    return out;
}

/* What the ENGINE is told, which is not always what the page says.
 *
 * `cpuopt` is one switch over the whole render optimisation: the engine has no
 * such param, so it is pushed as its effect on the two flags that do. And
 * `chtracks` is a three-value MODE up here but a routing decision down there —
 * `drain_out` sends a sequenced note out as MIDI or into a chain, and a 2 would
 * be neither. */
function engineValue(key: string): number {
    const v = ensure();
    if (key === 'chparallel' || key === 'chidle') return v['cpuopt'] > 0 ? v[key] : 0;
    if (key === 'chtracks') return resolveHost(v['chtracks'], ensurePerSet()['chtrackset']) ? 1 : 0;
    return v[key];
}

function push(key: string): void {
    sendToEngine?.(key, String(engineValue(key)));
}

/** Re-push one engine key. `host-mode.ts` uses it after a per-set value moved
 *  the resolved host: the flag that changed is `uiOnly`, but its effect is not. */
export function pushFlagToEngine(key: string): void {
    push(key);
}

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
    return def.perSet ? ensurePerSet()[key] : ensure()[key];
}

/** Returns the value actually stored, which is the clamped one. */
export function setFlag(key: string, value: number): number {
    const def = flagDef(key);
    if (!def) return 0;
    const next = clampFlag(def, value);
    if (def.perSet) {
        const p = ensurePerSet();
        if (p[key] === next) return next;
        p[key] = next;
        /* It rides the set's own blob, so the SET is what became dirty. */
        markUiStateDirty();
        return next;
    }
    const v = ensure();
    if (v[key] === next) return next;
    v[key] = next;
    writePrefFlag(key, next);
    /* The master reaches the engine only through the two flags it gates, so
     * moving it has to re-push those — otherwise the switch does nothing until
     * the next engine boot. */
    if (key === 'cpuopt') { push('chparallel'); push('chidle'); }
    else if (!def.uiOnly) push(key);
    return next;
}

/** Push every flag to a (possibly brand new) engine, and remember how to reach
 *  it. Called from the engine-ready branch on EVERY boot: a re-dlopened engine
 *  has default flags and no idea what the page says, so a page reading
 *  "Parallel Render ON" over a serial engine is exactly what this prevents. */
export function applyFlagsToEngine(set: EngineSet): void {
    sendToEngine = set;
    ensure();
    /* Lanes before parallel: turning parallel on spawns the pool at whatever
     * lane count is current, and `set_lanes` rebuilds it. Sending them the
     * other way round spawns one pool and immediately replaces it — harmless,
     * but it blocks the audio thread twice for no reason. */
    for (const f of FLAGS) {
        if (f.uiOnly || f.key === 'chparallel') continue;
        push(f.key);
    }
    /* The hazard list, before parallel render can act on it. Sent even when
     * empty: the engine replaces the list wholesale, so an empty write is how a
     * module removed from prefs.json stops being pinned. */
    set('chblock', readPrefModuleBlacklist().join(','));
    push('chparallel');
}

/** Drop the cache — the file is the truth again on the next read. */
export function resetFlags(): void {
    values = null;
    perSet = null;
    sendToEngine = null;
}
