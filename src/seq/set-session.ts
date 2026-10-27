/* Which Set movy is in, and whether movy is live. The only owner of both.
 *
 * These used to be four variables in three files — `curUuid === null`,
 * `engineReady()`, `engineGeneration() === restoredGen`, and implicitly whether
 * a status poll had landed — so every caller reassembled the answer, and the
 * combinations nobody thought about were where the bugs lived. One shipped as
 * #4/#5/#6: a Set resolving after the user had already played into the engine
 * pushed that Set's state — nothing, for a new Set — over the live pattern.
 *
 * Identity is the library's: the Set the UI wants (set-lib-session.ts). Every
 * change of Set is a switch, and nothing ever waits on identity. */

import { aiSetWillChange } from '../ai/job.js';
import { paramGet, paramSet } from '../host/param.js';
import { mlog } from '../log.js';
import { engineAbsent, engineAbsentReason, engineCaughtUp, engineGeneration, engineMark, engineReady } from './engine.js';
import { seqState } from './state.js';
import { beginSettle, resetSettle, settleCheck, settleOutstanding, settleWaited } from './set-settle.js';
import { deliverChainPayloads } from '../track/chain-payload.js';
import { refreshModelsForSet } from '../app/model-refresh.js';
import { readUiBlob } from './persist-store.js';
import { clearUiDirty } from './ui-dirty.js';
import { resetUiState } from './ui-state.js';
import { loadSet } from './set-load.js';
import { migrationPending, resetVersionRestore, restoreTick } from './version-restore.js';
import { pollMigrationProgress, resetMigrateAction } from './migrate-action.js';
import { saveNeeded, saveSet } from './set-save.js';
import { resetWantedSet } from './set-source.js';
import { resetLib } from './sets-lib.js';
import { libraryBlocked, libraryIdentity, libraryTick, resetLibSession } from './set-lib-session.js';

export type Phase = 'booting' | 'loading' | 'settling' | 'ready' | 'switching' | 'failed';
export type FailScope = 'set' | 'engine';

const SAVE_TICKS = 600;      // ~3-8 s: the device tick is 63-205 Hz and varies with load
const SET_POLL_TICKS = 96;   // ~0.5 s: catch a set switch

let phase: Phase = 'booting';
let setId = '';
let setName = '';
/* The engine generation whose contents we authored. A re-dlopened engine comes
 * up EMPTY, so a generation we did not load into is not one we may save from. */
let loadedGen = -1;
/* The request stream's position once the open went out: a status that has not
 * caught up with it still describes the Set before, so its `sbad` is not ours. */
let openMark = -1;
let saveCountdown = SAVE_TICKS;
let pollCountdown = 1;
let failReason = '';
/* Whether the thing that failed is THIS SET or the engine underneath it. Only
 * a set-scoped failure has a recovery movy can offer, because the only
 * recovery it has is to blank the set — which cannot fix an engine that never
 * started, and would destroy a set that is perfectly fine. */
let failScope: FailScope = 'set';

export function sessionPhase(): Phase { return phase; }
export function sessionError(): string { return failReason; }
export function sessionFailScope(): FailScope { return failScope; }
/* set-fail.ts drives these: the failure states and their one recovery live
 * there so this file stays the lifecycle and nothing else. */
export function setPhase(p: Phase): void { phase = p; }
export function setFailure(reason: string, scope: FailScope = 'set'): void {
    failReason = reason; failScope = scope; phase = 'failed';
}
export function clearFailure(): void {
    failReason = ''; failScope = 'set'; phase = 'booting'; pollCountdown = 1;
}
export function sessionReady(): boolean { return phase === 'ready'; }
/* The Set is identified and its state is in the engine — true from the moment
 * loading finishes, whether or not the modules have arrived. The lifecycle uses
 * it wherever the question is "do we have a Set?" rather than "can it play?":
 * the identity poll and the engine-reload guard both run during settling. */
function live(): boolean { return phase === 'ready' || phase === 'settling'; }
/* What the splash is waiting on, for the renderer. */
export function chainLoadsPending(): number {
    return phase === 'settling' ? seqState.chainPending : 0;
}
export function currentSetUuid(): string { return setId; }

/** Re-enter the load path for the Set already open — what a restore needs once
 *  the files on disk have changed under it. Deliberately the SAME path a set
 *  switch takes, so a restore inherits the settle wait and the module reload
 *  rather than inventing its own. */
export function reloadCurrentSet(): void {
    if (!setId && !setName) return;
    aiSetWillChange();
    enterLoading(setId, setName);
}

export function resetSetSession(): void {
    phase = 'booting';
    setId = ''; setName = ''; loadedGen = -1; openMark = -1;
    saveCountdown = SAVE_TICKS; pollCountdown = 1;
    failReason = '';
    failScope = 'set';
    resetSettle();
    resetVersionRestore();
    resetMigrateAction();
    clearUiDirty();
    resetWantedSet();
    resetLib();
    resetLibSession();
}

function enterLoading(id: string, name: string): void {
    phase = 'loading';
    /* No version capture here: the engine's Open job adopts and captures
     * before it reads, where it already knows what it is about to overwrite.
     * Nor a read of the state file: whether it parses is the engine's answer
     * too (`unreadableOpen`). */
    loadSet(id);
    openMark = engineMark();
    setId = id; setName = name;
    if (!readUiBlob(id)) resetUiState();
    clearUiDirty();
    loadedGen = engineGeneration();
    /* Loaded is not playable. `restoreChains` (via the UI blob above) only
     * QUEUES the module loads — the engine releases one per audio callback, and
     * each is a 78-276 ms dlopen — so going ready here put a live-looking
     * surface in front of a Set whose instruments did not exist yet. Settling
     * is that gap, made visible. */
    phase = 'settling';
    beginSettle();
    mlog('seq: loaded set ' + id);
}

/* Promote a loaded Set to a playable one — set-settle.ts owns what that means. */
function settleTick(): void {
    const r = settleCheck();
    if (r === 'wait') return;
    /* The loads have drained, which means the shim's param mailbox is free for
     * the first time since the document went out: NOW a chain's preset blob,
     * LFOs and level can actually land. Issued here rather than in
     * `restoreChains` because there they raced the very loads they follow, and
     * lost — see chain-payload.ts. Promotion waits on them, so a Set never goes
     * playable with its modules still at factory defaults. */
    if (!deliverChainPayloads() && r !== 'capped') return;
    if (r === 'capped') mlog('seq: settle cap reached — ' + settleOutstanding());
    /* Last, and only once the engine is holding the Set: the UI's own caches.
     * Every model reads its module name and param hierarchy on a ~1 s poll, so
     * without this the first live frame was drawn from answers older than the
     * Set — an empty slot on a cold open, the previous Set's module after a
     * switch, for as long as the poll took to come round. */
    refreshModelsForSet();
    phase = 'ready';
    mlog('seq: set ready after ' + settleWaited() + 'ms');
}

/* A Set whose files are on disk but unreadable is the case worth naming: a
 * silent blank is exactly how a set "disappears" from the user's point of view.
 * The engine finds out on its saver thread, possibly after the Set has already
 * settled, so this is asked while live rather than once. It holds no Set it
 * could autosave over the files meanwhile. */
function unreadableOpen(): boolean {
    if (!setId || seqState.setBad !== setId || !engineCaughtUp(openMark)) return false;
    failReason = 'SET FILE UNREADABLE';
    failScope = 'set';
    mlog('seq: FAILED — ' + setId + ' has a state file that will not parse');
    phase = 'failed';
    return true;
}

/* Every change of Set is a switch, and a switch into a Set with no state of
 * its own starts blank. */
function identityChanged(id: string, name: string): void {
    phase = 'switching';
    sessionFlush(true);
    enterLoading(id, name);
}

export function sessionFlush(force = false): void {
    if (!setId) return;
    if (engineGeneration() !== loadedGen) return;   // not our engine — see the tick
    if (!saveNeeded() && !force) return;
    saveSet(setId, force);
    /* A forced flush is a teardown or a set switch. The one capture that is a
     * command: the engine cannot see either, and this is the last chance this
     * Set has to record where it got to. */
    if (force) paramSet('set', 'keep exit');
}

export function sessionTick(): void {
    /* No engine, and none coming (movy-host loads it once, before ui.js):
     * say so, rather than showing a loading screen that will never finish. A
     * MISMATCH is an engine from another build than this ui.js — a partial
     * install or deploy — and names itself, because "did not start" would
     * send the user looking for a crash. */
    if (engineAbsent()) {
        if (phase !== 'failed') {
            const mismatch = engineAbsentReason() === 'mismatch';
            failReason = mismatch ? 'ENGINE MISMATCH' : 'ENGINE DID NOT START';
            failScope = 'engine';
            mlog('seq: FAILED — ' + (mismatch
                ? 'the engine is from another build than ui.js'
                : 'the engine never answered'));
            phase = 'failed';
        }
        return;
    }
    /* Both answers arrive on a later tick than the command that asked for them
     * — a saver thread cannot be awaited from here. */
    /* The splash before the library's first answer is where the automatic
     * migration runs, and the Settings row is where the manual one does. */
    pollMigrationProgress(!live() || migrationPending());
    if (restoreTick()) { reloadCurrentSet(); return; }
    if (phase === 'failed') return;   // waiting on the user
    if (!engineReady()) {
        if (live()) phase = 'booting';   // the engine went away
        return;
    }
    /* A generation we did not load into is an EMPTY engine: push the Set back
     * before anything can save from it. */
    if (live() && engineGeneration() !== loadedGen) {
        enterLoading(setId, setName);
        return;
    }
    if (libraryBlocked()) {
        setFailure(libraryBlocked(), 'engine');
        return;
    }
    libraryTick(setId, live());
    if (--pollCountdown <= 0) {
        /* Fast until the library has answered: the splash is up meanwhile. */
        pollCountdown = live() ? SET_POLL_TICKS : 8;
        const want = libraryIdentity();
        if (want) {
            if (!live()) enterLoading(want.uuid, want.name);
            else if (want.uuid !== setId) identityChanged(want.uuid, want.name);
        }
        if (!live()) return;
    }

    if (unreadableOpen()) return;
    if (phase === 'settling') { settleTick(); return; }   // nothing to autosave yet

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;
    sessionFlush();
}
