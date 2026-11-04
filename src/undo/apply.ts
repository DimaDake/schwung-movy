/* Undo and redo: the stacks driven, a generator session first in line
 * (ai/preview-undo.ts), and the invalidation that clears them. Applying one
 * entry, and the order that takes, is apply-entry.ts. */

import { aiSessionOpen, commitPreview } from '../ai/preview.js';
import { aiRedo, aiUndoFirst, aiUndoTop } from '../ai/preview-undo.js';
import { mlog } from '../log.js';
import { seqCmd, engineGeneration } from '../seq/engine.js';
import { currentSetUuid } from '../seq/set-session.js';
import {
    canRedo, canUndo, invalidateUndo, peekUndo, popRedo, popUndo, pushRedo, pushUndoBack,
    retractEntry, takeOrphanedSnaps,
} from './state.js';
import { abandonGroup, endEdit } from './group.js';
import { moduleRestorePending } from './module-apply.js';
import type { UndoEntry, UndoResult } from './types.js';
import { changeDetail } from './label.js';
import { applyEntry, moduleDrifted, resetRestoreIds } from './apply-entry.js';

/** Free engine slots the stacks have let go of. Called from the app tick. */
export function flushOrphanedSnaps(): void {
    for (const id of takeOrphanedSnaps()) seqCmd('udrop ' + id);
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
    /* A generator preview on screen takes the undo step by step (ai/preview-undo.ts);
     * below ORIG it closes and may hand back its entry to take back here. */
    const ai = aiUndoFirst((e) => { applyEntry(e, true); pushRedo(e); });
    if (ai) return ai;
    /* A gesture still in progress is part of what the user wants undone. */
    endEdit();
    /* A module swap is still settling: a second undo now would write params
     * into a module that is about to be replaced again. */
    if (moduleRestorePending()) return NOTHING('busy');
    if (!canUndo()) return NOTHING('empty');
    const reopened = aiUndoTop(peekUndo());
    if (reopened) return reopened;
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
    const ai = aiRedo();
    if (ai !== 'pass') return ai.result;
    if (aiSessionOpen()) commitPreview('redo');
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
    resetRestoreIds();
    lastUuid = null;
    lastGen = -1;
}
