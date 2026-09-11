/* The one-time move of tracks 1-4 off schwung's shadow slots.
 *
 * Runs behind the loading splash and nowhere else. A migration that ran against
 * a live surface could race a user's edit, and the splash is the only state in
 * which no gesture reaches the instrument.
 *
 * **The stability rule is the whole file.** schwung reloads a set's slots by
 * clearing all four and then loading each one (shadow_ui.js, SET_CHANGED: pass 1
 * clears, pass 2 load_files), so a single read can land mid-reload and see an
 * empty rack — or half of one. Migrating on that would write a set with its
 * instruments missing, and marking it afterwards would make that permanent. So
 * a rack counts as settled only when two consecutive reads AGREE, and the wait
 * has a budget: the splash must end.
 *
 * Marking a set that could not be migrated is deliberate. Nothing is destroyed
 * by it — the schwung slot is never cleared, so the patch is still in Move's own
 * set file and still reachable from schwung's own UI. Leaving the set unmarked
 * instead would re-probe it on every open for the rest of its life. */

import { legacySetWasSchwung } from './legacy-host.js';
import { LEGACY_SLOTS, readSlotChain, slotSignature, type SlotChain } from './slot-read.js';
import { planMigration, type MigrationResult } from './migrate-plan.js';
import type { ChainTrackState } from './chain-persist.js';
import { mlog } from '../log.js';

/** The `migv` value this build writes. A set carrying it is never probed again. */
export const MIGRATION_VERSION = 1;

/* TICKS, and deliberately not wall-clock.
 *
 * The question is not "has enough time passed" but "has schwung had a chance to
 * run" — and movy's tick is called FROM schwung's own tick, so two probes on
 * consecutive ticks are separated by a schwung tick by construction. A duration
 * only approximates that, and approximates it differently at 63 Hz and 205 Hz.
 *
 * Twenty ticks is ~100-300 ms on device: long enough to outlast a slot whose
 * `load_file` timed out and is being retried, short enough to disappear inside
 * a splash that is already waiting on module loads. */
const MAX_PROBES = 20;

/* A signature with nothing in it but separators. */
const EMPTY_SIG = /^[|;]*$/;

type State = 'idle' | 'probing' | 'done';

let state: State = 'idle';
let existingChains: ChainTrackState[] | null = null;
let result: MigrationResult | null = null;
/* Not '' — an empty RACK has a real signature ('|||;|||;…'), and a sentinel that
 * could never equal one is what stops the first probe agreeing with nothing. */
let lastSig: string | null = null;
let probes = 0;
/* Armed by the manual Settings row, ahead of the reload it forces — see
 * `armManualOverwrite`. Deliberately NOT cleared by the internal reset
 * `beginMigration` runs on every call (`resetCycle(true)` below): it has to
 * survive from the arm to the very next probe, which is the one across that
 * reload. It IS cleared by `resetMigration`, the public reset tests use
 * between cases, and by every exit this file has — nothing left probing can
 * carry it into an unrelated later load. */
let forceOverwrite = false;

/* `keepOverwrite` is what lets `beginMigration` reset everything ELSE on every
 * call without discarding an arm made moments before it. */
function resetCycle(keepOverwrite: boolean): void {
    state = 'idle'; existingChains = null; result = null;
    lastSig = null; probes = 0;
    if (!keepOverwrite) forceOverwrite = false;
}

/** Full reset, for tests between cases. Production never calls this directly —
 *  `beginMigration` keeps a just-armed overwrite alive across its own reset. */
export function resetMigration(): void { resetCycle(false); }

/** Arm the very next probe — and only that one — to OVERWRITE an occupied
 *  chain instead of skipping it. The manual Settings row's one behavioral
 *  difference from the automatic path: the two reasons to press it are a
 *  migration that came up partial and a chain since broken by hand, and the
 *  automatic guard would refuse both. Call this, then force the reload that
 *  makes the next `beginMigration` the one it arms. */
export function armManualOverwrite(): void { forceOverwrite = true; }

/** Start the migration for the set being loaded.
 *
 *  `marker` is the blob's `migv` field, `blobFlags` its `flags` object, and
 *  `existing` the chains the blob itself restored — a track already in there is
 *  the set's own and is never written over, UNLESS `armManualOverwrite` was
 *  called since the last probe resolved. */
export function beginMigration(
    blobFlags: Record<string, unknown> | null | undefined,
    marker: unknown,
    existing: ChainTrackState[] | undefined | null,
): void {
    resetCycle(true);
    if (typeof marker === 'number' && marker >= MIGRATION_VERSION) {
        forceOverwrite = false; state = 'done'; return;
    }
    if (!legacySetWasSchwung(blobFlags)) {
        /* Not a candidate, but still marked: a set that never had schwung tracks
         * has nothing to find, and saying so once is cheaper than asking again
         * on every open. */
        forceOverwrite = false;
        state = 'done';
        return;
    }
    existingChains = Array.isArray(existing) ? existing : [];
    state = 'probing';
}

/** True when the migration has resolved and the chain document may go out.
 *  Call exactly once per tick while the splash is up. */
export function migrationTick(): boolean {
    if (state !== 'probing') return true;
    probes++;

    const sig = slotSignature();
    /* Two consecutive AGREEING reads. An empty rack agreeing with itself is a
     * real answer — a set whose slots hold nothing — and gets the same
     * treatment as a full one: resolve, and mark. */
    if (sig === lastSig) {
        if (EMPTY_SIG.test(sig)) { mlog('mig: nothing to migrate'); finish(null); }
        else finish(collect());
        return true;
    }
    lastSig = sig;

    if (probes >= MAX_PROBES) {
        /* The rack would not settle. Marked anyway, and said out loud: the
         * splash must end, and nothing has been lost — the slots still hold
         * what they held. */
        mlog('mig: schwung slots NEVER SETTLED after ' + probes
            + ' probes — tracks 1-4 not migrated');
        finish(null);
        return true;
    }
    return false;
}

function collect(): MigrationResult {
    const slots: SlotChain[] = [];
    for (let s = 0; s < LEGACY_SLOTS; s++) slots.push(readSlotChain(s));
    const r = planMigration(slots, existingChains, forceOverwrite);
    mlog('mig: ' + (forceOverwrite ? 'manual — ' : '') + 'migrated ' + r.migrated.length + ' track(s)'
        + (r.skipped.length ? ', skipped ' + r.skipped.length : '')
        + (r.warnings.length ? ', ' + r.warnings.length + ' warning(s)' : ''));
    for (const w of r.warnings) mlog('mig: ' + w);
    return r;
}

function finish(r: MigrationResult | null): void {
    result = r && r.migrated.length > 0 ? r : null;
    state = 'done';
    /* Consumed either way: an arm that found nothing to overwrite must not
     * wait around for a later, unrelated load to spend it on. */
    forceOverwrite = false;
}

/** What the migration produced, or null when it produced nothing. */
export function migrationResult(): MigrationResult | null { return result; }

/** Whether the chain document is still being held. */
export function migrationPending(): boolean { return state === 'probing'; }

/** The `migv` to persist. Always the current version once resolved — including
 *  after a failure, deliberately. */
export function migrationMarker(): number {
    return state === 'done' ? MIGRATION_VERSION : 0;
}

/** Give up and resolve, whatever the probe was doing.
 *
 *  The settle cap's backstop. The chain document is HELD until the migration
 *  resolves, and that document carries the instruction to unload the previous
 *  Set's chains — so a probe that never finished must never be the reason it is
 *  never sent. */
export function abandonMigration(): void {
    if (state !== 'probing') return;
    mlog('mig: settle cap reached while probing — tracks 1-4 not migrated');
    finish(null);
}

