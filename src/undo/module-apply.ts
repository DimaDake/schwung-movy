/* Replaying a module dump after an undo swapped the module back.
 *
 * Asynchronous, because a module load is: the write only requests it, and the
 * params must not be pushed until the new module is actually up — writing them
 * at a module being torn down loses them silently. So this polls for the module
 * id to match, then replays, then warms the abs-CC param cache and re-syncs the
 * automation lane labels.
 *
 * Ordering matters and is the reason this runs after the module rather than
 * beside it: automation lanes reference param keys, so the module has to exist
 * before the lane warm can bind them. */

import { mlog } from '../log.js';
import { requestLabelSync } from '../seq/engine.js';
import { requestLaneWarm } from '../seq/automation.js';
import { setChainParamUntracked } from '../chain/set-param.js';
import { invalidateUndo } from './state.js';
import type { ModuleOp } from './types.js';

/* ~1.5 s at the 63-205 Hz device tick. A module that has not appeared by then
 * is not coming, and holding the stack hostage would be worse than dropping it. */
const RESTORE_TIMEOUT_TICKS = 200;

interface Pending {
    op: ModuleOp;
    wantId: string;
    ticksLeft: number;
}

let pending: Pending | null = null;

export function moduleRestorePending(): boolean { return pending !== null; }

/** Begin replaying `op`'s dump. `undoing` picks which module we are waiting
 *  for: undo returns to the old one, redo to the new. */
export function beginModuleRestore(op: ModuleOp, undoing: boolean): void {
    pending = {
        op,
        wantId: undoing ? op.oldModuleId : op.newModuleId,
        ticksLeft: RESTORE_TIMEOUT_TICKS,
    };
}

function liveModuleId(op: ModuleOp): string {
    if (typeof shadow_get_param !== 'function') return '';
    return shadow_get_param(op.slot, op.componentKey + ':module') || '';
}

/** Drive the wait. Called once per app tick. */
export function moduleRestoreTick(): void {
    if (!pending) return;
    const { op, wantId } = pending;

    if (liveModuleId(op) !== wantId) {
        if (--pending.ticksLeft > 0) return;
        /* Give up rather than leave a half-applied undo behind: the module
         * never came back, so the params in hand belong to nothing. */
        mlog('undo: module restore timed out (' + wantId + ')');
        pending = null;
        invalidateUndo('module restore timeout');
        return;
    }

    /* Untracked: this IS the undo. Recording these writes would push a fresh
     * entry for the restore itself and the stack would never drain. */
    for (const [key, val] of op.oldParams) {
        setChainParamUntracked(op.slot, op.componentKey + ':' + key, val);
    }
    mlog('undo: replayed ' + op.oldParams.length + ' params into ' + wantId);
    /* The reload emptied the host's static param cache; without the warm,
     * abs-CC automation is inaudible until a restart (see requestLaneWarm). */
    requestLaneWarm(op.slot);
    requestLabelSync();
    pending = null;
}

/** Test hook. */
export function resetModuleRestore(): void {
    pending = null;
}
