/* main-page-apply.ts — the ABSOLUTE-VALUE half of Main Params, and the ONLY
 * writer of its eight fields.
 *
 * `main-page.ts`'s `mainPageKnob`/`mainPageRelease` (movy's own delta/overlay
 * gesture) and the virtual-component seam's per-cell `set()`
 * (`seq/set-params-contract.ts`, SP-53 — Schwung computes an absolute value,
 * never a delta, and calls one of these with it) both call these eight and
 * nothing else. Split from `main-page.ts` to keep that file under the
 * 200-line cap, same reason `app/page-owner-virtual.ts` exists — not a second
 * question, the same one asked from two callers.
 *
 * Each clamps, no-ops on an unchanged value where that matters, and opens its
 * OWN undo gesture keyed exactly like the delta path's `beginGesture` did —
 * coalescing still works because the key is unchanged, whichever caller
 * reaches it.
 */

import { seqState } from './state.js';
import { beginGesture } from '../undo/edit.js';
import { recordUiOp } from '../undo/record.js';
import { readUiField, writeUiField } from '../undo/ui-fields.js';
import { seqCmd } from './engine.js';
import { scheduleTempoOverride } from './tempo-override.js';
import { SCALE_NAMES } from './scales.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { keyboardState } from '../keyboard/state.js';
import { setRootPc } from '../keyboard/handler.js';
import { QUANT_VALUES } from './quant.js';
import { markUiStateDirty } from './ui-dirty.js';
import { K_TEMPO, K_SWING, K_QUANT, K_ROOT, K_KEY, BPM_MIN_X100, BPM_MAX_X100, SWING_MIN, SWING_MAX }
    from './main-page-constants.js';

const KNOB_VERBS: Record<number, string> = {
    [K_TEMPO]: 'TEMPO', [K_SWING]: 'SWING', [K_QUANT]: 'DEFAULT QUANT',
    [K_ROOT]: 'ROOT', [K_KEY]: 'KEY',
};

export function applyTempoX100(bpmX100: number): void {
    const next = Math.max(BPM_MIN_X100, Math.min(BPM_MAX_X100, bpmX100));
    if (next === seqState.bpmX100) return;
    beginGesture('mainknob:' + K_TEMPO, KNOB_VERBS[K_TEMPO], '');
    seqState.bpmX100 = next;
    seqCmd('bpm ' + next);
    // Also drive Move's device-wide tempo via the Link override, so a
    // following Move tracks the knob (design §7 Phase 3).
    scheduleTempoOverride(next);
}

export function applySwing(pct: number): void {
    const next = Math.max(SWING_MIN, Math.min(SWING_MAX, pct));
    if (next === seqState.swingPct) return;
    beginGesture('mainknob:' + K_SWING, KNOB_VERBS[K_SWING], '');
    seqState.swingPct = next;
    seqCmd('swing ' + next);
}

/** LINK is excluded from undo entirely (design §1) — it is not a musical edit. */
export function applyLink(on: boolean): void {
    if (on === seqState.linkEnabled) return;
    seqState.linkEnabled = on;
    seqCmd('link ' + (on ? 1 : 0));
    markUiStateDirty();
}

export function applyDefaultQuantIdx(idx: number): void {
    /* Goes through writeUiField so the three places the default lives —
     * seqState, the engine (which stamps new clips) and prefs.json (which
     * carries it into the next new set) — can never drift apart. */
    const i = Math.max(0, Math.min(QUANT_VALUES.length - 1, idx));
    if (QUANT_VALUES[i] === seqState.defaultQuant) return;
    const before = readUiField('defaultQuant');
    beginGesture('mainknob:' + K_QUANT, KNOB_VERBS[K_QUANT], '');
    writeUiField('defaultQuant', String(QUANT_VALUES[i]));
    recordUiOp('defaultQuant', before, readUiField('defaultQuant'));
}

/** Cycles the pitch class, wrapping B↔C; the +/- buttons own the octave.
 *  NOTE: under delegation Schwung's own enum stepper CLAMPS rather than wraps
 *  (knob_engine.mjs's enum branch) — a knob-feel difference this item
 *  accepts, same posture as SU-9/13 (an upstream ask if it becomes a
 *  complaint, not fixed pre-emptively). */
export function applyRootPc(pc: number): void {
    const before = readUiField('rootPc');
    beginGesture('mainknob:' + K_ROOT, KNOB_VERBS[K_ROOT], '');
    setRootPc(pc);
    recordUiOp('rootPc', before, readUiField('rootPc'));
}

/** KEY commits and IS undoable — the only one of the three overlay knobs
 *  that is: MODE and LAYOUT are keyboard layout, which design §1 excludes. */
export function applyScaleIdx(idx: number): void {
    const clamped = Math.max(0, Math.min(SCALE_NAMES.length - 1, idx));
    const before = readUiField('scale');
    beginGesture('mainknob:' + K_KEY, KNOB_VERBS[K_KEY], '');
    keyboardState.scale = clamped;
    markUiStateDirty();
    recordUiOp('scale', before, readUiField('scale'));
}

export function applyModeIdx(idx: number): void {
    const clamped = Math.max(0, Math.min(MODE_NAMES.length - 1, idx));
    keyboardState.mode = clamped;
    // Chromatic and In Key both offer two layouts, so the index carries over;
    // the clamp is here so adding a third option later can't strand it.
    keyboardState.layout = Math.min(keyboardState.layout, layoutNames(clamped).length - 1);
    markUiStateDirty();
}

export function applyLayoutIdx(idx: number): void {
    const names = layoutNames(keyboardState.mode);
    keyboardState.layout = Math.max(0, Math.min(names.length - 1, idx));
    markUiStateDirty();
}
