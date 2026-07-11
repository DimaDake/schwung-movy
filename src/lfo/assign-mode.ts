/* Hold-a-knob → assign it as a slot-LFO target. A 500ms hold (no turn) of an
 * automatable module param opens assign mode: a bottom toast, jog cycles
 * LFO1/LFO2, jog-click commits (assign or remove). Mode lives only while the
 * knob is held. Pure state + shadow target IO; navigation is done by the router. */

import type { KnobParamInfo } from '../model/store.js';
import { assignLfoTarget, clearLfoTarget, lfoTargetsParam } from './assign.js';

const HOLD_MS = 500;

interface Held { track: number; physK: number; info: KnobParamInfo; pressMs: number; }
const state = { held: null as Held | null, active: false, lfoSel: 0 };

export function holdTouch(track: number, physK: number, info: KnobParamInfo | null): void {
    state.active = false;
    state.held = (info && info.automatable) ? { track, physK, info, pressMs: Date.now() } : null;
}

export function holdTurnCancel(): void { state.held = null; if (state.active) resetAssignMode(); }

export function holdRelease(physK: number): void {
    if (state.held && state.held.physK !== physK) return;
    state.held = null;
    if (state.active) resetAssignMode();
}

/* Promote a 500ms hold-without-turn to assign mode. Returns true on activation. */
export function holdTick(): boolean {
    if (state.active || !state.held) return false;
    if (Date.now() - state.held.pressMs < HOLD_MS) return false;
    state.active = true;
    const { track, info } = state.held;
    state.lfoSel = lfoTargetsParam(track, 0, info.target, info.ioKey) ? 0
        : lfoTargetsParam(track, 1, info.target, info.ioKey) ? 1 : 0;
    return true;
}

export function assignActive(): boolean { return state.active; }

export function assignCycle(_dir: number): void { if (state.active) state.lfoSel ^= 1; }

export function assignCommit(): { assigned: boolean; lfoIdx: number } | null {
    if (!state.active || !state.held) return null;
    const { track, info } = state.held;
    const lfoIdx = state.lfoSel;
    const already = lfoTargetsParam(track, lfoIdx, info.target, info.ioKey);
    if (already) clearLfoTarget(track, lfoIdx);
    else assignLfoTarget(track, lfoIdx, info.target, info.ioKey);
    resetAssignMode();
    return { assigned: !already, lfoIdx };
}

export function assignToastText(): string {
    if (!state.active || !state.held) return '';
    const { track, info } = state.held;
    const name = 'LFO' + (state.lfoSel + 1);
    return lfoTargetsParam(track, state.lfoSel, info.target, info.ioKey)
        ? 'CLICK: REMOVE <' + name + '> MOD'
        : 'CLICK: MODULATE <' + name + '>';
}

export function resetAssignMode(): void { state.held = null; state.active = false; state.lfoSel = 0; }
