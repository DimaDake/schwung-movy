import { createModelState } from './state.js';
import { loadHierarchy }    from './hierarchy.js';
import { applyKnobDelta }   from './store.js';
import { buildViewModel }   from './viewmodel.js';
import { processTick }      from './tick.js';
import { KNOBS_PER_PAGE, LONG_PRESS_TICKS, NAME_POLL_TICKS } from './constants.js';
import { mlog } from '../log.js';

export function createModel(slot: number) {
    const s = createModelState(slot);

    function numBanks() { return Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE)); }

    return {
        handleKnobDelta(k: number, delta: number): void {
            if (s.enumOverlay && k === s.enumOverlay.slot) {
                const next = Math.max(0, Math.min(s.enumOverlay.options.length - 1, s.enumOverlay.selected + delta));
                if (next !== s.enumOverlay.selected) {
                    s.enumOverlay.selected = next;
                    s.knobValues[s.enumOverlay.gi] = next;
                    s.dirty = true;
                }
                return;
            }
            s.longPressCountdown = -1;
            s.pendingDeltas[k] += delta;
            if (s.touchedSlot !== k) { s.touchedSlot = k; s.dirty = true; }
        },

        handleKnobTouch(k: number): void {
            if (s.enumOverlay) { s.enumOverlay = null; s.dirty = true; }
            if (s.touchedSlot !== k) { s.touchedSlot = k; s.dirty = true; }
            const gi = s.knobPage * KNOBS_PER_PAGE + k;
            const p  = s.knobParams[gi];
            if (p && p.type === 'enum' && p.options && p.options.length > 6) {
                s.enumOverlay = { slot: k, gi, options: p.options, selected: Math.round((s.knobValues[gi] ?? 0) as number) };
                s.dirty = true;
            }
            s.longPressCountdown = -1;
        },

        handleKnobRelease(): void {
            if (s.enumOverlay) {
                const p = s.knobParams[s.enumOverlay.gi];
                if (p) {
                    s.knobValues[s.enumOverlay.gi] = s.enumOverlay.selected;
                    shadow_set_param(s.activeSlot, 'synth:' + p.key, String(s.enumOverlay.selected));
                }
                s.enumOverlay = null;
                s.dirty = true;
            }
            if (s.touchedSlot >= 0) { s.touchedSlot = -1; s.dirty = true; }
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
            s.touchedSlot = -1;
            s.longPressCountdown = -1;
            s.enumOverlay = null;
            s.pollCountdown = NAME_POLL_TICKS;
            s.refreshCountdown = 0;
            for (let i = 0; i < KNOBS_PER_PAGE; i++) s.pendingDeltas[i] = 0;
            s.dirty = true;
        },

        tick(): boolean { return processTick(s); },

        getViewModel() { return buildViewModel(s); },

        reload(): void { s.hierarchyKey = ''; s.pollCountdown = 1; s.dirty = true; },
    };
}

export type Model = ReturnType<typeof createModel>;
