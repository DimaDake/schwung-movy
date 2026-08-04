/* Replaying a module dump after an undo swapped the module back.
 *
 * Asynchronous, and in stages, because both the load and the preset are:
 *
 *   WAIT   the module id reports back AND it has published chain_params. A
 *          module can report its id before its params exist (osirus/Virus loads
 *          a ROM first), and params written into that gap are dropped.
 *   LEAD   write the selector and preset params (see module-dump.ts for why
 *          they must go first and in that order).
 *   SETTLE let the DSP finish applying the preset — it rewrites most of the
 *          module's params, and airwindows does so a moment AFTER the change.
 *          Writing our values into that window would lose them.
 *   REST   write the user's own parameter values, which must win over whatever
 *          the preset just re-applied.
 *
 * Ordering against the engine matters too, and is why this runs after the
 * module rather than beside it: automation lanes reference param keys, so the
 * module has to exist before the lane warm can bind them. */

import { mlog } from '../log.js';
import { requestLabelSync } from '../seq/engine.js';
import { requestLaneWarm } from '../seq/automation.js';
import { setChainParamUntracked } from '../chain/set-param.js';
import { moduleReadKey } from '../chain/config.js';
import { invalidateUndo } from './state.js';
import type { ModuleOp } from './types.js';

/* ~1.5 s at the 63-205 Hz device tick. A module that has not appeared by then
 * is not coming, and holding the stack hostage would be worse than dropping it. */
const RESTORE_TIMEOUT_TICKS = 200;
/* ~0.4 s. Long enough for a preset's own parameter rewrite to land (including
 * airwindows', which arrives after the change), short enough that a restore
 * still feels immediate. */
const SETTLE_TICKS = 50;

type Phase = 'wait' | 'settle';

interface Pending {
    op: ModuleOp;
    /* Identifiers that mean "the module we asked for is up". Empty = we asked
     * for an empty slot, so an empty read is the arrival. */
    wantIds: string[];
    phase: Phase;
    ticksLeft: number;
    settleLeft: number;
}

let pending: Pending | null = null;

export function moduleRestorePending(): boolean { return pending !== null; }

/** Begin replaying `op`'s dump. `undoing` picks which module we are waiting
 *  for: undo returns to the old one, redo to the new. */
export function beginModuleRestore(op: ModuleOp, undoing: boolean): void {
    pending = {
        op,
        wantIds: undoing ? op.oldIds : op.newIds,
        phase: 'wait',
        ticksLeft: RESTORE_TIMEOUT_TICKS,
        settleLeft: SETTLE_TICKS,
    };
}

/* The loaded module's identity. Read with `moduleReadKey`, NOT the key it was
 * written with: a track chain slot is set as `synth:module` but reports under
 * the alias `synth_module`, and reading the colon form there returns null. */
function liveModuleId(op: ModuleOp): string {
    if (typeof shadow_get_param !== 'function') return '';
    return shadow_get_param(op.slot, moduleReadKey(op.componentKey)) || '';
}

/* Ready = the right module AND its params exist. The second half is what makes
 * a late-loading module (Virus: ROM first, params after) restorable at all —
 * without it the whole dump is written into a module that has not published
 * anything yet, and every value is dropped. */
function moduleIsReady(p: Pending): boolean {
    const live = liveModuleId(p.op);
    if (p.wantIds.length === 0) return live === '';        // cleared slot
    if (!p.wantIds.includes(live)) return false;
    if (p.op.oldParams.length === 0) return true;          // nothing to write
    const cp = typeof shadow_get_param === 'function'
        ? shadow_get_param(p.op.slot, p.op.componentKey + ':chain_params')
        : null;
    return !!cp && cp !== '[]';
}

function write(op: ModuleOp, from: number, to: number): void {
    /* Untracked: this IS the undo. Recording these writes would push a fresh
     * entry for the restore itself and the stack would never drain. */
    for (let i = from; i < to; i++) {
        const [key, val] = op.oldParams[i];
        setChainParamUntracked(op.slot, op.componentKey + ':' + key, val);
    }
}

function finish(op: ModuleOp): void {
    /* The reload emptied the host's static param cache; without the warm,
     * abs-CC automation is inaudible until a restart (see requestLaneWarm). */
    requestLaneWarm(op.slot);
    requestLabelSync();
    pending = null;
}

/** Drive the staged restore. Called once per app tick. */
export function moduleRestoreTick(): void {
    if (!pending) return;
    const { op } = pending;

    if (pending.phase === 'wait') {
        if (!moduleIsReady(pending)) {
            if (--pending.ticksLeft > 0) return;
            /* Give up rather than leave a half-applied undo behind: the module
             * never came back, so the params in hand belong to nothing. */
            mlog('undo: module restore timed out (' + pending.wantIds.join('|') + ')');
            pending = null;
            invalidateUndo('module restore timeout');
            return;
        }
        write(op, 0, op.leadCount);
        if (op.leadCount > 0) {
            mlog('undo: restored ' + op.leadCount + ' selector/preset params');
            pending.phase = 'settle';
            return;
        }
        write(op, 0, op.oldParams.length);
        mlog('undo: replayed ' + op.oldParams.length + ' params');
        finish(op);
        return;
    }

    /* settle: the preset is rewriting the module's params; our values go in
     * after it, so they are what survives. */
    if (--pending.settleLeft > 0) return;
    write(op, op.leadCount, op.oldParams.length);
    mlog('undo: replayed ' + op.oldParams.length + ' params ('
        + op.leadCount + ' lead + ' + (op.oldParams.length - op.leadCount) + ' after settle)');
    finish(op);
}

/** Test hook. */
export function resetModuleRestore(): void {
    pending = null;
}
