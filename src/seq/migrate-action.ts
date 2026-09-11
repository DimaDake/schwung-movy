/* The Settings row that re-runs the migration.
 *
 * It is not a second migration path: it re-enters the ONE state machine in
 * `track/migrate.ts`, the same way a Set switch does — save, clear the marker,
 * reload. That is what keeps the "no edit may race a migration" rule true for a
 * gesture made while the instrument is live: the splash comes up and the normal
 * probe/settle machinery runs, this time with `armManualOverwrite` set.
 *
 * It OVERWRITES, where the automatic path skips a chain that already holds
 * something. The two reasons to press it are a migration that came up partial
 * and a chain since broken by hand, and a guard would refuse both. Safe to
 * re-run: schwung's slot is never cleared. */

import { slotSignature } from '../track/slot-read.js';
import { armManualOverwrite, resetMigration } from '../track/migrate.js';
import { seqToast } from './render.js';

let armed = false;

export function migrateRowArmed(): boolean { return armed; }
export function armMigrateRow(): void { armed = true; }
export function disarmMigrateRow(): void { armed = false; }

/* Not the true empty-signature test in migrate.ts — that one exists to tell
 * "the rack has not settled yet" from "the rack is genuinely empty", which
 * costs two agreeing reads. Here the set is `ready`, so schwung's slots are
 * settled BY DEFINITION; one read is the answer, and "empty" is close enough
 * for "is there any point stopping the music". */
const EMPTY_SIG = /^[|;]*$/;

/** Whether any schwung slot still holds something to look at. Cheap — schwung
 *  serves these from its own param cache. */
export function slotsHaveContent(): boolean {
    return !EMPTY_SIG.test(slotSignature());
}

/** The confirmed press.
 *
 *  Returns whether the caller should save and reload — false means nothing was
 *  disturbed (no slots to migrate), true means `resetMigration` and
 *  `armManualOverwrite` have already run and the caller's next two calls MUST
 *  be a forced save (`sessionFlush(true)`, so the reload does not read behind
 *  the last few seconds) and `reloadCurrentSet()`, in that order — the same
 *  path a Set switch takes, which is what puts the probe behind the splash. */
export function runMigrateRow(): boolean {
    armed = false;
    if (!slotsHaveContent()) {
        seqToast('NOTHING TO MIGRATE');
        return false;
    }
    /* Order matters: `resetMigration` clears everything including a stale
     * `forceOverwrite`, so the arm has to come after it — the reload's own
     * `beginMigration` call preserves an arm made here across its own reset,
     * but only forward from this point. */
    resetMigration();
    armManualOverwrite();
    return true;
}
