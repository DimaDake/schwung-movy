/* Hold-a-knob → assign it as a slot-LFO target. A 500ms hold (no turn) of an
 * automatable module param opens assign mode: a bottom toast, jog cycles
 * LFO1/LFO2, jog-click commits (assign or remove). Mode lives only while the
 * knob is held. Pure state + shadow target IO; navigation is done by the router. */

import type { KnobParamInfo } from '../model/store.js';
import { assignLfoTarget, clearLfoTarget, lfoTargetsParam } from './assign.js';
import { targetComponent, type LfoScope } from './scope.js';
import { HOLD_MS } from '../model/constants.js';

interface Held { scope: LfoScope; physK: number; info: KnobParamInfo; pressMs: number; }
const state = { held: null as Held | null, active: false, lfoSel: 0 };

/* The component as the LFO names its target. A master FX knob's component key
 * carries the `master_fx:` namespace; the shim's target field does not. */
function comp(h: Held): string { return targetComponent(h.scope, h.info.target); }

export function holdTouch(scope: LfoScope, physK: number, info: KnobParamInfo | null): void {
    state.active = false;
    state.held = (info && info.automatable) ? { scope, physK, info, pressMs: Date.now() } : null;
}

export function holdTurnCancel(): void { state.held = null; if (state.active) resetAssignMode(); }

export function holdRelease(physK: number): void {
    if (state.held && state.held.physK !== physK) return;
    state.held = null;
    if (state.active) resetAssignMode();
}

/* Promote a HOLD_MS hold-without-turn to assign mode. Returns true on activation. */
export function holdTick(): boolean {
    if (state.active || !state.held) return false;
    if (Date.now() - state.held.pressMs < HOLD_MS) return false;
    state.active = true;
    const h = state.held;
    state.lfoSel = lfoTargetsParam(h.scope, 0, comp(h), h.info.ioKey) ? 0
        : lfoTargetsParam(h.scope, 1, comp(h), h.info.ioKey) ? 1 : 0;
    return true;
}

export function assignActive(): boolean { return state.active; }

export function assignCycle(_dir: number): void { if (state.active) state.lfoSel ^= 1; }

export function assignCommit(): { assigned: boolean; lfoIdx: number } | null {
    if (!state.active || !state.held) return null;
    const h = state.held;
    const lfoIdx = state.lfoSel;
    const already = lfoTargetsParam(h.scope, lfoIdx, comp(h), h.info.ioKey);
    if (already) clearLfoTarget(h.scope, lfoIdx);
    else assignLfoTarget(h.scope, lfoIdx, comp(h), h.info.ioKey);
    resetAssignMode();
    return { assigned: !already, lfoIdx };
}

export function assignToastText(): string {
    if (!state.active || !state.held) return '';
    const h = state.held;
    const name = 'LFO' + (state.lfoSel + 1);
    return lfoTargetsParam(h.scope, state.lfoSel, comp(h), h.info.ioKey)
        ? 'CLICK: REMOVE <' + name + '> MOD'
        : 'CLICK: MODULATE <' + name + '>';
}

export function resetAssignMode(): void { state.held = null; state.active = false; state.lfoSel = 0; }
