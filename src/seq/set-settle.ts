/* When a loaded Set becomes a playable one.
 *
 * Loading a Set is one blocking write; making it playable is not. `restoreChains`
 * only QUEUES the module loads and the engine releases one per audio callback,
 * each a 78-276 ms dlopen — so a full Set's instruments arrive over seconds.
 * Separately, a Set Move has not committed gets a track-button press injected
 * (set-commit.ts), and that press hands Move the surface for about a second.
 *
 * Both used to happen after movy had declared itself ready, behind a UI that
 * looked live: a pad hit in that window reached the wrong module, or Move. This
 * is the wait that covers them, and the one rule it must never break is that it
 * ends. */

import { statusSeq } from './engine.js';
import { seqState } from './state.js';
import { setCommitIdle } from './set-commit.js';
import { applyMigratedChains } from './ui-state.js';
import { abandonMigration, migrationPending } from '../track/migrate.js';

/* A module that never loads — a broken .so, a wedged shim — must not leave the
 * user staring at a splash forever. The expiry goes LIVE rather than to the
 * failure screen: what did load still plays, and the one that did not is the
 * only thing missing. */
const CAP_MS = 10000;

/* Wall-clock, not ticks: the device tick rate swings 63-205 Hz with load, so a
 * tick count is not a duration. */
let start = 0;
/* The status-poll count when the wait began. `chpend` is a MIRROR, and it still
 * reads the previous Set's zero until the first poll after the loads were
 * queued — promoting on that zero is promoting on a stale answer, which is the
 * same "looks ready, is not" bug one layer up. */
let baseSeq = -1;

export type Settle = 'wait' | 'done' | 'capped';

export function beginSettle(): void {
    start = Date.now();
    baseSeq = statusSeq();
}

export function resetSettle(): void {
    start = 0;
    baseSeq = -1;
}

export function settleCheck(): Settle {
    const capped = Date.now() - start >= CAP_MS;
    /* The probe must end, and the cap is what ends it: a rack that never settles
     * cannot be allowed to hold the splash on its own. */
    if (capped) abandonMigration();
    /* The migration runs behind the splash and NOWHERE ELSE — that is the whole
     * rule. Promoting while it is still probing would put a live surface in
     * front of tracks that are about to be re-stated under the user's hands. */
    if (migrationPending()) return 'wait';
    /* Resolved: fold anything it found into the chain set. Idempotent, and a
     * no-op for every set that had nothing waiting in a schwung slot. */
    applyMigratedChains();
    if (statusSeq() > baseSeq && seqState.chainPending === 0 && setCommitIdle()) return 'done';
    return capped ? 'capped' : 'wait';
}

/** How long the wait has run, for the log line that closes it. */
export function settleWaited(): number { return Date.now() - start; }

/** Why the cap fired, when it does. */
export function settleOutstanding(): string {
    return 'chpend=' + seqState.chainPending + ' commit=' + (setCommitIdle() ? 'idle' : 'busy')
        + (migrationPending() ? ' migrating' : '');
}
