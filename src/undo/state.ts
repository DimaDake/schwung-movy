/* The undo and redo stacks.
 *
 * In memory only, and per set: a snapshot id addresses state inside one
 * engine's ring, so it means nothing after a set switch or an engine reload
 * (a reloaded engine comes up EMPTY — see seq/persist.ts). Both cases clear
 * the stacks rather than risk restoring a set's state over another's. */

import { mlog } from '../log.js';
import type { UndoEntry } from './types.js';

/** Mirrors MAX_SNAPSHOTS in engine/crates/seq-core/src/undo.rs. */
export const MAX_ENTRIES = 64;

const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];

/* Snapshot ids whose engine-side slot is now unreachable (evicted or dropped
 * with a cleared stack). Drained by apply.ts, which owns the engine link, so
 * this file stays free of IPC. */
const orphanedSnaps: number[] = [];

function orphan(e: UndoEntry): void {
    if (!e.seqSnap) return;
    orphanedSnaps.push(e.seqSnap.before);
    if (e.seqSnap.after >= 0) orphanedSnaps.push(e.seqSnap.after);
}

export function takeOrphanedSnaps(): number[] {
    return orphanedSnaps.splice(0, orphanedSnaps.length);
}

/** Push a completed entry. A new edit invalidates redo, as everywhere else. */
export function pushEntry(e: UndoEntry): void {
    while (redoStack.length > 0) orphan(redoStack.pop()!);
    undoStack.push(e);
    while (undoStack.length > MAX_ENTRIES) orphan(undoStack.shift()!);
}

export function popUndo(): UndoEntry | null {
    return undoStack.pop() ?? null;
}

export function popRedo(): UndoEntry | null {
    return redoStack.pop() ?? null;
}

export function pushRedo(e: UndoEntry): void {
    redoStack.push(e);
}

/** Undo re-applied: the entry goes back on the undo stack, not through
 *  pushEntry, which would wrongly clear the redo stack it came from. */
export function pushUndoBack(e: UndoEntry): void {
    undoStack.push(e);
}

export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }
export function undoDepth(): number { return undoStack.length; }
export function redoDepth(): number { return redoStack.length; }
export function peekUndo(): UndoEntry | null {
    return undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
}

/* The engine decided a committed group changed nothing. The entry was pushed
 * optimistically one status poll ago (~40 ms), so it is normally the newest —
 * but a fast second gesture can land on top, hence the search.
 *
 * The engine can only speak for ENGINE state. An entry that also carries param,
 * UI or module work is not a no-op just because no note moved — dropping it
 * wholesale is what made module swaps, LFO assignment and file loads record an
 * undo entry and then silently discard it. Those keep the entry and lose only
 * the (already freed) snapshot. */
export function retractEntry(snapId: number): boolean {
    for (let i = undoStack.length - 1; i >= 0; i--) {
        const e = undoStack[i];
        if (e.seqSnap?.before !== snapId) continue;
        /* `before` is already gone — the engine dropped it as the no-op it was
         * — so only a captured `after` could still be orphaned. */
        if (e.seqSnap.after >= 0) orphanedSnaps.push(e.seqSnap.after);
        if (e.paramOps.length === 0 && e.uiOps.length === 0 && !e.moduleOp) {
            undoStack.splice(i, 1);
            return true;
        }
        delete e.seqSnap;   // nothing left engine-side; the rest still stands
        return false;
    }
    return false;
}

export function invalidateUndo(reason: string): void {
    if (undoStack.length === 0 && redoStack.length === 0) return;
    mlog('undo: cleared (' + reason + ')');
    while (undoStack.length > 0) orphan(undoStack.pop()!);
    while (redoStack.length > 0) orphan(redoStack.pop()!);
}

/** Test hook. */
export function resetUndoState(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    orphanedSnaps.length = 0;
}
