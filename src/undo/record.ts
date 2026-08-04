/* Recording side: what the rest of movy calls to make an edit undoable.
 *
 * Two entry points, and the guard that makes forgetting them loud:
 *   seqEdit(op)          a mutating engine command, inside a group
 *   recordParamOp(...)   a chain-param write, inside a group
 *
 * The guard hooks seq/engine.ts's seqCmd, so it sees every engine command in
 * the process — including one sent by a new call site that never heard of
 * undo. In tests it throws; on device it logs, because throwing inside the
 * MIDI handler makes shadow_ui exit overtake and the user loses the tool. */

import { mlog } from '../log.js';
import { seqCmd, setEditGuard } from '../seq/engine.js';
import { addParamOp, addUiOp, groupOpen, noteEditActivity } from './group.js';
import { isControlVerb, isUndoableVerb, verbOf } from './verbs.js';
import type { ParamOp } from './types.js';

/* Tests set this; device builds leave it off. */
let strict = false;
export function setUndoStrict(on: boolean): void { strict = on; }

let lastViolation = '';
export function takeUndoViolation(): string {
    const v = lastViolation;
    lastViolation = '';
    return v;
}

function violation(what: string): void {
    lastViolation = what;
    if (strict) throw new Error('undo: ' + what);
    mlog('undo: ' + what);
}

/* Installed once at boot (app/init.ts). Reports a mutating command that no
 * group would have recorded, and an unclassified verb — the UI-side half of
 * the classification guard, catching a verb added to the UI but never taught
 * to command.rs. */
export function installEditGuard(): void {
    setEditGuard((op: string) => {
        const verb = verbOf(op);
        if (isUndoableVerb(verb)) {
            if (!groupOpen()) violation('ungrouped edit "' + op + '"');
            else noteEditActivity();
        } else if (!isControlVerb(verb)) {
            violation('unclassified verb "' + verb + '"');
        }
    });
}

/** A mutating engine command. Identical to seqCmd — the guard does the work —
 *  but the name is the documentation at the call site. */
export function seqEdit(op: string): void {
    seqCmd(op);
}

/** A non-mutating engine command (transport, view, bookkeeping). */
export function seqCtl(op: string): void {
    seqCmd(op);
}

/** Record a chain-param write. `old === null` means the previous value was
 *  never read, which makes the write un-undoable — recorded as a violation
 *  rather than guessed at. */
export function recordParamOp(slot: number, key: string,
                              oldVal: string | null, newVal: string): void {
    if (oldVal === null) {
        violation('param write with no prior value "' + key + '"');
        return;
    }
    if (!groupOpen()) {
        violation('ungrouped param write "' + key + '"');
        return;
    }
    const op: ParamOp = { slot, key, old: oldVal, new: newVal };
    addParamOp(op);
}

/** Record a set-level UI field change (root note, scale). */
export function recordUiOp(field: string, oldVal: string, newVal: string): void {
    if (!groupOpen()) {
        violation('ungrouped ui write "' + field + '"');
        return;
    }
    addUiOp({ field, old: oldVal, new: newVal });
}

/** Test hook. */
export function resetUndoRecord(): void {
    strict = false;
    lastViolation = '';
}
