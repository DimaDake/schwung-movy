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

const { saveSet, saveNeeded, resetSetSave } = await import('../../dist/esm/seq/set-save.js');
const { pushState } = await import('../../dist/esm/seq/set-load.js');
const { seqState } = await import('../../dist/esm/seq/state.js');
const { resetRestoreGate } = await import('../../dist/esm/seq/restore-gate.js');
const { writeUiBlob, readUiBlob } = await import('../../dist/esm/seq/persist-store.js');

/* ── The guard that works ─────────────────────────────────────────────────
 * An engine that answers `null` is one we could not read at all, and saveSet
 * refuses to write anything. This is real protection and must not regress. */
{
    installMockFs({});
    const eng = installMockEngine();
    resetSetSave(); resetStoreRotation(); resetRestoreGate();
    writeStateBlob('S', GOOD, 1);

    /* The push LANDS here: this block is about the null-read guard, and a
     * dropped push would short-circuit on the restore gate instead, leaving
     * the guard untested. */
    pushState(GOOD);
    eng.stateBlob = null;
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
 * The fix: pushState now REPORTS whether the write landed (it used to discard
 * the boolean), and a Set whose restore did not land is not saved over. The
 * Set on disk is worth more than the blank the engine is holding.
 *
 * Reproduced on device while migrating test-auto.sh: a fixture blob of
 * au=1 cl=2 size=670 came back as au=0 cl=0 size=209. */
{
    installMockFs({});
    const eng = installMockEngine();
    resetSetSave(); resetStoreRotation(); resetRestoreGate();
    writeStateBlob('S', GOOD, 1);

    eng.stateBlob = BLANK_STATE;
    await withDroppedStateWrite(async () => { pushState(GOOD); });
    seqState.dirty = true;
    const r = saveSet('S', 1, true);

    ok('a blank engine is NOT written over the Set after a dropped restore',
        r.wrote === false, `wrote=${r.wrote}`);
    eq('and the Set on disk still holds its content',
        readBestState('S').payload, GOOD);
    uninstallMockEngine(); uninstallMockFs();
}

/* ── The gate must not become the loss it prevents ────────────────────────
 * Refusing to save is destructive too: the user's work stays in RAM and dies
 * with the session. So the closed gate has to be narrow, and has to REOPEN. */
{
    installMockFs({});
    const eng = installMockEngine();
    resetSetSave(); resetStoreRotation(); resetRestoreGate();

    /* 1. An ordinary restore saves normally. */
    pushState(GOOD);
    eng.stateBlob = 'movy1\nbpm 13000\n';
    seqState.dirty = true;
    eq('a landed restore saves as usual', saveSet('N', 0, true).wrote, true);

    /* 2. A failed restore closes the gate... */
    await withDroppedStateWrite(async () => { pushState(GOOD); });
    eng.stateBlob = BLANK_STATE;
    seqState.dirty = true;
    eq('a failed restore blocks the save', saveSet('N', 1, true).wrote, false);
    ok('and the save stays PENDING rather than being forgotten', saveNeeded(),
        'a dropped save that nothing retries is the loss by another route');

    /* 3. ...and reopens as soon as a restore lands, so the pending save runs. */
    pushState(GOOD);
    eng.stateBlob = 'movy1\nbpm 14000\n';
    eq('a later successful restore reopens the gate', saveSet('N', 1, true).wrote, true);
    eq('and what reaches disk is the engine content, not the blank',
        readBestState('N').payload, 'movy1\nbpm 14000\n');
    uninstallMockEngine(); uninstallMockFs();
}

/* ── The UI half is engine-sourced too ───────────────────────────────────
 * ui-state.json is not just keyboard settings: serializeUiState() calls
 * readChainDoc(), an engine GET, so the movy chains in it come from the same
 * engine the state does. A blank engine therefore costs the chains as well —
 * observed on device, ui-state.json collapsing from 5141 to 217 bytes. So the
 * gate has to cover this write too, not only the sequencer blob. */
{
    installMockFs({});
    const eng = installMockEngine();
    resetSetSave(); resetStoreRotation(); resetRestoreGate();

    const GOOD_UI = '{"root":60,"chains":[{"t":0,"comp":[{"c":"synth","m":"plaits"}]}]}';
    writeUiBlob('U', GOOD_UI);

    await withDroppedStateWrite(async () => { pushState(GOOD); });
    eng.stateBlob = BLANK_STATE;
    seqState.dirty = true;
    saveSet('U', 1, true);
    eq('a blocked save leaves the UI blob alone too', readUiBlob('U'), GOOD_UI);

    /* And it must not be forgotten: once the gate reopens the UI half is
     * written, or the settings are lost a slower way. */
    pushState(GOOD);
    eng.stateBlob = 'movy1\nbpm 16000\n';
    seqState.dirty = true;
    saveSet('U', 1, true);
    ok('and it IS written once the gate reopens', readUiBlob('U') !== GOOD_UI,
        'the blocked UI write must stay pending, not vanish');
    uninstallMockEngine(); uninstallMockFs();
}

/* A host with no blocking API cannot tell us either way. Assuming failure
 * there would block every save on that device — far worse than the hazard. */
{
    installMockFs({});
    const eng = installMockEngine();
    resetSetSave(); resetStoreRotation(); resetRestoreGate();
    const real = globalThis.host_module_set_param_blocking;
    delete globalThis.host_module_set_param_blocking;
    try {
        pushState(GOOD);
        eng.stateBlob = 'movy1\nbpm 15000\n';
        seqState.dirty = true;
        eq('an old host without the blocking API still saves', saveSet('O', 0, true).wrote, true);
    } finally { globalThis.host_module_set_param_blocking = real; }
    uninstallMockEngine(); uninstallMockFs();
}
}
