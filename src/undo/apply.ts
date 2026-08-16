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

import { portFor } from '../track/registry.js';
import { mlog } from '../log.js';
import { seqCmd, engineGeneration, requestLabelSync } from '../seq/engine.js';
import { currentSetUuid } from '../seq/persist.js';
import {
    canRedo, canUndo, invalidateUndo, popRedo, popUndo, pushRedo, pushUndoBack,
    retractEntry, takeOrphanedSnaps,
} from './state.js';
import { abandonGroup, endEdit } from './group.js';
import { beginModuleRestore, beginParamRestore, moduleRestorePending } from './module-apply.js';
import type { UndoEntry, UndoResult } from './types.js';
import { writeUiField, type UiField } from './ui-fields.js';
import { changeDetail } from './label.js';
import { refreshModels, syncParamsToModels } from './param-sync.js';
import { moduleReadKey } from '../chain/config.js';
import { captureModuleState, dumpModuleParams, stateIsParsable } from './module-dump.js';

/* Snapshot ids allocated for the redo side of a uswap. Shares the counter with
 * group.ts by staying above it — group ids are odd-free and monotonic, so a
 * separate high range keeps the two from ever colliding. */
let nextRestoreId = 1_000_000;

function setChain(slot: number, key: string, value: string): void {
    portFor(slot).setParam(key, value);
}

/** Free engine slots the stacks have let go of. Called from the app tick. */
export function flushOrphanedSnaps(): void {
    for (const id of takeOrphanedSnaps()) seqCmd('udrop ' + id);
}

/* A live module that is neither side of the recorded swap means something
 * changed behind our back — movy can be parked with Back while the user swaps a
 * module in Move's own UI. Param VALUES are never asserted this way: automation
 * and LFOs move them continuously, so asserting would make param undo never fire.
 *
 * "Neither side", not "not the expected side": the write only REQUESTS a load,
 * so a user who hits Undo before it lands still reads the old module — and
 * treating that as drift would wipe the stack over a race. Either side is fine,
 * because restoring the one already live is simply a no-op. */
function moduleDrifted(e: UndoEntry, _undoing: boolean): boolean {
    const op = e.moduleOp;
    if (!op || typeof shadow_get_param !== 'function') return false;
    const live = portFor(op.slot).getParam( moduleReadKey(op.componentKey)) || '';
    if (live === '') return false;   // unreadable or a cleared slot: can't tell
    return !op.oldIds.includes(live) && !op.newIds.includes(live);
}

function applyEntry(e: UndoEntry, undoing: boolean): void {
    const op = e.moduleOp;
    if (op) {
        /* Capture the module we are about to swap AWAY from, once. At record
         * time it did not exist yet, so this is the only chance to learn what
         * redo should restore — without it, redo put the OLD module's values
         * into the new one. */
        if (undoing && op.newParams === undefined && op.newState === undefined) {
            const st = captureModuleState(op.slot, op.componentKey);
            if (st !== null) {
                op.newState = st;
                op.newParams = [];
                op.newLeadCount = 0;
            } else {
                const d = dumpModuleParams(op.slot, op.componentKey);
                op.newParams = d.params;
                op.newLeadCount = d.leadCount;
            }
        }
        /* Writing always uses the colon key, whichever slot kind this is — only
         * the read side has the underscore alias. */
        setChain(op.slot, op.componentKey + ':module', undoing ? op.oldWrite : op.newWrite);
        /* Params are replayed by module-apply.ts once the module reports up;
         * writing them now would land on a module that is being torn down. */
        beginModuleRestore(op, undoing);
    }
    for (let i = e.uiOps.length - 1; i >= 0; i--) {
        const u = e.uiOps[i];
        writeUiField(u.field as UiField, undoing ? u.old : u.new);
    }
    /* Undoing a preset change restores the whole module instead of writing the
     * old index back: the index alone would make the DSP re-apply that preset's
     * DEFAULTS and discard whatever the user had tweaked since. Redo takes the
     * param path, because redo really is "pick that preset again". */
    if (e.stateOp && (undoing || e.paramOps.length === 0)) {
        const op = e.stateOp;
        /* Capture the result before undoing it — a randomiser cannot be redone
         * by firing it again (that rolls a different patch), so the only way
         * back is the state it produced. */
        if (undoing && op.newState === undefined && e.paramOps.length === 0) {
            op.newState = captureModuleState(op.slot, op.componentKey) ?? '';
            const d = dumpModuleParams(op.slot, op.componentKey, op.newState);
            op.newParams = d.params;
            op.newLeadCount = d.leadCount;
        }
        const blob = undoing ? op.oldState : op.newState;
        if (blob) {
            setChain(op.slot, op.componentKey + ':state', blob);
            mlog('undo: restored ' + op.componentKey + ' state (' + blob.length + ' bytes)');
        }
        /* The dump is the fallback, and the check on a blob that cannot be
         * trusted. Which of those applies depends on where its values came from:
         *
         *   - Values READ per param are an independent record, so they can tell
         *     us the module failed to restore itself (weird-dreams) and put it
         *     right.
         *   - Values PARSED from the blob are the same data the blob holds.
         *     Comparing them against a module that just applied that blob proves
         *     nothing about correctness — only about timing. Surge XT takes a
         *     moment to settle a patch, so the check caught it mid-apply and
         *     "corrected" 225 params into a half-loaded synth, which is what
         *     left it silent or noisy.
         *
         * So: verify only when the dump is genuinely independent of the blob. */
        const ps = undoing ? op.oldParams : op.newParams;
        const lead = (undoing ? op.oldLeadCount : op.newLeadCount) ?? 0;
        const derivedFromBlob = stateIsParsable(blob);
        if (ps && ps.length > 0 && !derivedFromBlob) {
            beginParamRestore(op.slot, op.componentKey, ps, lead, !!blob);
        }
        refreshModels(op.slot);
    } else {
        /* Reverse order: a gesture that wrote A then B must undo B then A, or a
         * later write that depended on an earlier one lands on the wrong base. */
        for (let i = e.paramOps.length - 1; i >= 0; i--) {
            const p = e.paramOps[i];
            setChain(p.slot, p.key, undoing ? p.old : p.new);
        }
        /* The write went straight to the DSP; the models mirror these values and
         * would otherwise keep showing the pre-undo reading for seconds. */
        if (e.paramOps.length > 0) syncParamsToModels(e.paramOps);
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

/* The toast shows what actually changed and which way. A value change is worth
 * more than the label baked at record time, so it replaces `detail` when there
 * is one; edits with no single value (a clip clear) keep their own wording. */
function result(e: UndoEntry, undoing: boolean): UndoResult {
    const change = changeDetail(e, undoing);
    return { ok: true, verb: e.verb, target: e.target, detail: change || e.detail };
}

const NOTHING = (reason: string): UndoResult =>
    ({ ok: false, verb: '', target: '', detail: '', reason });

export function undoOnce(): UndoResult {
    /* A gesture still in progress is part of what the user wants undone. */
    endEdit();
    /* A module swap is still settling: a second undo now would write params
     * into a module that is about to be replaced again. */
    if (moduleRestorePending()) return NOTHING('busy');
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
    if (moduleRestorePending()) return NOTHING('busy');
    if (!canRedo()) return NOTHING('empty');
    const e = popRedo()!;
    if (moduleDrifted(e, false)) {
        invalidateUndo('module drift');
        return NOTHING('drift');
    }
    applyEntry(e, false);
    pushUndoBack(e);
    mlog('redo: ' + e.verb + ' ' + e.target);
    return result(e, false);
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
    lastUuid = null;
    lastGen = -1;
}
