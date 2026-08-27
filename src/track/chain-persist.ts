/* Saving and restoring the chains movy hosts itself.
 *
 * A host track's chain is schwung's — Move's own set file carries it. A movy
 * track's chain exists only inside movy's engine, so if movy does not write it
 * down it is gone on the next open. This is that write-down.
 *
 * Two things per component: the module id, and the module's own opaque preset
 * blob. Restoring writes the id first and the blob second — the engine keeps
 * them ordered internally (the blob rides the queued load), so the blob can
 * never land on a slot whose module has not arrived yet.
 *
 * COST: reads are one engine round trip per key and a round trip blocks ~3-5 ms,
 * so `capture` reads only components that actually hold a module — a set with
 * no movy chains costs one batched read, not sixty. */

import { CHAIN_SLOTS, isLfoSlot, moduleReadKey } from '../chain/config.js';
import { TRACK_COUNT, chainInstance, trackKind } from './ref.js';
import { portFor } from './registry.js';
import { lfoStateKeys, packLfoState, restoreLfoState } from './lfo-persist.js';

export interface ChainComponentState {
    /** Component key: "synth", "fx1", … */
    c: string;
    /** Module id. */
    m: string;
    /** Module-preset blob, omitted when the module publishes none. */
    s?: string;
}

export interface ChainTrackState {
    /** Track index (4-15). Stored rather than implied by position so a partial
     *  save stays readable and a future TRACK_COUNT change cannot shift it. */
    t: number;
    comp: ChainComponentState[];
    /** The chain's two LFOs, positional per `lfoStateKeys()`. Absent when both
     *  are idle. */
    lfo?: string[];
}

/* The chain components worth persisting: every real slot, minus the virtual LFO
 * page (it has no module of its own). */
function persistableComponents(): string[] {
    return CHAIN_SLOTS.filter((_, i) => !isLfoSlot(i)).map((s) => s.componentKey);
}

/** Read every movy-hosted chain that has something loaded. */
export function captureChains(): ChainTrackState[] {
    const out: ChainTrackState[] = [];
    const comps = persistableComponents();

    /* From 0, not HOST_TRACKS: with `chtracks` on, tracks 0-3 are movy chains
     * too, and their modules exist only inside movy's engine — nothing else
     * writes them down. The `trackKind` test below is what actually excludes
     * them when the flag is off. */
    for (let t = 0; t < TRACK_COUNT; t++) {
        if (trackKind(t) !== 'movy') continue;
        const port = portFor(t);
        /* One batched read for the whole track: MovyChainPort collapses these
         * into a single bulk round trip, so an empty track costs one IPC. */
        const ids = port.getMany(comps.map((c) => moduleReadKey(c)));
        const loaded: { c: string; m: string }[] = [];
        comps.forEach((c, i) => {
            const id = ids[i];
            if (id) loaded.push({ c, m: id });
        });
        if (loaded.length === 0) continue;

        /* Only now, for components that actually hold a module, ask for blobs —
         * and let the LFO keys ride that same batch. An LFO can only target a
         * loaded module, so a track with nothing loaded has no LFO worth reading
         * and keeps costing exactly one round trip. */
        const lfoKeys = lfoStateKeys();
        const tail = port.getMany([...loaded.map((l) => l.c + ':state'), ...lfoKeys]);
        const blobs = tail.slice(0, loaded.length);
        const lfo = packLfoState(tail.slice(loaded.length));
        const track: ChainTrackState = {
            t,
            comp: loaded.map((l, i) => (blobs[i] ? { ...l, s: blobs[i]! } : l)),
        };
        if (lfo) track.lfo = lfo;
        out.push(track);
    }
    return out;
}

/* What the incoming Set wants loaded, as "<track>|<component>" -> module id. */
function wantedModules(saved: ChainTrackState[] | undefined | null): Map<string, string> {
    const want = new Map<string, string>();
    if (!Array.isArray(saved)) return want;
    for (const track of saved) {
        if (!track || typeof track.t !== 'number' || !Array.isArray(track.comp)) continue;
        for (const c of track.comp) {
            if (c && typeof c.c === 'string' && typeof c.m === 'string' && c.m !== '')
                want.set(track.t + '|' + c.c, c.m);
        }
    }
    return want;
}

/** Unload every movy-hosted component the incoming Set does not want.
 *
 *  schwung does this on every set change and calls it pass 1: clear all the
 *  slots, THEN load the new set's (shadow_ui.js, SET_CHANGED). movy had no
 *  pass 1 at all — `restoreChains` only ever loads — so a module stayed loaded
 *  across every switch, followed the user into a Set that had never held it,
 *  and was then written into that Set's own state on the next autosave.
 *
 *  A component both Sets want is left ALONE rather than cleared and reloaded:
 *  writing `<component>:module` tears the old one down and dlopens the new,
 *  and schwung's own note on this (`shadow_slot_clear_all_modules`) is that a
 *  full chain teardown is materially expensive and has caused audio dropouts.
 *  Doing it to arrive back where we started is exactly the cost worth skipping.
 *
 *  Returns the number of components cleared. */
export function clearChainsNotIn(saved: ChainTrackState[] | undefined | null): number {
    const want = wantedModules(saved);
    const comps = persistableComponents();
    let cleared = 0;

    for (let t = 0; t < TRACK_COUNT; t++) {
        if (trackKind(t) !== 'movy') continue;
        const port = portFor(t);
        /* One batched read per track, the same shape `captureChains` uses: an
         * empty track costs a single round trip, so a Set with no movy chains
         * pays almost nothing to switch away from. */
        const ids = port.getMany(comps.map((c) => moduleReadKey(c)));
        comps.forEach((c, i) => {
            const id = ids[i];
            if (!id) return;                          // already empty
            if (want.get(t + '|' + c) === id) return; // the new Set wants this one
            /* The empty string is schwung's own teardown value — the same one
             * `shadow_slot_clear_all_modules` writes, and the one movy's undo
             * writes to restore a slot that used to be empty. */
            port.setParam(c + ':module', '');
            cleared++;
        });
    }
    return cleared;
}

/** Write the chains back. Safe to call with anything `captureChains` produced,
 *  including from an older build — unknown tracks and components are skipped
 *  rather than trusted. */
export function restoreChains(saved: ChainTrackState[] | undefined | null): number {
    if (!Array.isArray(saved)) return 0;
    const known = new Set(persistableComponents());
    let restored = 0;

    for (const track of saved) {
        const t = track?.t;
        if (typeof t !== 'number' || t < 0 || t >= TRACK_COUNT) continue;
        /* The real gate, and the only one since `chtracks`: tracks 0-3 have a
         * chain when the flag is on and none when it is off. A set saved with
         * it on and reopened with it off leaves those entries on disk, so
         * turning it back on finds them again. */
        if (chainInstance(t) < 0) continue;
        if (!Array.isArray(track.comp)) continue;
        const port = portFor(t);

        for (const c of track.comp) {
            if (!c || typeof c.c !== 'string' || typeof c.m !== 'string') continue;
            if (!known.has(c.c) || c.m === '') continue;
            port.setParam(c.c + ':module', c.m);
            /* Written second on purpose. The engine attaches it to the queued
             * load, so ordering holds even though the load itself is deferred to
             * a later audio callback. */
            if (typeof c.s === 'string' && c.s !== '') {
                port.setParam(c.c + ':state', c.s);
            }
            restored++;
        }

        /* Last: an LFO target names a param on a module, so the module has to be
         * on its way in before the target can bind to anything. */
        restoreLfoState(port, track.lfo);
    }
    return restored;
}
