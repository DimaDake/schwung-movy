import { createModelState } from './state.js';
import { loadHierarchy }    from './hierarchy.js';
import { applyKnobDelta }   from './store.js';
import { buildViewModel }   from './viewmodel.js';
import { processTick }      from './tick.js';
import { KNOBS_PER_PAGE, LONG_PRESS_TICKS, NAME_POLL_TICKS, ENUM_DELTA_DIV } from './constants.js';
import { mlog } from '../log.js';

export function createModel(slot: number, componentKey = 'synth') {
    const s = createModelState(slot, componentKey);

    function numBanks() { return Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE)); }

    function primarySlot(): number {
        return s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    }

    return {
        handleKnobDelta(k: number, delta: number): void {
            if (s.enumOverlay && k === s.enumOverlay.slot) {
                s.enumAccums[k] += delta / ENUM_DELTA_DIV;
                const step = Math.trunc(s.enumAccums[k]);
                if (step !== 0) {
                    s.enumAccums[k] -= step;
                    const n    = s.enumOverlay.options.length;
                    const next = Math.max(0, Math.min(n - 1, s.enumOverlay.selected + step));
                    if (next !== s.enumOverlay.selected) {
                        s.enumOverlay.selected = next;
                        s.knobValues[s.enumOverlay.gi] = next;
                        s.dirty = true;
                    }
                }
                return;
            }
            s.longPressCountdown = -1;
            s.pendingDeltas[k] += delta;
            // Make this knob the primary touched slot without disturbing other held knobs
            const idx = s.touchedSlots.indexOf(k);
            if (idx < 0) { s.touchedSlots.push(k); s.dirty = true; }
            else if (idx < s.touchedSlots.length - 1) {
                s.touchedSlots.splice(idx, 1);
                s.touchedSlots.push(k);
                s.dirty = true;
            }
        },

        handleKnobTouch(k: number): void {
            if (s.enumOverlay) { s.enumOverlay = null; s.dirty = true; }
            const idx = s.touchedSlots.indexOf(k);
            if (idx >= 0) s.touchedSlots.splice(idx, 1);
            s.touchedSlots.push(k);
            s.dirty = true;
            const gi = s.knobPage * KNOBS_PER_PAGE + k;
            const p  = s.knobParams[gi];
            if (p && p.type === 'enum' && p.options && p.options.length > 6) {
                s.enumOverlay = { slot: k, gi, options: p.options, selected: Math.round((s.knobValues[gi] ?? 0) as number) };
                s.enumAccums[k] = 0;
            }
            s.longPressCountdown = -1;
        },

        handleKnobRelease(k?: number): void {
            if (s.enumOverlay && (k === undefined || k === s.enumOverlay.slot)) {
                const p = s.knobParams[s.enumOverlay.gi];
                if (p) {
                    s.knobValues[s.enumOverlay.gi] = s.enumOverlay.selected;
                    shadow_set_param(s.activeSlot, s.componentKey + ':' + p.key, String(s.enumOverlay.selected));
                }
                s.enumOverlay = null;
            }
            if (k !== undefined) {
                const idx = s.touchedSlots.indexOf(k);
                if (idx >= 0) s.touchedSlots.splice(idx, 1);
            } else {
                s.touchedSlots.length = 0;
            }
            s.dirty = true;
            s.longPressCountdown = -1;
        },

        changePage(delta: number): void {
            if (s.enumOverlay) return;
            const nBanks = numBanks();
            const next = Math.max(0, Math.min(nBanks - 1, s.knobPage + delta));
            mlog('changePage delta=' + delta + ' ' + s.knobPage + '→' + next + '/' + nBanks);
            if (next !== s.knobPage) { s.knobPage = next; s.dirty = true; }
        },

        getModuleName(): string { return s.activeModuleName; },

        reset(): void {
            s.knobPage = 0;
            s.touchedSlots.length = 0;
            s.longPressCountdown = -1;
            s.enumOverlay = null;
            s.pollCountdown = NAME_POLL_TICKS;
            s.refreshParamCursor = 0;
            for (let i = 0; i < KNOBS_PER_PAGE; i++) { s.pendingDeltas[i] = 0; s.enumAccums[i] = 0; }
            s.dirty = true;
        },

        tick(): boolean { return processTick(s); },

        getViewModel() { return buildViewModel(s); },

        reload(): void { s.hierarchyKey = ''; s.pollCountdown = 1; s.dirty = true; },
    };
}

export type Model = ReturnType<typeof createModel>;
