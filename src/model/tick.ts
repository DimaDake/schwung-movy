import type { ModelState } from './state.js';
import { loadHierarchy } from './hierarchy.js';
import { applyKnobDelta, refreshOneParam, pollModuleName } from './store.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS } from './constants.js';
import { mlog } from '../log.js';

/* Module-level perf counters — not in ModelState to avoid interface churn. */
let _perfTickCount    = 0;
let _perfSampleMs     = 0;
let _perfRefreshMaxMs = 0;

export function processTick(s: ModelState): boolean {
    if (s.hierarchyKey !== s.activeModuleName) {
        s.knobPage = 0;
        loadHierarchy(s);
        s.refreshParamCursor = 0;
    }

    let hadDelta = false;
    for (let k = 0; k < KNOBS_PER_PAGE; k++) {
        if (s.pendingDeltas[k] !== 0) {
            applyKnobDelta(s, k, s.pendingDeltas[k]);
            s.pendingDeltas[k] = 0;
            hadDelta = true;
        }
    }
    if (hadDelta) s.lastDeltaTick = _perfTickCount;

    if (s.longPressCountdown > 0) {
        s.longPressCountdown--;
        if (s.longPressCountdown === 0) {
            const k = s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
            if (k >= 0) {
                const gi = s.knobPage * KNOBS_PER_PAGE + k;
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

    if (--s.pollCountdown <= 0) {
        s.pollCountdown = NAME_POLL_TICKS;
        pollModuleName(s);
    }

    if (s.knobParams.length > 0) {
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
