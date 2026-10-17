/* The Settings row that runs the migration from Move again.
 *
 * The migration runs once on its own at the first start (set_migrate.rs) and
 * never again by itself. This row is the one way to run it a second time, and
 * it REPLACES every Set that came from Move — so it is armed by the first click
 * and run by the second, with what it replaces kept in BACKUPS. Sets made in
 * movy are not touched by it.
 *
 * The engine does the work on its saver thread; this side sends the command,
 * shows the progress, and waits for the open Set to be handed back the way a
 * restore hands it back (version-restore.ts), which reloads it. */

import { paramGet } from '../host/param.js';
import { mlog } from '../log.js';
import { libMigrateCmd, libSend, libState } from './sets-lib.js';
import { awaitMigration, migrationPending } from './version-restore.js';

let armed = false;
let progress = '';
let polls = 0;

/* `migp` is an engine GET, which blocks a few ms — read it at a fraction of the
 * tick rate, and only while something is waiting on a migration. */
const POLL_TICKS = 8;

export function migrateRowArmed(): boolean { return armed; }

/** A confirmation the user can no longer see on screen is not one they gave. */
export function disarmMigrateRow(): void { armed = false; }

/** Jog click on the row: the first arms, the second runs. */
export function migrateRowClick(openId: string): void {
    if (migrationPending()) return;
    if (!armed) { armed = true; return; }
    armed = false;
    mlog('migrate: manual run from Settings');
    libSend(libMigrateCmd(true));
    awaitMigration(openId);
}

const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

function dateOf(ms: number): string {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function migrateRowValue(): string {
    if (progress) return progress;
    if (migrationPending()) return '...';
    return armed ? 'CONFIRM?' : '>';
}

export function migrateRowHint(): string {
    /* Two lines of the hint band (flags-view.ts HINT_LINES) — sets.mjs holds
     * every state to it. */
    if (armed) return 'Click again. Old versions stay in BACKUPS.';
    const mig = libState()?.mig ?? 0;
    return mig > 0
        ? 'Ran ' + dateOf(mig) + '. Again replaces Move Sets.'
        : 'Bring every Set over from Move.';
}

/** Called every tick; reads the engine only while `watching`. */
export function pollMigrationProgress(watching: boolean): void {
    if (!watching) { progress = ''; polls = 0; return; }
    if (++polls < POLL_TICKS) return;
    polls = 0;
    progress = paramGet('migp') ?? '';
}

/** `done/total` while a migration runs, else ''. */
export function migrationProgress(): string { return progress; }

export function resetMigrateAction(): void { armed = false; progress = ''; polls = 0; }
