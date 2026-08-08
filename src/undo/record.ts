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
import { addParamOp, addStateOp, addUiOp, groupOpen, noteEditActivity } from './group.js';
import { captureModuleState, dumpModuleParams } from './module-dump.js';
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
        if (sideEffectDepth > 0) return;
        const verb = verbOf(op);
        if (isUndoableVerb(verb)) {
            if (!groupOpen()) violation('ungrouped edit "' + op + '"');
            else noteEditActivity();
        } else if (!isControlVerb(verb)) {
            violation('unclassified verb "' + verb + '"');
        }
    });
}

/* Depth, not a boolean: side effects nest (a lane cleanup inside a label sync
 * inside a module restore). */
let sideEffectDepth = 0;

/**
 * Run mutating engine commands that are a CONSEQUENCE of an edit already
 * recorded elsewhere — movy tidying up after itself, not the user acting.
 *
 * The canonical case is an automation lane dropped because its module went
 * away: the module swap's own snapshot already holds that lane, so recording
 * the cleanup would both duplicate it and, worse, stack an entry on top of the
 * swap so Undo cleared a lane instead of restoring the module.
 *
 * This is the engine-side twin of setChainParamUntracked. Both exist so
 * "deliberately not undoable" is visible at the call site instead of looking
 * like an omission — and neither silences the guard for anything else.
 */
export function seqSideEffect(fn: () => void): void {
    sideEffectDepth++;
    try {
        fn();
    } finally {
        sideEffectDepth--;
    }
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

/**
 * Record the module's whole state before a PRESET change.
 *
 * Cheap enough here and nowhere else: this is one blocking read per preset
 * GESTURE (the group is re-entrant, so repeated detents do not repeat it), and
 * every one of those detents already makes the DSP load a whole preset. The
 * same read on an ordinary knob turn would be a different story — `perf.mjs`
 * caps chain reads at 2 per tick and each costs ~3-5 ms on device, which is a
 * large slice of a 5-16 ms tick that also samples MIDI input.
 */
export function recordPresetState(slot: number, componentKey: string): void {
    if (!groupOpen()) return;
    /* BOTH, when both are available — they cover different ground and neither
     * is sufficient alone.
     *
     * The blob reaches state movy cannot see (anything the module keeps but
     * does not publish in chain_params), so it is applied first and broadly.
     * The dump is the authority for everything movy CAN see, and it is applied
     * after, because a state blob is only as good as the module's own
     * round-trip: weird-dreams' deserializer reads one more master field than
     * its serializer writes, so every field after it lands in the wrong slot
     * and the module restores to silence. A module bug, but one that any
     * consumer of `<component>:state` inherits — schwung's own set reload
     * included — and undo is better placed than most to correct it, since it
     * holds a second, independent record of the same moment.
     *
     * Cost is a read per published param, on a gesture (preset, randomiser,
     * module swap) that is deliberate and rare. */
    const state = captureModuleState(slot, componentKey);
    const d = dumpModuleParams(slot, componentKey);
    if (state === null && d.params.length === 0) return;
    addStateOp({
        slot, componentKey,
        oldState: state ?? '',
        oldParams: d.params, oldLeadCount: d.leadCount,
    });
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
    sideEffectDepth = 0;
}
