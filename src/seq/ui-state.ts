/* The per-set UI-only state: tonic, scale, mode, pad layout, per-track octave
 * and track mutes. Kept apart from the engine's own serialization because the
 * engine knows nothing about any of it — it is ferried in its own JSON file
 * alongside the state blob. */

import { TRACK_COUNT } from '../track/ref.js';
import { captureChains, readChainDoc, restoreChains } from '../track/chain-persist.js';
import { captureSends } from '../track/send-persist.js';
import { parseMirror } from '../track/chain-mirror.js';
import { flagValue } from './flags.js';
import { readChainsFile, readUiBlob } from './persist-store.js';
import { mlog } from '../log.js';
import { keyboardState, resetOctaves, OCT_MIN, OCT_MAX } from '../keyboard/state.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { SCALES } from './scales.js';
import { mutesSnapshot, restoreMutes, resetTrackMutes } from '../mixer/track-mutes.js';
import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { readPrefDefaultQuant } from './prefs.js';
import { loadPerSetFlags, perSetFlagsSnapshot } from './flags.js';
import {
    beginMigration, migrationMarker, migrationPending, migrationResult,
} from '../track/migrate.js';
import type { ChainTrackState } from '../track/chain-persist.js';
import type { SendState } from '../track/send-persist.js';

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
    typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v | 0)) : dflt;

/* What the set's own blob asked for, kept so a migration can re-state it.
 *
 * The document names EVERY chain in the set, so a migrated track cannot be added
 * by sending it alone — the engine would read that as "unload everything else".
 *
 * Two documents rather than one held document, and the difference is worth
 * knowing. Holding the first one until the migration resolves keeps the loads
 * from being queued twice — but that same document is also the instruction to
 * UNLOAD the previous Set's chains, and delaying it means the Set you just left
 * goes on sounding. It also arrives before `chain-payload` arms its blobs, so a
 * late `restoreChains` wipes payloads that were already waiting. Both showed up
 * as real test failures. The second document costs one extra round of loads, on
 * the one open per legacy set where a migration actually finds something. */
let lastLoaded: { chains: ChainTrackState[] | undefined; sends: SendState[] | undefined } | null = null;
let migrationApplied = false;

/** Re-state the chain set with the migrated tracks folded in. Idempotent, and a
 *  no-op when the migration found nothing — which is every set but one, once. */
export function applyMigratedChains(): void {
    if (migrationApplied) return;
    const mig = migrationResult();
    if (!mig || mig.chains.length === 0) { migrationApplied = true; return; }
    migrationApplied = true;
    const chains = [...(lastLoaded?.chains ?? []), ...mig.chains]
        .sort((a, b) => (a?.t ?? 0) - (b?.t ?? 0));
    const n = restoreChains(chains, lastLoaded?.sends);
    mlog('mig: re-stated the chain set — ' + n + ' component(s), '
        + mig.migrated.length + ' migrated');
}

/** JSON of the persisted UI keyboard state (tonic, scale, layout, octaves). */
/* The chains and sends to write, and where they came from.
 *
 * Engine-owned, they are a MIRROR of chains.json — the file the engine writes
 * and the only truth while `engpersist` is on. The copy exists so a build with
 * the flag OFF still finds chains where it looks for them; without it, flipping
 * the flag back would cost the user their chains.
 *
 * An unreadable chains.json keeps whatever ui-state.json already holds. It is
 * not the authority, so a stale mirror cannot lose work — but writing `[]` over
 * a real chain set would, and that is §3 wearing a different hat. */
function chainsToWrite(uuid: string): { chains: ChainTrackState[]; sends: SendState[] } {
    if (!flagValue('engpersist')) {
        /* One read for the chains AND the sends: an engine GET blocks ~3-5 ms
         * and this runs on every autosave. */
        const chainDoc = readChainDoc();
        return { chains: captureChains(chainDoc), sends: captureSends(chainDoc) };
    }
    const mirror = parseMirror(readChainsFile(uuid));
    if (mirror) return mirror;
    try {
        const prev = JSON.parse(readUiBlob(uuid) ?? '{}');
        return {
            chains: Array.isArray(prev.chains) ? prev.chains : [],
            sends: Array.isArray(prev.sends) ? prev.sends : [],
        };
    } catch { return { chains: [], sends: [] }; }
}

export function serializeUiState(uuid = ''): string {
    const chains = chainsToWrite(uuid);
    return JSON.stringify({
        // `root` is kept as track 0's absolute base so an older build reading a
        // newer file still lands on a sane note.
        root:   keyboardState.octave[0] * 12 + keyboardState.rootPc,
        rootPc: keyboardState.rootPc,
        scale:  keyboardState.scale,
        mode:   keyboardState.mode,
        layout: keyboardState.layout,
        oct:    keyboardState.octave.slice(),
        mutes:  mutesSnapshot(),
        defaultQuant: seqState.defaultQuant,
        /* Movy-hosted chains. Host tracks are not here: Move's own set file
         * carries those, and duplicating them would let the two disagree. */
        chains: chains.chains,
        /* The send FX buses. Their own array, not a `chains` entry with a
         * track index above TRACK_COUNT: a send is not a track, and a reader
         * that took `t` for one would address a track that does not exist. */
        sends: chains.sends,
        /* The flags that belong to the SET rather than to this Move — today,
         * which host owns tracks 1-4. Keyed by flag key, the way prefs.json
         * keys the machine's half. */
        flags: perSetFlagsSnapshot(),
        /* Which migration this set has been through. Present means its tracks
         * 1-4 are movy chains and schwung's slots are no longer consulted —
         * including after a migration that could not complete, deliberately. */
        migv: migrationMarker(),
    });
}

/** Apply a serialized UI-state blob (tolerant of missing/invalid fields). */
export function applyUiState(blob: string): void {
    try {
        const o = JSON.parse(blob);
        const flags = o.flags && typeof o.flags === 'object' ? o.flags : null;
        /* Ahead of everything else this blob decides: a per-set flag's value has
         * to be in place before any of the reads below could depend on it (none
         * do today, but a value read stale for even one tick is how the
         * migration's own predecessor bug — chtracks moving the UI but not the
         * engine — happened). `null` here means "this set predates the field",
         * matching what `beginMigration` is handed on the same line. */
        loadPerSetFlags(flags);
        /* The migration is started before the chains go out but does not hold
         * them: it may need several ticks to decide, and this document is also
         * what unloads the previous Set. `applyMigratedChains` re-states it if
         * the probe finds anything. */
        beginMigration(flags, o.migv, o.chains);
        /* Then the chains, before anything cosmetic: the loads are queued one
         * per audio callback, so the sooner they start the sooner the set sounds
         * like itself. One document says both what to unload and what to load —
         * a set with no `chains` key names nothing, which is how a set written
         * before movy hosted chains still clears the previous set's. */
        lastLoaded = { chains: o.chains, sends: o.sends };
        migrationApplied = false;
        const n = restoreChains(o.chains, o.sends);
        if (n > 0) mlog('chains: restoring ' + n + ' movy chain component(s)');
        if (Array.isArray(o.oct)) {
            for (let t = 0; t < TRACK_COUNT; t++)
                keyboardState.octave[t] = clampInt(o.oct[t], OCT_MIN, OCT_MAX, 4);
            keyboardState.rootPc = ((clampInt(o.rootPc, -1e6, 1e6, 0) % 12) + 12) % 12;
        } else if (typeof o.root === 'number') {
            // Blob written before the tonic/octave split: one absolute note
            // carried both, so derive the tonic and give every track that octave.
            const r = clampInt(o.root, 0, 103, 48);
            keyboardState.rootPc = r % 12;
            const oct = clampInt(Math.floor(r / 12), OCT_MIN, OCT_MAX, 4);
            for (let t = 0; t < TRACK_COUNT; t++) keyboardState.octave[t] = oct;
        }
        keyboardState.scale  = clampInt(o.scale,  0, SCALES.length - 1, keyboardState.scale);
        keyboardState.mode   = clampInt(o.mode,   0, MODE_NAMES.length - 1, 0);
        keyboardState.layout = clampInt(o.layout, 0, layoutNames(keyboardState.mode).length - 1, 0);
        if (o.mutes) restoreMutes(o.mutes);
        /* Absent = a set written before this feature, or a brand new one. Both
         * adopt the machine default rather than snapping to zero — that is the
         * whole point of keeping it outside the set. */
        applyDefaultQuant(typeof o.defaultQuant === 'number'
            ? clampInt(o.defaultQuant, 0, 100, readPrefDefaultQuant())
            : readPrefDefaultQuant());
    } catch { /* corrupt file → keep defaults */ }
}

/* The engine needs the default to stamp clips as they are created, so every
 * path that resolves it also pushes it. */
function applyDefaultQuant(pct: number): void {
    seqState.defaultQuant = pct;
    seqCmd('dq ' + pct);
}

/* Defaults match init(): C tonic, Major, Chromatic/4ths, C3 on every track. */
export function resetUiState(): void {
    /* A Set with no UI blob at all: new work, or a set duplicated in Move —
     * indistinguishable until the probe runs, so both are candidates. A
     * duplicated set's instruments are found by the probe and arrive in the
     * second document. */
    loadPerSetFlags(null);
    beginMigration(null, undefined, []);
    lastLoaded = { chains: [], sends: undefined };
    migrationApplied = false;
    /* A Set with no UI blob wants no movy chains — the same clean slate schwung
     * gives an unseen set when it seeds empty slots. */
    restoreChains(null, null);
    keyboardState.rootPc = 0;
    keyboardState.scale = 0;
    keyboardState.mode = 0;
    keyboardState.layout = 0;
    resetOctaves();
    resetTrackMutes();
    applyDefaultQuant(readPrefDefaultQuant());
}
