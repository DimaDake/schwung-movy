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
import { HOST_TRACKS, TRACK_COUNT, chainInstance, trackKind } from './ref.js';
import { portFor } from './registry.js';

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

    for (let t = HOST_TRACKS; t < TRACK_COUNT; t++) {
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

        /* Only now, for components that actually hold a module, ask for blobs. */
        const blobs = port.getMany(loaded.map((l) => l.c + ':state'));
        out.push({
            t,
            comp: loaded.map((l, i) => (blobs[i] ? { ...l, s: blobs[i]! } : l)),
        });
    }
    return out;
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
        if (typeof t !== 'number' || t < HOST_TRACKS || t >= TRACK_COUNT) continue;
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
    }
    return restored;
}
