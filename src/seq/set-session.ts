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
import { BLANK_STATE, fileExists, readActiveSetAny, rememberSet, uuidToStatePath } from './set-context.js';
import { readBestState, readUiBlob, writeStateBlob, writeUiBlob } from './persist-store.js';
import { clearUiDirty, markUiStateDirty } from './ui-dirty.js';
import { resetUiState } from './ui-state.js';
import { loadSet, setHasState } from './set-load.js';
import { adoptSaved, resetSetSave, saveNeeded, saveSet, savedPayload } from './set-save.js';

export type Phase = 'booting' | 'loading' | 'ready' | 'switching' | 'failed';

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
export function currentSetUuid(): string { return setId; }

export function resetSetSession(): void {
    phase = 'booting';
    setId = ''; setName = ''; gen = 0; loadedGen = -1;
    saveCountdown = SAVE_TICKS; pollCountdown = 1;
    failReason = '';
    resetSetSave();
    clearUiDirty();
}

function filesAvailable(): boolean {
    return typeof host_read_file === 'function' && typeof host_write_file === 'function';
}

/* Carry the work in hand to a Set that has none of its own.
 *
 * The provisional files are left where they are: the host exposes no delete,
 * only read and write. They are a few hundred bytes and nothing reads them
 * again — the same shape as the orphaned `__pending-*` directories schwung
 * accumulates, which is where this whole problem was first visible. */
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
    phase = 'ready';
    mlog('seq: loaded set ' + id);
}

/* The one rule. An incoming Set with state of its own is a switch; one without
 * is this Set, newly named, and the work already in hand belongs to it. */
function identityChanged(id: string, name: string): void {
    if (setHasState(id)) {
        phase = 'switching';
        sessionFlush(true);
        enterLoading(id, name);
        return;
    }
    rename(id, name);
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
        if (phase === 'ready') phase = 'booting';   // the engine went away
        return;
    }
    /* No file APIs: movy cannot persist anything, but it must still play. Going
     * ready with no Set keeps the instrument usable instead of gating it
     * forever behind a load that can never happen — the autosave and the
     * identity poll below both no-op without a Set. */
    if (!filesAvailable()) {
        if (phase !== 'ready') {
            phase = 'ready';
            loadedGen = engineGeneration();
            mlog('seq: no file API — running without per-set persistence');
        }
        return;
    }
    /* A generation we did not load into is an EMPTY engine: push the Set back
     * before anything can save from it. */
    if (phase === 'ready' && engineGeneration() !== loadedGen) {
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
        if (phase !== 'ready') enterLoading(id, name);
        else if (id !== setId) identityChanged(id, name);
        if (phase !== 'ready') return;
    }
    if (--saveCountdown > 0) return;
    saveCountdown = SAVE_TICKS;
    sessionFlush();
}
