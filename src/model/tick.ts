import type { ModelState } from './state.js';
import { loadHierarchy } from './hierarchy.js';
import { pollModuleName, refreshModulatedKeys } from './store.js';
import { NAME_POLL_TICKS } from './constants.js';
import { retryUnsettledMeta } from './meta-retry.js';
import { mlog } from '../log.js';

/* Module-level perf counters — not in ModelState to avoid interface churn. */
let _perfTickCount = 0;
let _perfSampleMs  = 0;

/* Re-read the module's params when the module the state names is not the one
 * they were read from. Shared with `reReadModule` below, which is the same work
 * done at once rather than over the next couple of ticks. */
function syncHierarchy(s: ModelState): void {
    if (s.hierarchyKey === s.activeModuleName) return;
    loadHierarchy(s);
    refreshModulatedKeys(s);   // populate LFO-target cache for the new module
}

/* Re-read the module NOW, rather than scheduling it for the name poll.
 *
 * The poll is deliberately slow — `NAME_POLL_TICKS` is ~1 s, and movy's tick
 * period IS its MIDI sampling interval, so a faster one is paid for in pad
 * latency. That is the right cadence for a module changing under a live
 * surface, and the wrong one for a Set load, where every model is stale at once
 * and the next frame is the first the user sees. Both reads are synchronous, so
 * the frame that follows this call already draws the Set that loaded.
 */
export function reReadModule(s: ModelState): void {
    s.pollCountdown = NAME_POLL_TICKS;
    pollModuleName(s);
    syncHierarchy(s);
    s.dirty = true;
}

/* The model's own per-tick work: notice a module swap (the name poll), keep
 * the LFO-target cache and late metadata current, and sample the tick rate. */
export function processTick(s: ModelState): boolean {
    syncHierarchy(s);

    /* HIERARCHY-PENDING RETRY (meta-retry.ts's armHierarchyRetry). Its OWN
     * faster pace, independent of pollCountdown's ~1 s cadence below: it fires
     * the instant a load lands empty. Clearing hierarchyKey only re-arms
     * syncHierarchy's rebuild for NEXT tick — this tick already ran it above. */
    if (s.hierarchyRetryCountdown >= 0 && --s.hierarchyRetryCountdown < 0) {
        s.hierarchyKey = '';
    }

    if (--s.pollCountdown <= 0) {
        s.pollCountdown = NAME_POLL_TICKS;
        pollModuleName(s);
        refreshModulatedKeys(s);   // pick up LFO (un)assignments made elsewhere
        retryUnsettledMeta(s);
    }

    _perfTickCount++;
    if (_perfTickCount % NAME_POLL_TICKS === 0) {
        const now = Date.now();
        if (_perfSampleMs > 0) {
            mlog('perf_tick_rate=' + Math.round(NAME_POLL_TICKS * 1000 / (now - _perfSampleMs)));
        }
        _perfSampleMs = now;
    }

    const wasDirty = s.dirty;
    s.dirty = false;
    return wasDirty;
}
