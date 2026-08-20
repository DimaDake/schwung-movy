/* Reading and writing one LFO's values through a scope's port.
 *
 * The only place that knows the key spellings the chain host accepts, and the
 * clamps that keep a corrupt or absent value from reaching the page. Pure
 * functions of a scope, so the model above holds state and gestures only. */

import { setChainParam } from '../chain/set-param.js';
import { beginGesture } from '../undo/edit.js';
import { lfoKey, type LfoScope } from './scope.js';
import { LFO_SHAPES, LFO_DIVISIONS, RATE_HZ_MIN, RATE_HZ_MAX } from './params.js';

export interface LfoVals {
    target: string; targetParam: string;
    shape: number; polarity: number; sync: number;
    rateHz: number; rateDiv: number;
    depth: number; phase: number; retrigger: number;
}

export function blankVals(): LfoVals {
    return { target: '', targetParam: '', shape: 0, polarity: 0, sync: 0,
        rateHz: 1.0, rateDiv: 19, depth: 0, phase: 0, retrigger: 0 };
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampF = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function readLfoVals(scope: LfoScope, lfoIdx: number): LfoVals {
    const g = (k: string) => scope.port.getParam(lfoKey(scope, lfoIdx, k));
    return {
        target: g('target') || '',
        targetParam: g('target_param') || '',
        shape: clampI(parseInt(g('shape') || '0', 10) || 0, 0, LFO_SHAPES.length - 1),
        polarity: g('polarity') === '1' ? 1 : 0,
        sync: g('sync') === '1' ? 1 : 0,
        rateHz: clampF(parseFloat(g('rate_hz') || '1') || 1, RATE_HZ_MIN, RATE_HZ_MAX),
        rateDiv: clampI(parseInt(g('rate_div') || '19', 10) || 19, 0, LFO_DIVISIONS.length - 1),
        depth: clampF(parseFloat(g('depth') || '0') || 0, -1, 1),
        phase: clampF(parseFloat(g('phase_offset') || '0') || 0, 0, 1),
        retrigger: g('retrigger') === '1' ? 1 : 0,
    };
}

/** One knob-turn's worth of edit: grouped for undo, then written. */
export function writeLfoParam(scope: LfoScope, lfoIdx: number, key: string, val: string): void {
    const full = lfoKey(scope, lfoIdx, key);
    const old = scope.port.getParam(full);
    beginGesture('lfo:' + scope.id + ':' + full, key.toUpperCase(), scope.label, false);
    setChainParam(scope.port, full, val, old);
}
