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

/* Wall-clock, not ticks: the device tick rate swings 63-205 Hz with load, so a
 * tick count is not a duration. Six probes at 250 ms is ~1.5 s inside a splash
 * that already waits seconds for modules to load. */
const PROBE_MS = 250;
const MAX_PROBES = 6;

/* A signature with nothing in it but separators. */
const EMPTY_SIG = /^[|;]*$/;

type State = 'idle' | 'probing' | 'done';

let state: State = 'idle';
let existingChains: ChainTrackState[] | null = null;
let result: MigrationResult | null = null;
let lastSig = '';
let probes = 0;
let nextAt = 0;

export function resetMigration(): void {
    state = 'idle'; existingChains = null; result = null;
    lastSig = ''; probes = 0; nextAt = 0;
}

/** Start the migration for the set being loaded.
 *
 *  `marker` is the blob's `migv` field, `blobFlags` its `flags` object, and
 *  `existing` the chains the blob itself restored — a track already in there is
 *  the set's own and is never written over. */
export function beginMigration(
    blobFlags: Record<string, unknown> | null | undefined,
    marker: unknown,
    existing: ChainTrackState[] | undefined | null,
): void {
    resetMigration();
    if (typeof marker === 'number' && marker >= MIGRATION_VERSION) { state = 'done'; return; }
    if (!legacySetWasSchwung(blobFlags)) {
        /* Not a candidate, but still marked: a set that never had schwung tracks
         * has nothing to find, and saying so once is cheaper than asking again
         * on every open. */
        state = 'done';
        return;
    }
    existingChains = Array.isArray(existing) ? existing : [];
    state = 'probing';
}

/** True when the migration has resolved and the chain document may go out.
 *  Call once per tick while the splash is up; `nowMs` is `Date.now()`. */
export function migrationTick(nowMs: number): boolean {
    if (state !== 'probing') return true;
    if (probes > 0 && nowMs < nextAt) return false;
    nextAt = nowMs + PROBE_MS;
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
    const r = planMigration(slots, existingChains, false);
    mlog('mig: migrated ' + r.migrated.length + ' track(s)'
        + (r.skipped.length ? ', skipped ' + r.skipped.length : '')
        + (r.warnings.length ? ', ' + r.warnings.length + ' warning(s)' : ''));
    for (const w of r.warnings) mlog('mig: ' + w);
    return r;
}

function finish(r: MigrationResult | null): void {
    result = r && r.migrated.length > 0 ? r : null;
    state = 'done';
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

/** The Settings action: one probe, no stability wait, and it OVERWRITES.
 *
 *  The set is `ready` when this runs, so schwung's slots are settled by
 *  definition — the wait above exists only for the load-time race. */
export function runManualMigration(
    existing: ChainTrackState[] | undefined | null,
): MigrationResult {
    const slots: SlotChain[] = [];
    for (let s = 0; s < LEGACY_SLOTS; s++) slots.push(readSlotChain(s));
    const r = planMigration(slots, existing, true);
    mlog('mig: manual — ' + r.migrated.length + ' track(s)');
    for (const w of r.warnings) mlog('mig: ' + w);
    return r;
}
