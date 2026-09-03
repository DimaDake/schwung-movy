/* Which Set movy is in, and whether movy is live. The only owner of both.
 *
 * These used to be four variables in three files — `curUuid === null`,
 * `engineReady()`, `engineGeneration() === restoredGen`, and implicitly whether
 * a status poll had landed — so every caller reassembled the answer, and the
 * combinations nobody thought about were where the bugs lived. One shipped as
 * #4/#5/#6: a Set resolving after the user had already played into the engine
 * pushed that Set's state — nothing, for a new Set — over the live pattern.
 *
 * Identity is DISCOVERED, not known at open. schwung works under a synthetic
 * `__pending-<index>-<seq>` id for a measured 12-60 s while Move materialises
 * the real Set, and that id can change more than once before it resolves. So
 * every identity change asks one question — does the incoming Set already have
 * state? — and nothing ever waits on identity. */

import { mlog } from '../log.js';
import { engineAbsent, engineGeneration, engineReady } from './engine.js';
import { seqState } from './state.js';
import { beginSettle, resetSettle, settleCheck, settleOutstanding, settleWaited } from './set-settle.js';
import {
    BLANK_STATE, fileExists, isProvisionalUuid, readActiveSetAny, rememberSet, removeSetState,
    uuidToStatePath,
} from './set-context.js';
import { deliverChainPayloads } from '../track/chain-payload.js';
import { refreshModelsForSet } from '../app/model-refresh.js';
import { collectDeadSets } from './set-gc.js';
import { resetSetCommit, setCommitTick } from './set-commit.js';
import { readBestState, readUiBlob, writeStateBlob, writeUiBlob } from './persist-store.js';
import { clearUiDirty, markUiStateDirty } from './ui-dirty.js';
import { resetUiState } from './ui-state.js';
import { loadSet, setHasState } from './set-load.js';
import { adoptSaved, resetSetSave, saveNeeded, saveSet, savedPayload } from './set-save.js';

export type Phase = 'booting' | 'loading' | 'settling' | 'ready' | 'switching' | 'failed';

const SAVE_TICKS = 600;      // ~3-8 s: the device tick is 63-205 Hz and varies with load
const SET_POLL_TICKS = 96;   // ~0.5 s: catch a set switch, including on resume

let phase: Phase = 'booting';
let setId = '';
let setName = '';
let gen = 0;
/* The engine generation whose contents we authored. A re-dlopened engine comes
 * up EMPTY, so a generation we did not load into is not one we may save from. */
let loadedGen = -1;
let saveCountdown = SAVE_TICKS;
let pollCountdown = 1;
let failReason = '';
/* Dead-set collection is a once-per-session sweep, not a per-load one. */
let collected = false;

export function sessionPhase(): Phase { return phase; }
export function sessionError(): string { return failReason; }
/* set-fail.ts drives these: the failure states and their one recovery live
 * there so this file stays the lifecycle and nothing else. */
export function setPhase(p: Phase): void { phase = p; }
export function setFailure(reason: string): void { failReason = reason; phase = 'failed'; }
export function clearFailure(): void { failReason = ''; phase = 'booting'; pollCountdown = 1; }
export function currentGen(): number { return gen; }
export function bumpGen(): void { gen++; }
export function sessionReady(): boolean { return phase === 'ready'; }
/* The Set is identified and its state is in the engine — true from the moment
 * loading finishes, whether or not the modules have arrived. The lifecycle uses
 * it wherever the question is "do we have a Set?" rather than "can it play?":
 * the identity poll, the engine-reload guard, and the commit press all run
 * during settling. */
function live(): boolean { return phase === 'ready' || phase === 'settling'; }
/* What the splash is waiting on, for the renderer. */
export function chainLoadsPending(): number {
    return phase === 'settling' ? seqState.chainPending : 0;
}
export function currentSetUuid(): string { return setId; }

export function resetSetSession(): void {
    phase = 'booting';
    setId = ''; setName = ''; gen = 0; loadedGen = -1;
    saveCountdown = SAVE_TICKS; pollCountdown = 1;
    failReason = '';
    resetSettle();
    collected = false;
    resetSetSave();
    resetSetCommit();
    clearUiDirty();
}

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

/* Carry the work in hand to a Set that has none of its own — Move having
 * finally materialised the Set movy was already working in. */
function rename(toId: string, toName: string): void {
    const from = setId;
    /* Capture what the engine is holding RIGHT NOW, not what was last written.
     * The whole point of a rename is the work done since the last autosave —
     * carrying the durable bytes would hand the new Set the blank state the
     * provisional one was born with, which is the bug this rewrite exists to
     * kill, just relocated. */
    const r = saveSet(from, gen, true);
    if (r.ok) gen = r.gen;
    const payload = savedPayload() || readBestState(from)?.payload || '';
    if (payload && writeStateBlob(toId, payload, gen + 1)) {
        gen++;
        adoptSaved(payload);
        const ui = readUiBlob(from);
        if (ui) writeUiBlob(toId, ui);
        /* Only once the bytes are durable under the new id. The pad's directory
         * is now a stale copy of this Set, and leaving it is how a device grows
         * a `__pending-*` tree that nothing will ever read. */
        if (isProvisionalUuid(from)) removeSetState(from);
    } else {
        /* Nothing durable yet — the live UI state is still this Set's, so the
         * next save has to write it rather than assume it is already on disk. */
        markUiStateDirty();
    }
    setId = toId; setName = toName;
    rememberSet(toName, toId);
    mlog('seq: set renamed ' + from + ' -> ' + toId);
}

function enterLoading(id: string, name: string): void {
    phase = 'loading';
    /* A Set whose blob is on disk but unreadable is the case worth naming: the
     * loader falls back to blank, and a silent blank is exactly how a set
     * "disappears" from the user's point of view. */
    const stored = readBestState(id);
    if (stored === null && fileExists(uuidToStatePath(id))) {
        failReason = 'SET FILE UNREADABLE';
        mlog('seq: FAILED — ' + id + ' has a state file that will not parse');
        setId = id; setName = name;
        phase = 'failed';
        return;
    }
    const st = loadSet(id, name);
    setId = id; setName = name; gen = st.gen;
    adoptSaved(st.payload);
    if (!readUiBlob(id)) resetUiState();
    rememberSet(name, id);
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
    /* After the Set is live, never before: collecting is pure hygiene and must
     * never delay the instrument becoming playable. Once per session. */
    if (!collected) { collected = true; collectDeadSets(setId); }
}

/* The one rule, and the whole of it: a rename is the ONE transition where the
 * id changed but the Set did not — schwung's provisional id being replaced by
 * the real one Move finally materialised. Everything else is a switch, and a
 * switch into a Set with no state of its own starts blank.
 *
 * It used to turn on "does the incoming Set have state?" alone, which made
 * every switch into an unseen Set a rename: delete a Set in Move, and the Set
 * Move made in its place inherited the deleted one's sequence — the deleted Set
 * appearing to come back. schwung answers the same question the other way
 * (SET_CHANGED seeds an unseen set with empty slots), and a blank load here is
 * that same empty seed in movy's terms.
 *
 * BOTH ends are tested. Leaving a provisional id for another provisional id is
 * a different set PAD, not the same Set arriving late — schwung mints a new
 * `__pending-<index>-<seq>` per pad, and it does not re-mint while you sit on
 * one. Renaming there carried a pad's sequence AND its modules onto the next
 * pad, which is what a user hit switching between two Sets Move had never
 * materialised.
 *
 * The residual: leaving a provisional id for a REAL Set movy has never seen is
 * a rename too, because telling that apart from materialisation needs the
 * incoming Set's song index and no host API exposes it. Materialisation is the
 * common case, and carrying work that did not belong here can be undone where
 * discarding work cannot. */
function identityChanged(id: string, name: string, provisional: boolean): void {
    if (!setHasState(id) && isProvisionalUuid(setId) && !provisional) {
        rename(id, name);
        return;
    }
    phase = 'switching';
    sessionFlush(true);
    enterLoading(id, name);
}

export function sessionFlush(force = false): void {
    if (!setId || !filesAvailable()) return;
    if (engineGeneration() !== loadedGen) return;   // not our engine — see the tick
    if (!saveNeeded() && !force) return;
    const r = saveSet(setId, gen, force);
    if (r.ok) gen = r.gen;
}

export function sessionTick(): void {
    /* The engine stopped being probed: say so, rather than showing a loading
     * screen that will never finish. */
    if (engineAbsent()) {
        if (phase !== 'failed') {
            failReason = 'ENGINE DID NOT START';
            mlog('seq: FAILED — the engine never answered');
            phase = 'failed';
        }
        return;
    }
    if (phase === 'failed') return;   // waiting on the user
    if (!engineReady()) {
        if (live()) phase = 'booting';   // the engine went away
        return;
    }
    /* No file APIs: movy cannot persist anything, but it must still play. Going
     * ready with no Set keeps the instrument usable instead of gating it
     * forever behind a load that can never happen — the autosave and the
     * identity poll below both no-op without a Set. */
    if (!filesAvailable()) {
        if (!sessionReady()) {
            phase = 'ready';
            loadedGen = engineGeneration();
            mlog('seq: no file API — running without per-set persistence');
        }
        return;
    }
    /* A generation we did not load into is an EMPTY engine: push the Set back
     * before anything can save from it. */
    if (live() && engineGeneration() !== loadedGen) {
        enterLoading(setId, setName);
        return;
    }
    if (--pollCountdown <= 0) {
        pollCountdown = SET_POLL_TICKS;
        const active = readActiveSetAny();
        /* Never wait on identity: the measured pending window is 12-60 s and
         * unbounded above, so movy works under whatever id it has — schwung's
         * provisional one, or `_default` when there is no answer at all — and
         * the rename carries the work when a real id arrives. */
        const id = active ? active.id.uuid : '_default';
        const name = active ? active.id.name : '';
        const provisional = active ? active.provisional : true;
        /* Settling counts as having a Set: re-entering the load here would
         * restart every module load the settle is waiting on, every half
         * second, and the wait would never end. */
        if (!live()) enterLoading(id, name);
        else if (id !== setId) identityChanged(id, name, provisional);
        if (!live()) return;
    }
    /* A Set Move never committed loses BOTH stores on the next visit, so ask it
     * to commit before anything is recorded into a namespace with no future.
     * Run from `settling` too, and told whether the chain loads have drained:
     * the press borrows the surface, so it must land after the last dlopen but
     * still inside the splash. */
    setCommitTick(setId, live(), seqState.chainPending === 0);

    if (phase === 'settling') { settleTick(); return; }   // nothing to autosave yet

    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;
    sessionFlush();
}
