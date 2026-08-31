/* The per-set UI-only state: tonic, scale, mode, pad layout, per-track octave
 * and track mutes. Kept apart from the engine's own serialization because the
 * engine knows nothing about any of it — it is ferried in its own JSON file
 * alongside the state blob. */

import { TRACK_COUNT } from '../track/ref.js';
import { captureChains, restoreChains } from '../track/chain-persist.js';
import { mlog } from '../log.js';
import { keyboardState, resetOctaves, OCT_MIN, OCT_MAX } from '../keyboard/state.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { SCALES } from './scales.js';
import { mutesSnapshot, restoreMutes, resetTrackMutes } from '../mixer/track-mutes.js';
import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { readPrefDefaultQuant } from './prefs.js';
import { perSetFlagsSnapshot } from './flags.js';
import { loadSetHostChoice } from '../track/host-mode.js';

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
    typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v | 0)) : dflt;

/** JSON of the persisted UI keyboard state (tonic, scale, layout, octaves). */
export function serializeUiState(): string {
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
        chains: captureChains(),
        /* The flags that belong to the SET rather than to this Move — today,
         * which host owns tracks 1-4. Keyed by flag key, the way prefs.json
         * keys the machine's half. */
        flags: perSetFlagsSnapshot(),
    });
}

/** Apply a serialized UI-state blob (tolerant of missing/invalid fields). */
export function applyUiState(blob: string): void {
    try {
        const o = JSON.parse(blob);
        /* FIRST, ahead of the chains: `restoreChains` routes by `trackKind()`,
         * so tracks 1-4 have to be on the host this set wants before a single
         * component is addressed. A blob with no `flags` object is a set saved
         * before this existed and keeps the schwung slots it was built on —
         * which is not the same answer as a set movy has never seen. */
        loadSetHostChoice(o.flags && typeof o.flags === 'object' ? o.flags : {});
        /* Then the chains, before anything cosmetic: the loads are queued one
         * per audio callback, so the sooner they start the sooner the set sounds
         * like itself. One document says both what to unload and what to load —
         * a set with no `chains` key names nothing, which is how a set written
         * before movy hosted chains still clears the previous set's. */
        const n = restoreChains(o.chains);
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
    /* A Set with no UI blob at all is new work: it takes the shipped default,
     * which puts tracks 1-4 on movy's own chains. */
    loadSetHostChoice(null);
    /* A Set with no UI blob wants no movy chains — the same clean slate schwung
     * gives an unseen set when it seeds empty slots. */
    restoreChains(null);
    keyboardState.rootPc = 0;
    keyboardState.scale = 0;
    keyboardState.mode = 0;
    keyboardState.layout = 0;
    resetOctaves();
    resetTrackMutes();
    applyDefaultQuant(readPrefDefaultQuant());
}
