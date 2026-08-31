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
import { componentPort } from '../track/registry.js';
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
/* A fixed settle is a GUESS about someone else's timing, and a wrong guess is
 * silent: the preset's rewrite lands after our values and the restore looks
 * like it did nothing. So the write is verified — read the params back, rewrite
 * whatever the DSP has since overwritten, and repeat. Bounded, because a param
 * that will not hold its value (one the DSP derives, or clamps) would otherwise
 * loop forever. */
const VERIFY_ROUNDS = 3;
const VERIFY_TICKS = 30;   // ~0.2 s between rounds

type Phase = 'wait' | 'lead' | 'settle' | 'verify';

interface Pending {
    op: ModuleOp;
    /* schwung's whole-module blob for the side being restored, when the module
     * supports it. Present = params below are unused. */
    state: string | null;
    /* Which side's params to replay. Restoring the OLD module writes what it
     * held; restoring the NEW one writes what IT held — replaying the old
     * module's values into the new module (or into an emptied slot) put
     * meaningless numbers wherever the keys happened to collide. */
    params: [string, string][];
    leadCount: number;
    /* Identifiers that mean "the module we asked for is up". Empty = we asked
     * for an empty slot, so an empty read is the arrival. */
    wantIds: string[];
    /* Whether a further undo must wait. A module SWAP is settling — a second
     * undo would write params into a module about to be replaced again. An
     * in-place param restore has no such hazard: nothing is loading, and a
     * second undo simply supersedes it. Blocking on that made every preset
     * undo refuse the next press for a third of a second. */
    blocksUndo: boolean;
    phase: Phase;
    ticksLeft: number;
    settleLeft: number;
    verifyLeft: number;
    roundsLeft: number;
}

let pending: Pending | null = null;

export function moduleRestorePending(): boolean {
    return pending !== null && pending.blocksUndo;
}

/** Begin replaying `op`'s dump. `undoing` picks which module we are waiting
 *  for: undo returns to the old one, redo to the new. */
export function beginModuleRestore(op: ModuleOp, undoing: boolean): void {
    pending = {
        op,
        state: (undoing ? op.oldState : op.newState) ?? null,
        params: undoing ? op.oldParams : (op.newParams ?? []),
        leadCount: undoing ? op.leadCount : (op.newLeadCount ?? 0),
        wantIds: undoing ? op.oldIds : op.newIds,
        blocksUndo: true,
        phase: 'wait',
        ticksLeft: RESTORE_TIMEOUT_TICKS,
        settleLeft: SETTLE_TICKS,
        verifyLeft: VERIFY_TICKS,
        roundsLeft: VERIFY_ROUNDS,
    };
}

/**
 * Restore params into the module that is ALREADY loaded — the fallback path for
 * a preset or randomiser on a module with no state blob.
 *
 * Same staged writer as a module restore (selector/preset first, settle, then
 * the params the preset rewrites, then verify), minus the wait: nothing is
 * being loaded, so the module is ready by definition.
 */
export function beginParamRestore(
    slot: number, componentKey: string,
    params: [string, string][], leadCount: number,
    verifyOnly = false,
): void {
    if (params.length === 0) return;
    pending = {
        op: { slot, componentKey, oldWrite: '', newWrite: '', oldIds: [], newIds: [],
              oldParams: [], leadCount: 0 },
        state: null,
        params,
        leadCount,
        wantIds: [],
        blocksUndo: false,
        /* verifyOnly: a state blob has already restored the module, so writing
         * the params again would be worse than useless. The lead is the preset,
         * and re-writing it makes the DSP RELOAD that preset — throwing away
         * what the blob just restored, then taking hundreds of individual writes
         * while it is mid-load. Surge XT came back silent or noisy from exactly
         * that. Verify instead: read back, and rewrite only what the module
         * actually failed to restore. */
        phase: verifyOnly ? 'verify' : 'lead',
        ticksLeft: RESTORE_TIMEOUT_TICKS,
        settleLeft: SETTLE_TICKS,
        verifyLeft: VERIFY_TICKS,
        roundsLeft: VERIFY_ROUNDS,
    };
}

/* The loaded module's identity. Read with `moduleReadKey`, NOT the key it was
 * written with: a track chain slot is set as `synth:module` but reports under
 * the alias `synth_module`, and reading the colon form there returns null. */
function liveModuleId(op: ModuleOp): string {
    if (typeof shadow_get_param !== 'function') return '';
    return componentPort(op.slot, op.componentKey)
        .getParam(moduleReadKey(op.componentKey)) || '';
}

/* Ready = the right module AND its params exist. The second half is what makes
 * a late-loading module (Virus: ROM first, params after) restorable at all —
 * without it the whole dump is written into a module that has not published
 * anything yet, and every value is dropped. */
function moduleIsReady(p: Pending): boolean {
    const live = liveModuleId(p.op);
    if (p.wantIds.length === 0) return live === '';        // cleared slot
    if (!p.wantIds.includes(live)) return false;
    if (p.state === null && p.params.length === 0) return true;   // nothing to write
    const cp = typeof shadow_get_param === 'function'
        ? componentPort(p.op.slot, p.op.componentKey).getParam(p.op.componentKey + ':chain_params')
        : null;
    return !!cp && cp !== '[]';
}

function write(p: Pending, from: number, to: number): void {
    /* Untracked: this IS the undo. Recording these writes would push a fresh
     * entry for the restore itself and the stack would never drain. */
    for (let i = from; i < to; i++) {
        const [key, val] = p.params[i];
        setChainParamUntracked(componentPort(p.op.slot, p.op.componentKey),
                               p.op.componentKey + ':' + key, val);
    }
}

/* The DSP echoes a value in its own formatting — "0.42" for the "0.4200" we
 * wrote — so a textual compare would call every float a mismatch and rewrite
 * the whole dump on every round. */
function sameValue(a: string, b: string): boolean {
    if (a === b) return true;
    const x = parseFloat(a), y = parseFloat(b);
    if (isNaN(x) || isNaN(y)) return false;
    return Math.abs(x - y) < 1e-4;
}

/* Rewrite whatever the DSP has overwritten since we set it. Returns how many
 * needed it — 0 means the restore has actually taken. */
function rewriteDrifted(p: Pending): number {
    if (typeof shadow_get_param !== 'function') return 0;
    let fixed = 0;
    /* Only the params after the lead: re-writing the preset would re-trigger
     * the very rewrite being corrected for. */
    for (let i = p.leadCount; i < p.params.length; i++) {
        const [key, want] = p.params[i];
        const full = p.op.componentKey + ':' + key;
        const port = componentPort(p.op.slot, p.op.componentKey);
        const live = port.getParam(full);
        if (live === null || sameValue(live, want)) continue;
        setChainParamUntracked(port, full, want);
        fixed++;
    }
    return fixed;
}

/* Enter the verify phase — or skip it when there is nothing it could check
 * (an emptied slot, or a dump that is all preset). Waiting out a verify round
 * with no params to read would only make the restore feel slower. */
function toVerify(p: Pending, op: ModuleOp): void {
    if (p.params.length <= p.leadCount) { finish(op); return; }
    p.phase = 'verify';
}

function finish(op: ModuleOp): void {
    /* LAST, and only after the params: re-pointing an LFO hands it the param we
     * have just restored, so the base has to be in place first. Blocking writes
     * — the three fields are one commit and non-blocking writes to the single
     * param slot clobber each other (see lfo/assign.ts). */
    for (const [key, val] of op.oldLfo ?? []) {
        /* Through the port: the slot-addressed API refuses a movy track's index
         * and would drop the restore silently (see lfo/assign.ts). */
        componentPort(op.slot, op.componentKey).setParamTimeout(key, val, 100);
    }
    if ((op.oldLfo?.length ?? 0) > 0) mlog('undo: restored ' + op.oldLfo!.length + ' LFO assignment fields');
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

    if (pending.phase === 'lead') {
        /* Already-loaded module: go straight to writing. */
        write(pending, 0, pending.leadCount);
        if (pending.leadCount > 0) {
            mlog('undo: restored ' + pending.leadCount + ' selector/preset params');
            pending.phase = 'settle';
            return;
        }
        write(pending, 0, pending.params.length);
        mlog('undo: replayed ' + pending.params.length + ' params');
        toVerify(pending, op);
        return;
    }

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
        /* One blob, applied by the DSP itself — no ordering to get right, no
         * settle to wait out, and it covers params movy never sees. */
        if (pending.state !== null) {
            setChainParamUntracked(componentPort(op.slot, op.componentKey),
                                   op.componentKey + ':state', pending.state);
            mlog('undo: restored module state (' + pending.state.length + ' bytes)');
            /* Trust the blob, then check it. A module that cannot parse its own
             * state is repaired by the verify pass; one that can pays nothing. */
            if (pending.params.length > pending.leadCount) pending.phase = 'verify';
            else finish(op);
            return;
        }
        write(pending, 0, pending.leadCount);
        if (pending.leadCount > 0) {
            mlog('undo: restored ' + pending.leadCount + ' selector/preset params');
            pending.phase = 'settle';
            return;
        }
        write(pending, 0, pending.params.length);
        mlog('undo: replayed ' + pending.params.length + ' params');
        toVerify(pending, op);
        return;
    }

    if (pending.phase === 'settle') {
        /* The preset is rewriting the module's params; our values go in after
         * it, so they are what survives. */
        if (--pending.settleLeft > 0) return;
        write(pending, pending.leadCount, pending.params.length);
        mlog('undo: replayed ' + pending.params.length + ' params ('
            + pending.leadCount + ' lead + ' + (pending.params.length - pending.leadCount)
            + ' after settle)');
        toVerify(pending, op);
        return;
    }

    /* verify: read back, and put right anything the DSP has overwritten since. */
    if (--pending.verifyLeft > 0) return;
    pending.verifyLeft = VERIFY_TICKS;
    const fixed = rewriteDrifted(pending);
    if (fixed > 0) mlog('undo: verify rewrote ' + fixed + ' param(s) the DSP had overwritten');
    if (fixed > 0 && --pending.roundsLeft > 0) return;
    if (fixed > 0) mlog('undo: ' + fixed + ' param(s) would not hold their value');
    finish(op);
}

/** Test hook. */
export function resetModuleRestore(): void {
    pending = null;
}
