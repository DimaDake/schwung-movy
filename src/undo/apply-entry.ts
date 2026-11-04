/* Applying one undo entry, either way (apply.ts drives the stacks).
 *
 * Order within an entry matters and is fixed here:
 *   1. module swap   (async — the params below may belong to it)
 *   2. param ops     (reverse of recording order)
 *   3. engine uswap  (atomic capture-then-restore)
 *   4. requestLabelSync()
 *
 * Step 4 is not optional. An automation lane is bound on TWO sides: the
 * sequencer holds lane_assigned/base/label (inside the snapshot), and the
 * engine's chain side holds the lane's bind — key, range, value form (NOT in
 * the snapshot, see seq/lane-mapping.ts). Restoring a snapshot that changes lane
 * assignment therefore leaves the bind pointing at the old param — automation
 * drives the wrong thing, or silently nothing, with an intact-looking UI. seq/persist.ts pairs every state restore with a label sync
 * for exactly this reason; an undo restore is the same operation. */

import { componentPort } from '../track/registry.js';
import { mlog } from '../log.js';
import { seqCmd, requestLabelSync } from '../seq/engine.js';
import { beginModuleRestore, beginParamRestore } from './module-apply.js';
import type { UndoEntry } from './types.js';
import { writeUiField, type UiField } from './ui-fields.js';
import { refreshModels } from './param-sync.js';
import { moduleReadKey } from '../chain/config.js';
import { captureModuleState, dumpModuleParams, stateIsParsable } from './module-dump.js';

/* Snapshot ids allocated for the redo side of a uswap. Shares the counter with
 * group.ts by staying above it — group ids are odd-free and monotonic, so a
 * separate high range keeps the two from ever colliding. */
let nextRestoreId = 1_000_000;

/* By COMPONENT, not by slot alone: a master FX or send write is recorded under
 * slot 0 / the root port's index, and `portFor(0)` would namespace it into
 * whatever track 0 holds (`ch0:mfx:…`) — see `componentPort`. */
function setChain(slot: number, key: string, value: string): void {
    const colon = key.indexOf(':');
    componentPort(slot, colon > 0 ? key.slice(0, colon) : key).setParam(key, value);
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
export function moduleDrifted(e: UndoEntry, _undoing: boolean): boolean {
    const op = e.moduleOp;
    if (!op) return false;
    const live = componentPort(op.slot, op.componentKey)
        .getParam(moduleReadKey(op.componentKey)) || '';
    if (live === '') return false;   // unreadable or a cleared slot: can't tell
    return !op.oldIds.includes(live) && !op.newIds.includes(live);
}

export function applyEntry(e: UndoEntry, undoing: boolean): void {
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

/** Test hook. */
export function resetRestoreIds(): void { nextRestoreId = 1_000_000; }
