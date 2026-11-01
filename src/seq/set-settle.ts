/* When a loaded Set becomes a playable one.
 *
 * Loading a Set is one blocking write; making it playable is not. `restoreChains`
 * only QUEUES the module loads and the engine releases one per audio callback,
 * each a 78-276 ms dlopen — so a full Set's instruments arrive over seconds.
 *
 * That used to happen after movy had declared itself ready, behind a UI that
 * looked live: a pad hit in that window reached the wrong module. This is the
 * wait that covers it, and the one rule it must never break is that it ends.
 *
 * Two steps. The modules load; then each chain's saved state (preset blob,
 * LFOs, level) goes out, and is APPLIED only when the engine serves it — a
 * SoundFont or a patch bank loads right there, 0.6-1.5 s on a big set. Going
 * live once those were merely queued showed a Set whose instruments still sat
 * at factory defaults, or had not loaded their sound yet. */

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

/* Where the chains' saved state entered the request stream; -1 until it has. */
let payloadMark = -1;
/* The most loads seen pending at once: the splash's "of N". `chpend` only ever
 * counts down from the whole Set, give or take the few released before the
 * first status after the queueing, so its peak is the Set's module count. */
let peakPending = 0;

/** `deliver`: the modules are in, send their saved state now. */
export type Settle = 'wait' | 'deliver' | 'done' | 'capped';

export function beginSettle(): void {
    start = Date.now();
    baseMark = engineMark();
    payloadMark = -1;
    peakPending = 0;
}

export function resetSettle(): void {
    start = 0;
    baseMark = -1;
    payloadMark = -1;
    peakPending = 0;
}

function modulesLoaded(): boolean {
    return engineCaughtUp(baseMark) && seqState.chainPending === 0;
}

export function settleCheck(): Settle {
    if (engineCaughtUp(baseMark)) peakPending = Math.max(peakPending, seqState.chainPending);
    if (modulesLoaded()) {
        if (payloadMark < 0) return 'deliver';
        if (engineCaughtUp(payloadMark)) return 'done';
    }
    return Date.now() - start >= CAP_MS ? 'capped' : 'wait';
}

/** The chains' saved state has been queued; what follows waits for it. */
export function payloadsSent(): void { payloadMark = engineMark(); }

/** Whether the saved state still has to be sent — the cap sends it too. */
export function payloadsUnsent(): boolean { return payloadMark < 0; }

/** What the splash is waiting on, for loading-view.ts. */
export type SettleStage = { step: 'modules' | 'sounds' | 'preparing'; loaded: number; total: number };

export function settleStage(): SettleStage {
    if (!modulesLoaded()) {
        const total = Math.max(peakPending, seqState.chainPending);
        return { step: 'modules', loaded: total - seqState.chainPending, total };
    }
    if (payloadMark >= 0 && !engineCaughtUp(payloadMark)) return { step: 'sounds', loaded: 0, total: 0 };
    return { step: 'preparing', loaded: 0, total: 0 };
}

/** How long the wait has run, for the log line that closes it. */
export function settleWaited(): number { return Date.now() - start; }

/** Why the cap fired, when it does. */
export function settleOutstanding(): string {
    return 'chpend=' + seqState.chainPending
        + (payloadMark >= 0 && !engineCaughtUp(payloadMark) ? ' state unapplied' : '');
}
