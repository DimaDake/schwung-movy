/* The open edit group — what makes many mutations into one undo.
 *
 * A gesture spans ticks (a knob is turned over hundreds of them), so a lexical
 * withEdit(fn) wrapper cannot express it. Instead a group is opened, stays
 * open, and closes on a policy:
 *
 *   IMMEDIATE      one-shot ops — closed inside the same call
 *   TOUCH_RELEASE  knobs; the capacitive release is the real gesture end
 *   LOOP_WRAP      a live record pass, so two loops give two undos
 *   IDLE(ms)       fallback for turns that arrive with no touch event
 *
 * Re-entrancy is the whole grouping rule: beginEdit with the OPEN group's key
 * joins it; a different key closes the open one first. That single rule gives
 * "one knob coalesces, two knobs split" without either site knowing about the
 * other.
 *
 * Edits still apply immediately as they always did — this only records. */

import { mlog } from '../log.js';
import { seqCmd } from '../seq/engine.js';
import { currentSetUuid } from '../seq/persist.js';
import { engineGeneration } from '../seq/engine.js';
import type { ParamOp, ModuleOp, UiOp, UndoEntry } from './types.js';
import { pushEntry } from './state.js';

export const CLOSE = {
    IMMEDIATE: 0,
    TOUCH_RELEASE: 1,
    LOOP_WRAP: 2,
    IDLE: 3,
} as const;

export interface BeginOpts {
    key: string;      // gesture identity — same key re-enters, different splits
    verb: string;
    target?: string;
    detail?: string;
    close: number;
    idleMs?: number;  // IDLE / TOUCH_RELEASE fallback; default IDLE_MS
    seq?: boolean;    // this gesture can change engine state → snapshot it
}

const IDLE_MS = 600;

interface OpenGroup {
    key: string;
    verb: string;
    target: string;
    detail: string;
    close: number;
    idleMs: number;
    snapId: number;   // -1 = no engine snapshot
    paramOps: ParamOp[];
    uiOps: UiOp[];
    moduleOp?: ModuleOp;
    lastActivityMs: number;
}

let open: OpenGroup | null = null;
/* Monotonic; never reused within a session, so a stale uswap can only miss. */
let nextSnapId = 1;

export function groupOpen(): boolean { return open !== null; }
export function openGroupKey(): string | null { return open ? open.key : null; }

function now(): number {
    return typeof Date !== 'undefined' && Date.now ? Date.now() : 0;
}

export function beginEdit(o: BeginOpts): void {
    if (open) {
        if (open.key === o.key) {
            open.lastActivityMs = now();
            return;             // same gesture, still going
        }
        endEdit();              // a different gesture starts: close the old one
    }
    const snapId = o.seq ? nextSnapId++ : -1;
    open = {
        key: o.key,
        verb: o.verb,
        target: o.target ?? '',
        detail: o.detail ?? '',
        close: o.close,
        idleMs: o.idleMs ?? IDLE_MS,
        snapId,
        paramOps: [],
        uiOps: [],
        lastActivityMs: now(),
    };
    /* Snapshot BEFORE the gesture's first mutation. The caller opens the group
     * first and mutates second; the batched command queue preserves that order
     * within the tick. */
    if (snapId >= 0) seqCmd('usnap ' + snapId);
}

/** Record a param write into the open group. Silently ignored with no group —
 *  the guard in record.ts is what reports that, with the offending key. */
export function addParamOp(op: ParamOp): void {
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
    if (!open) return;
    open.lastActivityMs = now();
    const prev = open.uiOps.find((u) => u.field === op.field);
    if (prev) prev.new = op.new;
    else open.uiOps.push(op);
}

export function addModuleOp(op: ModuleOp): void {
    if (!open) return;
    open.lastActivityMs = now();
    open.moduleOp = op;
}

/** Mark engine activity so an IDLE group's timer restarts. */
export function noteEditActivity(): void {
    if (open) open.lastActivityMs = now();
}

export function setDetail(detail: string): void {
    if (open) open.detail = detail;
}

export function setVerb(verb: string, target?: string): void {
    if (!open) return;
    open.verb = verb;
    if (target !== undefined) open.target = target;
}

/**
 * Close the open group and push it — unless nothing changed.
 *
 * `key` closes only that group, so a release handler can't close a gesture that
 * already gave way to another.
 */
export function endEdit(key?: string): void {
    if (!open) return;
    if (key !== undefined && open.key !== key) return;
    const g = open;
    open = null;

    /* Param no-ops are decided here; engine no-ops are decided by the engine,
     * which is the only side that can compare full state. It reports back via
     * `unop` and the entry is retracted then (apply.ts). */
    const paramOps = g.paramOps.filter((p) => p.old !== p.new);
    const uiOps = g.uiOps.filter((u) => u.old !== u.new);
    const hasSeq = g.snapId >= 0;
    if (paramOps.length === 0 && uiOps.length === 0 && !g.moduleOp && !hasSeq) return;

    if (hasSeq) seqCmd('ucommit ' + g.snapId);

    const entry: UndoEntry = {
        verb: g.verb,
        target: g.target,
        detail: g.detail,
        paramOps,
        uiOps,
        setUuid: currentSetUuid(),
        engineGen: engineGeneration(),
    };
    if (hasSeq) entry.seqSnap = { before: g.snapId, after: -1 };
    if (g.moduleOp) entry.moduleOp = g.moduleOp;
    pushEntry(entry);
}

/** Close whatever is open without pushing — used when the stack is invalidated
 *  under a live gesture (set switch, engine reload). */
export function abandonGroup(): void {
    if (!open) return;
    if (open.snapId >= 0) seqCmd('udrop ' + open.snapId);
    open = null;
}

/** Signalled by the record path when the watched clip wraps. */
export function onLoopWrap(): void {
    if (open && open.close === CLOSE.LOOP_WRAP) {
        mlog('undo: rec pass closed at wrap');
        endEdit();
    }
}

/** Drives the time-based close policies. Called once per app tick. */
export function undoTick(): void {
    if (!open) return;
    if (open.close !== CLOSE.IDLE && open.close !== CLOSE.TOUCH_RELEASE) return;
    /* TOUCH_RELEASE keeps the idle timer as a backstop: knob turns can arrive
     * with the touch note dropped, and a group that never closes would swallow
     * every later edit into one undo. */
    if (now() - open.lastActivityMs >= open.idleMs) endEdit();
}

/** Test hook. */
export function resetUndoGroups(): void {
    open = null;
    nextSnapId = 1;
}

/** Test hook: the id the next seq group will use. */
export function peekNextSnapId(): number { return nextSnapId; }
