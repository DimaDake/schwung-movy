/* browser-test/logic/set-restore-loss.mjs — what a DROPPED restore does to a
 * saved Set.
 *
 * Run by browser-test/logic.mjs.
 *
 * Why this exists: movy ferries a Set into the engine through the overtake_dsp
 * param SHM, which is a SINGLE SLOT with four producers (shim, shadow_ui, the
 * chain forwarder, the test daemon) plus the remote-UI socket. `movy/CLAUDE.md`
 * already records that writes into that slot are "routinely lost". The restore
 * write is `host_module_set_param_blocking('state', ...)`, which RETURNS a
 * boolean — and `set-load.ts:pushState` discards it.
 *
 * So the question this suite pins down: if that write never lands, what does
 * the next autosave write over the Set on disk?
 */
import {
    installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine,
    writeStateBlob, readBestState, resetStoreRotation, BLANK_STATE, ok, eq, _log,
} from './harness.mjs';

/* A Set with real content: an automation lane and a clip. */
const GOOD = 'movy1\nbpm 12000\nau 0 0 50 synth:octave_transpose\ncl 0 0 16 0 0:24:60:100\n';

/* Run `body` with every `state` write dropped, exactly as a starved slot would
 * leave it — the call returns false and the engine never sees the payload. */
async function withDroppedStateWrite(body) {
    const real = globalThis.host_module_set_param_blocking;
    globalThis.host_module_set_param_blocking = (k, v, t) =>
        (k === 'state' ? false : real(k, v, t));
    try { return await body(); } finally { globalThis.host_module_set_param_blocking = real; }
}

export async function run() {
_log('\nTest: a dropped restore must not cost the Set');

const { saveSet, resetSetSave } = await import('../../dist/esm/seq/set-save.js');
const { pushState } = await import('../../dist/esm/seq/set-load.js');
const { seqState } = await import('../../dist/esm/seq/state.js');

/* ── The guard that works ─────────────────────────────────────────────────
 * An engine that answers `null` is one we could not read at all, and saveSet
 * refuses to write anything. This is real protection and must not regress. */
{
    installMockFs({});
    const eng = installMockEngine();
    resetSetSave(); resetStoreRotation();
    writeStateBlob('S', GOOD, 1);

    eng.stateBlob = null;
    await withDroppedStateWrite(async () => { pushState(GOOD); });
    seqState.dirty = true;
    const r = saveSet('S', 1, true);

    eq('an unreadable engine does not get written to disk', r.wrote, false);
    eq('and the Set on disk is untouched', readBestState('S').payload, GOOD);
    uninstallMockEngine(); uninstallMockFs();
}

/* ── The gap ──────────────────────────────────────────────────────────────
 * A FRESH engine instance — what a reload leaves behind — holds a blank but
 * entirely VALID state. That is not null, so the guard above does not fire:
 * the autosave reads the blank, sees it differs from the last good payload,
 * and writes it over the Set at a HIGHER generation, which then wins every
 * future restore.
 *
 * !!! THE ASSERTIONS BELOW ENCODE A BUG, NOT THE DESIRED BEHAVIOUR. !!!
 *
 * They are written this way deliberately, on an explicit decision to capture
 * the hazard before changing production persistence. `wrote` should be false
 * and the payload should still be GOOD. When the guard is added — the obvious
 * shape is for pushState to check the boolean it currently discards, and for
 * the save to refuse until the restore is CONFIRMED — flip these two
 * assertions rather than deleting them.
 *
 * Reproduced on device while migrating test-auto.sh: a fixture blob of
 * au=1 cl=2 size=670 came back as au=0 cl=0 size=209. */
{
    installMockFs({});
    const eng = installMockEngine();
    resetSetSave(); resetStoreRotation();
    writeStateBlob('S', GOOD, 1);

    eng.stateBlob = BLANK_STATE;
    await withDroppedStateWrite(async () => { pushState(GOOD); });
    seqState.dirty = true;
    const r = saveSet('S', 1, true);

    ok('KNOWN GAP: a blank engine IS written to disk after a dropped restore',
        r.wrote === true, `wrote=${r.wrote}`);
    ok('KNOWN GAP: and the Set on disk is replaced by the blank state',
        readBestState('S').payload === BLANK_STATE,
        JSON.stringify(readBestState('S').payload).slice(0, 60));

    /* Not part of the gap: the loss is recoverable, because the version
     * history rides each save. Asserting it here keeps that mitigation from
     * quietly disappearing while the gap is open. */
    ok('the blank write is a higher generation, so it wins later restores',
        readBestState('S').gen > 1, String(readBestState('S').gen));
    uninstallMockEngine(); uninstallMockFs();
}
}
