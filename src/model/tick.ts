import type { ModelState } from './state.js';
import { wavPeaksTick } from './wav-peaks.js';
import { conditionHolds } from './visible-if.js';
import { loadHierarchy } from './hierarchy.js';
import { applyKnobDelta, refreshOneParam, pollModuleName, refreshModulatedKeys, slotToLocal } from './store.js';
import { triggerAnimationTick } from './trigger.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS } from './constants.js';
import { retryUnsettledMeta } from './meta-retry.js';
import { mlog } from '../log.js';

/* Module-level perf counters — not in ModelState to avoid interface churn. */
let _perfTickCount    = 0;
let _perfSampleMs     = 0;
let _perfRefreshMaxMs = 0;

/* Has a visible_if condition flipped? Evaluated against the CACHED value the
 * round-robin refresh already maintains, so this makes no host call — movy's
 * tick period is its MIDI sampling interval, and a poll here was paid for in
 * input latency. A controller the module does not put on any page keeps the
 * value read at load; nothing else can change it behind our back. */
function visibilityChanged(s: ModelState): boolean {
    for (const r of s.visibilityRules) {
        let idx = -1;
        for (let i = 0; i < s.knobParams.length; i++) {
            if (s.knobParams[i]?.key === r.param) { idx = i; break; }
        }
        if (idx < 0) continue;                       // off-page: settled at load
        const v = s.knobValues[idx];
        if (v === null || v === undefined) continue; // not read back yet
        const opts = s.knobParams[idx]?.options ?? null;
        const holds = conditionHolds(r, String(v), opts);
        if (holds === s.hiddenKeys.has(r.key)) return true;   // state disagrees
    }
    return false;
}

/* Rebuild the page set when the module the state names is not the one it was
 * built from. Shared with `reReadModule` below, which is the same work done at
 * once rather than over the next couple of ticks. */
function syncHierarchy(s: ModelState): void {
    if (s.hierarchyKey === s.activeModuleName) return;
    const prevModuleId = s.moduleId;
    loadHierarchy(s);
    /* A metadata re-resolve (meta-retry.ts) rebuilds the SAME module — keep
     * the user on the page they were reading. Only a real module change,
     * or a page that no longer exists, starts over. */
    if (s.moduleId !== prevModuleId || s.knobPage >= s.bankNames.length) s.knobPage = 0;
    s.refreshParamCursor = 0;
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
 *
 * Values are NOT read here: they converge on the existing round-robin, the same
 * way they do after loading a module from the browser. */
export function reReadModule(s: ModelState): void {
    s.pollCountdown = NAME_POLL_TICKS;
    pollModuleName(s);
    syncHierarchy(s);
    s.dirty = true;
}

export function processTick(s: ModelState): boolean {
    /* Chip away at the sample waveform. The read is deliberately here and not
     * in buildViewModel: movy's tick period IS its MIDI sampling interval, so
     * this does a couple of 32 KB blocks and returns, repainting only on the
     * ticks that actually advanced the picture. */
    const wavDirty = s.wavRequest
        ? wavPeaksTick(s.wavRequest.path) : false;
    if (wavDirty) s.dirty = true;

    /* A visible_if controller moved (mrsample's Loop switch) — the page's param
     * set is different now, so rebuild it. Cheap to check, rare to fire. */
    if (s.visibilityRules.length > 0 && visibilityChanged(s)) s.hierarchyKey = '';

    /* An item selection has settled — re-read the module. tick's rebuild below
     * already preserves knobPage for the same moduleId and clamps it to the new
     * page count, so a bank switch never dumps the user on page 1. */
    if (s.itemsReloadCountdown > 0 && --s.itemsReloadCountdown === 0) {
        s.itemsReloadCountdown = -1;
        s.hierarchyKey = '';
    }

    syncHierarchy(s);

    let hadDelta = false;
    for (let k = 0; k < KNOBS_PER_PAGE; k++) {
        if (s.pendingDeltas[k] !== 0) {
            applyKnobDelta(s, k, s.pendingDeltas[k]);
            s.pendingDeltas[k] = 0;
            hadDelta = true;
        }
    }
    if (hadDelta) s.lastDeltaTick = _perfTickCount;

    /* A trigger badge animates on its own after the turn: the fired flash, then
     * the re-arm drain. Keep the frame dirty while either is live so the drain
     * actually moves, then stop — the drain is quantised to COOL_STEPS, so this
     * is a bounded burst of repaints, not a permanent animation loop. */
    if (triggerAnimationTick(s)) s.dirty = true;

    if (s.longPressCountdown > 0) {
        s.longPressCountdown--;
        if (s.longPressCountdown === 0) {
            const k = s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
            const local = k >= 0 ? slotToLocal(s, k) : -1;
            if (local >= 0) {
                const gi = s.knobPage * KNOBS_PER_PAGE + local;
                const p  = s.knobParams[gi];
                if (p && p.type === 'enum' && p.options) {
                    s.enumOverlay = {
                        slot:     k,
                        gi,
                        options:  p.options,
                        selected: Math.round((s.knobValues[gi] ?? 0) as number),
                    };
                    s.dirty = true;
                }
            }
            s.longPressCountdown = -1;
        }
    }

    let probed = false;
    if (--s.pollCountdown <= 0) {
        s.pollCountdown = NAME_POLL_TICKS;
        pollModuleName(s);
        refreshModulatedKeys(s);   // pick up LFO (un)assignments made elsewhere
        probed = retryUnsettledMeta(s);
    }

    // A metadata probe already spent this tick's read budget (perf.mjs caps the
    // per-tick shadow_get_param count) — the value refresh waits a tick.
    if (!probed && s.knobParams.length > 0) {
        const t0 = Date.now();
        refreshOneParam(s, _perfTickCount);
        const ms = Date.now() - t0;
        if (ms > _perfRefreshMaxMs) _perfRefreshMaxMs = ms;
    }

    _perfTickCount++;
    if (_perfTickCount % NAME_POLL_TICKS === 0) {
        const now = Date.now();
        if (_perfSampleMs > 0) {
            const rate = Math.round(NAME_POLL_TICKS * 1000 / (now - _perfSampleMs));
            mlog('perf_tick_rate=' + rate);
            mlog('perf_refresh_ms=' + _perfRefreshMaxMs + ' params=' + s.knobParams.filter(Boolean).length);
            _perfRefreshMaxMs = 0;
        }
        _perfSampleMs = now;
    }

    const wasDirty = s.dirty;
    s.dirty = false;
    return wasDirty;
}
