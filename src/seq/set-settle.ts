/* When a loaded Set becomes a playable one.
 *
 * Loading a Set is one blocking write; making it playable is not. `restoreChains`
 * only QUEUES the module loads and the engine releases one per audio callback,
 * each a 78-276 ms dlopen — so a full Set's instruments arrive over seconds.
 *
 * That used to happen after movy had declared itself ready, behind a UI that
 * looked live: a pad hit in that window reached the wrong module. This is the
 * wait that covers it, and the one rule it must never break is that it ends. */

import { engineCaughtUp, engineMark } from './engine.js';
import { seqState } from './state.js';

/* A module that never loads — a broken .so, a wedged shim — must not leave the
 * user staring at a splash forever. The expiry goes LIVE rather than to the
 * failure screen: what did load still plays, and the one that did not is the
 * only thing missing. */
const CAP_MS = 10000;

/* Wall-clock, not ticks: the device tick rate swings 63-205 Hz with load, so a
 * tick count is not a duration. */
let start = 0;
/* The request stream's position when the wait began. `chpend` is a MIRROR, and
 * it still reads the previous Set's zero until a status taken after the loads
 * were queued — promoting on that zero is promoting on a stale answer, which is
 * the same "looks ready, is not" bug one layer up. The snapshot says exactly
 * when it has caught up (engine.ts `engineCaughtUp`). */
let baseMark = -1;

export type Settle = 'wait' | 'done' | 'capped';

export function beginSettle(): void {
    start = Date.now();
    baseMark = engineMark();
}

export function resetSettle(): void {
    start = 0;
    baseMark = -1;
}

export function settleCheck(): Settle {
    const capped = Date.now() - start >= CAP_MS;
    if (engineCaughtUp(baseMark) && seqState.chainPending === 0) return 'done';
    return capped ? 'capped' : 'wait';
}

/** How long the wait has run, for the log line that closes it. */
export function settleWaited(): number { return Date.now() - start; }

/** Why the cap fired, when it does. */
export function settleOutstanding(): string {
    return 'chpend=' + seqState.chainPending;
}
