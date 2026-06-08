import type { ModelState } from './state.js';
import { loadHierarchy } from './hierarchy.js';
import { applyKnobDelta, refreshKnobValues, pollModuleName } from './store.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS, KNOB_REFRESH_TICKS } from './constants.js';
import { mlog } from '../log.js';

/* Module-level perf counters — not in ModelState to avoid interface churn. */
let _perfTickCount  = 0;
let _perfSampleMs   = 0;

export function processTick(s: ModelState): boolean {
    if (s.hierarchyKey !== s.activeModuleName) {
        s.knobPage = 0;
        loadHierarchy(s);
        s.refreshCountdown = 0;
    }

    for (let k = 0; k < KNOBS_PER_PAGE; k++) {
        if (s.pendingDeltas[k] !== 0) {
            applyKnobDelta(s, k, s.pendingDeltas[k]);
            s.pendingDeltas[k] = 0;
        }
    }

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

    if (--s.refreshCountdown <= 0) {
        s.refreshCountdown = KNOB_REFRESH_TICKS;
        if (s.knobParams.length > 0) {
            const prev = s.knobValues.slice();
            const t0 = Date.now();
            refreshKnobValues(s);
            const refreshMs = Date.now() - t0;
            mlog('perf_refresh_ms=' + refreshMs + ' params=' + s.knobParams.filter(Boolean).length);
            for (let k = 0; k < s.knobParams.length; k++) {
                if (s.knobValues[k] !== prev[k]) { s.dirty = true; break; }
            }
        }
    }

    /* Log tick rate once per ~1 s sample window. */
    _perfTickCount++;
    if (_perfTickCount % NAME_POLL_TICKS === 0) {
        const now = Date.now();
        if (_perfSampleMs > 0) {
            const rate = Math.round(NAME_POLL_TICKS * 1000 / (now - _perfSampleMs));
            mlog('perf_tick_rate=' + rate);
        }
        _perfSampleMs = now;
    }

    const wasDirty = s.dirty;
    s.dirty = false;
    return wasDirty;
}
