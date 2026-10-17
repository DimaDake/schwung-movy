/* browser-test/logic/set-restore-loss.mjs — what a lost message or a bad
 * engine answer can do to a saved Set.
 *
 * Run by browser-test/logic.mjs.
 *
 * The engine owns the Set files and the wire carries only commands. These pin
 * the safety argument for that design: a lost command costs nothing, a bad
 * engine answer costs no chains, and the UI never writes the state itself.
 */
import {
    installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine,
    seedStateFile, readBestState, ok, eq, _log,
} from './harness.mjs';

/* A Set with real content: an automation lane and a clip. */
const GOOD = 'movy1\nbpm 12000\nau 0 0 50 synth:octave_transpose\ncl 0 0 16 0 0:24:60:100\n';

export async function run() {
_log('\nTest: a lost command or a bad answer must not cost the Set');

const { saveSet } = await import('../../dist/esm/seq/set-save.js');
const { openSet, setStatusUuid } = await import('../../dist/esm/seq/set-load.js');
const { seqState } = await import('../../dist/esm/seq/state.js');
const { readUiBlob } = await import('../../dist/esm/seq/persist-store.js');
const { uuidToChainsPath, uuidToStatePath } = await import('../../dist/esm/seq/set-context.js');
const { encodeBulk } = await import('../../dist/esm/track/bulk.js');

/* ── §3 CLOSED ────────────────────────────────────────────────────────────
 * docs/persistence-hazards.md §3: when the UI read the chains out of the
 * engine, a malformed answer was read as an empty set and the autosave wrote
 * "chains":[] over real chains (observed on device: ui-state.json at 5141
 * bytes became 217).
 *
 * The chains survive now, and not because a guard caught the malformed answer
 * — because there is no answer to catch. serializeUiState makes no engine call
 * at all; it copies chains.json, which the engine wrote from what it holds.
 *
 * The teeth are the engine GET being made to fail: if this ever passes because
 * the UI silently went back to reading the engine, the mirror is not doing its
 * job. */
{
    const doc = encodeBulk(['0', 'synth', 'noisemaker', 'blob-A', '', '']);
    installMockFs({ [uuidToChainsPath('C2')]: doc });
    installMockEngine();

    const realGet = globalThis.host_module_get_param;
    globalThis.host_module_get_param = (k) => (k === 'chains' ? null : realGet(k));
    try {
        saveSet('C2', true);
        const ui = JSON.parse(readUiBlob('C2'));
        eq('§3 closed: an unreadable engine answer costs no chains', ui.chains.length, 1);
        eq('and the chain is the real one', ui.chains[0].comp[0].m, 'noisemaker');
    } finally { globalThis.host_module_get_param = realGet; }

    uninstallMockEngine(); uninstallMockFs();
}

/* ── A lost COMMAND cannot cost the Set ───────────────────────────────────
 * The safety argument for commands-instead-of-payloads, stated exactly.
 *
 * It is NOT that the command is more reliable. It is that losing one is
 * harmless: the engine has not opened the Set, so it holds nothing to write
 * over it, and the UI sees the mismatch in the status and re-sends. Losing a
 * PAYLOAD destroyed data, because the next autosave read the engine's
 * blank-but-valid state and wrote that instead. */
{
    installMockFs({});
    installMockEngine();
    seedStateFile('E', GOOD, 1);

    const real = globalThis.host_module_set_param;
    globalThis.host_module_set_param = (k, v, t) =>
        (k === 'set' ? false : real(k, v, t));
    try {
        openSet('E', null);
        seqState.dirty = true;
        saveSet('E', true);
    } finally { globalThis.host_module_set_param = real; }

    eq('a dropped open leaves the Set on disk untouched', readBestState('E').payload, GOOD);
    ok('and the UI can see the engine does not hold it', setStatusUuid() !== 'E');

    /* Re-sending is the whole recovery, and it is free: the command is
     * idempotent, so a retry after a lost one is indistinguishable from the
     * first attempt having landed. */
    openSet('E', null);
    eq('a re-sent open lands', setStatusUuid(), 'E');

    uninstallMockEngine(); uninstallMockFs();
}

/* One writer: a UI save must not touch seq-state.json even when everything
 * looks dirty and forced — the engine's file would race it. */
{
    installMockFs({});
    const eng = installMockEngine();
    seedStateFile('G', GOOD, 1);
    const before = globalThis.host_read_file(uuidToStatePath('G'));

    openSet('G', null);
    eng.stateBlob = 'movy1\n';          // the blank a fresh engine holds
    seqState.dirty = true;
    saveSet('G', true);

    eq('the UI writes no state', globalThis.host_read_file(uuidToStatePath('G')), before);
    eq('and the Set on disk still holds the real payload', readBestState('G').payload, GOOD);

    uninstallMockEngine(); uninstallMockFs();
}
}
