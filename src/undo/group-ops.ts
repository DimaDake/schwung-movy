/* What a gesture records into the open edit group (group.ts): its param, UI
 * and module ops, kept apart from the group's open/close state machine. */

import { currentGroup, now } from './group.js';
import type { ModuleOp, ParamOp, StateOp, UiOp } from './types.js';

/** Record a param write into the open group. Silently ignored with no group —
 *  the guard in record.ts is what reports that, with the offending key. */
export function addParamOp(op: ParamOp): void {
    const open = currentGroup();
    if (!open) return;
    open.lastActivityMs = now();
    /* Re-writing a key within one gesture keeps the ORIGINAL old value: the
     * whole point of grouping a knob turn is that undo returns to where the
     * gesture started, not to the previous detent. */
    const prev = open.paramOps.find((p) => p.slot === op.slot && p.key === op.key);
    if (prev) prev.new = op.new;
    else open.paramOps.push(op);
}

/** Record a UI-field change. Like param ops, a repeat within one gesture keeps
 *  the original `old`, so undo returns to where the gesture started. */
export function addUiOp(op: UiOp): void {
    const open = currentGroup();
    if (!open) return;
    open.lastActivityMs = now();
    const prev = open.uiOps.find((u) => u.field === op.field);
    if (prev) prev.new = op.new;
    else open.uiOps.push(op);
}

/** Attach the pre-gesture module state. The FIRST one wins: a preset knob turn
 *  passes several presets on its way, and undo must land on where the gesture
 *  started, not on the last preset it swept through. */
export function addStateOp(op: StateOp): void {
    const open = currentGroup();
    if (!open || open.stateOp) return;
    open.stateOp = op;
}

/** Whether the open group already holds a module snapshot. Callers check this
 *  BEFORE capturing one: the capture is hundreds of blocking reads, and
 *  addStateOp would only discard the result. */
export function hasStateOp(): boolean {
    const open = currentGroup();
    return open !== null && open.stateOp !== undefined;
}

export function addModuleOp(op: ModuleOp): void {
    const open = currentGroup();
    if (!open) return;
    open.lastActivityMs = now();
    open.moduleOp = op;
}

/** Mark engine activity so an IDLE group's timer restarts. */
export function noteEditActivity(): void {
    const open = currentGroup();
    if (open) open.lastActivityMs = now();
}

export function setDetail(detail: string): void {
    const open = currentGroup();
    if (open) open.detail = detail;
}

export function setVerb(verb: string, target?: string): void {
    const open = currentGroup();
    if (!open) return;
    open.verb = verb;
    if (target !== undefined) open.target = target;
}
