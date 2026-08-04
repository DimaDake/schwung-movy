/* Applying an undo or a redo.
 *
 * Order within an entry matters and is fixed here:
 *   1. module swap   (async — the params below may belong to it)
 *   2. param ops     (reverse of recording order)
 *   3. engine uswap  (atomic capture-then-restore)
 *   4. requestLabelSync()
 *
 * Step 4 is not optional. An automation lane is bound on TWO sides: the engine
 * holds lane_assigned/base/label (inside the snapshot), and schwung holds the
 * chain-knob mapping `knob_<N>_set` (NOT in the snapshot). Restoring a snapshot
 * that changes lane assignment therefore leaves schwung pointing at the old
 * param — automation drives the wrong thing, or silently nothing, with an
 * intact-looking UI. seq/persist.ts pairs every state restore with a label sync
 * for exactly this reason; an undo restore is the same operation. */

import { mlog } from '../log.js';
import { seqCmd, engineGeneration, requestLabelSync } from '../seq/engine.js';
import { currentSetUuid } from '../seq/persist.js';
import {
    canRedo, canUndo, invalidateUndo, popRedo, popUndo, pushRedo, pushUndoBack,
    retractEntry, takeOrphanedSnaps,
} from './state.js';
import { abandonGroup, endEdit } from './group.js';
import type { UndoEntry, UndoResult } from './types.js';

/* Snapshot ids allocated for the redo side of a uswap. Shares the counter with
 * group.ts by staying above it — group ids are odd-free and monotonic, so a
 * separate high range keeps the two from ever colliding. */
let nextRestoreId = 1_000_000;

function setChain(slot: number, key: string, value: string): void {
    if (typeof shadow_set_param === 'function') shadow_set_param(slot, key, value);
}

/** Free engine slots the stacks have let go of. Called from the app tick. */
export function flushOrphanedSnaps(): void {
    for (const id of takeOrphanedSnaps()) seqCmd('udrop ' + id);
}

/* A live module id that isn't what the entry recorded means something changed
 * behind our back — movy can be parked with Back while the user swaps a module
 * in Move's own UI. Param VALUES are never asserted this way: automation and
 * LFOs move them continuously, so asserting would make param undo never fire. */
function moduleDrifted(e: UndoEntry, undoing: boolean): boolean {
    const op = e.moduleOp;
    if (!op || typeof shadow_get_param !== 'function') return false;
    /* Undo expects the module the entry LOADED to still be live; redo expects
     * the one it replaced, since undo put that back. */
    const expect = undoing ? op.newModuleId : op.oldModuleId;
    const live = shadow_get_param(op.slot, op.componentKey + ':module') || '';
    return live !== expect;
}

function applyEntry(e: UndoEntry, undoing: boolean): void {
    const op = e.moduleOp;
    if (op) {
        const targetId = undoing ? op.oldModuleId : op.newModuleId;
        setChain(op.slot, op.componentKey + ':module', targetId);
        /* Params are replayed by module-apply.ts once the module reports up;
         * writing them now would land on a module that is being torn down. */
        beginPendingParams(e, undoing);
    }
    /* Reverse order: a gesture that wrote A then B must undo B then A, or a
     * later write that depended on an earlier one lands on the wrong base. */
    for (let i = e.paramOps.length - 1; i >= 0; i--) {
        const p = e.paramOps[i];
        setChain(p.slot, p.key, undoing ? p.old : p.new);
    }
    if (e.seqSnap) {
        const restore = undoing ? e.seqSnap.before : e.seqSnap.after;
        const capture = nextRestoreId++;
        seqCmd('uswap ' + restore + ' ' + capture);
        if (undoing) e.seqSnap.after = capture;
        else e.seqSnap.before = capture;
        /* See the header: the schwung-side lane mapping is not in the snapshot. */
        requestLabelSync();
    }
}

/* Module param replay is asynchronous (the module has to come up first). The
 * queue is drained by module-apply.ts; kept as a hook so apply.ts has no
 * knowledge of the polling. */
let pendingParams: { entry: UndoEntry; undoing: boolean } | null = null;
function beginPendingParams(entry: UndoEntry, undoing: boolean): void {
    pendingParams = { entry, undoing };
}
export function takePendingModuleRestore(): { entry: UndoEntry; undoing: boolean } | null {
    const p = pendingParams;
    pendingParams = null;
    return p;
}

function result(e: UndoEntry, ok: boolean, reason?: string): UndoResult {
    const r: UndoResult = { ok, verb: e.verb, target: e.target, detail: e.detail };
    if (reason) r.reason = reason;
    return r;
}

const NOTHING = (reason: string): UndoResult =>
    ({ ok: false, verb: '', target: '', detail: '', reason });

export function undoOnce(): UndoResult {
    /* A gesture still in progress is part of what the user wants undone. */
    endEdit();
    if (!canUndo()) return NOTHING('empty');
    const e = popUndo()!;
    if (moduleDrifted(e, true)) {
        invalidateUndo('module drift');
        return NOTHING('drift');
    }
    applyEntry(e, true);
    pushRedo(e);
    mlog('undo: ' + e.verb + ' ' + e.target);
    return result(e, true);
}

export function redoOnce(): UndoResult {
    endEdit();
    if (!canRedo()) return NOTHING('empty');
    const e = popRedo()!;
    if (moduleDrifted(e, false)) {
        invalidateUndo('module drift');
        return NOTHING('drift');
    }
    applyEntry(e, false);
    pushUndoBack(e);
    mlog('redo: ' + e.verb + ' ' + e.target);
    return result(e, true);
}

/* ── Invalidation ──────────────────────────────────────────────────────── */

let lastUuid: string | null = null;
let lastGen = -1;

/** Watch the two things that make a snapshot id meaningless. Called per tick;
 *  both comparisons are against values the UI already holds. */
export function undoWatchContext(): void {
    const uuid = currentSetUuid();
    if (lastUuid !== null && uuid !== lastUuid) {
        abandonGroup();
        invalidateUndo('set switch');
    }
    lastUuid = uuid;

    const gen = engineGeneration();
    if (lastGen >= 0 && gen !== lastGen) {
        /* A reloaded engine is a different, EMPTY engine: its ring holds none
         * of our snapshots, so every id on the stack is a dangling reference. */
        abandonGroup();
        invalidateUndo('engine reload');
    }
    lastGen = gen;
}

/** The engine reported (via `unop`) that a committed group changed nothing. */
export function onEngineNoop(snapId: number): void {
    if (retractEntry(snapId)) mlog('undo: dropped no-op ' + snapId);
}

/** Test hook. */
export function resetUndoApply(): void {
    nextRestoreId = 1_000_000;
    pendingParams = null;
    lastUuid = null;
    lastGen = -1;
}
