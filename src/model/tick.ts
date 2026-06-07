import type { ModelState } from './state.js';
import { loadHierarchy } from './hierarchy.js';
import { applyKnobDelta, refreshKnobValues, pollModuleName } from './store.js';
import { KNOBS_PER_PAGE, NAME_POLL_TICKS, KNOB_REFRESH_TICKS } from './constants.js';

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
            const k = s.touchedSlot;
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
            refreshKnobValues(s);
            for (let k = 0; k < s.knobParams.length; k++) {
                if (s.knobValues[k] !== prev[k]) { s.dirty = true; break; }
            }
        }
    }

    const wasDirty = s.dirty;
    s.dirty = false;
    return wasDirty;
}
