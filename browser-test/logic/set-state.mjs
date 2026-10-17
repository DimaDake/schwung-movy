/* browser-test/logic/set-state.mjs — per-set state: paths, the state envelope, the durable store, the chains mirror
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    uuidToStatePath, uuidToUiStatePath, sessionTick, resetSetSession, wrapState,
    parseState, adler32, installMockFs, uninstallMockFs, safeWrite,
    readUiBlob, keyboardState, installMockEngine,
    uninstallMockEngine, seqEngineTick, resetSeqEngine, ok, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── Per-set state ───────────────────────────────────────────────────────── */

_log('\nTest: set-context paths');
{
    eq('state path keyed by uuid, in the library', uuidToStatePath('abc-123'),
        '/data/UserData/UserLibrary/Movy/Sets/abc-123/seq-state.json');
    eq('ui path keyed by uuid', uuidToUiStatePath('abc-123'),
        '/data/UserData/UserLibrary/Movy/Sets/abc-123/ui-state.json');
}

_log('\nTest: state envelope (truncation is detectable)');
{
    const payload = 'movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n';
    const wrapped = wrapState(payload, 7);

    eq('envelope keeps the movy1 tag first', wrapped.split('\n')[0], 'movy1');
    eq('generation marker is line 2', wrapped.split('\n')[1], 'gen 7');
    eq('round-trips the payload', parseState(wrapped).payload, payload);
    eq('round-trips the generation', parseState(wrapped).gen, 7);

    // A blank set is the smallest possible payload and must survive too.
    eq('blank payload round-trips', parseState(wrapState('movy1\n', 3)).payload, 'movy1\n');

    // Backward compat: a file written by any shipped build has no envelope.
    const legacy = 'movy1\nbpm 12000\n';
    eq('legacy blob still loads', parseState(legacy).payload, legacy);
    eq('legacy blob is generation 0', parseState(legacy).gen, 0);

    // The whole point: a torn write must be REJECTED, not loaded as a
    // partial set. `gen` survives at the top; the trailer does not.
    eq('torn envelope rejected', parseState(wrapped.slice(0, 30)), null);
    eq('missing trailer rejected', parseState('movy1\ngen 7\nbpm 12000\n'), null);
    eq('bad checksum rejected',
        parseState(wrapped.replace(/end (\d+) (\d+) \d+/, 'end $1 $2 12345678')), null);
    eq('bad length rejected',
        parseState(wrapped.replace(/end (\d+) \d+ /, 'end $1 999999 ')), null);

    eq('not a movy blob → null', parseState('garbage\n'), null);
    eq('null in → null out', parseState(null), null);

    eq('adler32 is stable', adler32('movy1\n'), adler32('movy1\n'));
    eq('adler32 discriminates', adler32('movy1\n') !== adler32('movy2\n'), true);
}

_log('\nTest: verified writes');
{
    const fs = installMockFs();
    const canon = uuidToUiStatePath('S');
    eq('safeWrite verifies content', safeWrite(canon, 'hello'), true);
    fs.failWrites = true;
    eq('safeWrite reports host failure', safeWrite(canon, 'nope'), false);
    fs.failWrites = null;
    // A write that lies — reports success but stores a short file — is caught
    // by reading it back. This is the failure class fsync would cover and we
    // cannot: at least we refuse to call it saved.
    fs.truncate = { path: 'ui-state', at: 8 };
    eq('short write caught by read-back', safeWrite(uuidToUiStatePath('S'), '{"root":60}'), false);
    fs.truncate = null;

    uninstallMockFs();
}

/* ── chains.json, as the UI reads it ────────────────────────────────────── */
_log('\nTest: chains.json, read from the engine\'s own file');
{
    const { saveSet } = await import('../../dist/esm/seq/set-save.js');
    const { parseChainsFile } = await import('../../dist/esm/track/chains-file.js');
    const { uuidToChainsPath } = await import('../../dist/esm/seq/set-context.js');
    const { encodeBulk } = await import('../../dist/esm/track/bulk.js');

    /* Six fields per record, matching FIELDS in chain_state.rs. The last record
     * is a SEND BUS: its slot is written from the exported arithmetic rather
     * than typed, because the number is the contract `busOfDocSlot` inverts —
     * typed here, a moved slot would break the engine and a stale literal
     * would keep agreeing with it. */
    const { sendDocSlot } = await import('../../dist/esm/track/send-persist.js');
    const doc = encodeBulk([
        '0', 'synth', 'noisemaker', 'blob-A', '1.0000,0.0000,0', '',
        '0', 'fx1', 'mverb', 'blob-B', '', '',
        String(sendDocSlot(1)), 'fx1', 'delay', 'blob-C', '', '',
    ]);
    const got = parseChainsFile(doc);
    eq('the module', got.chains[0].comp[0].m, 'noisemaker');
    eq('and the preset blob, which no chain document carries', got.chains[0].comp[0].s, 'blob-A');
    eq('and the second component', got.chains[0].comp[1].m, 'mverb');
    eq('and the mixer triple', got.chains[0].mix, '1.0000,0.0000,0');

    /* The send half of the same document. It lands in its own array, not as a
     * chain with `t: 17`: a reader that took `t` for a track index would address
     * a track that does not exist. Engine side is `GOLDEN` in chain_state.rs. */
    eq('a send record becomes a send, not a chain', got.sends.length, 1);
    eq('addressed to its bus, not its document slot', got.sends[0].b, 1);
    eq('with its module', got.sends[0].m, 'delay');
    eq('and its preset blob', got.sends[0].s, 'blob-C');

    /* Unreadable is null, never an empty set: the caller has to be able to tell
     * a broken file from a Set with no chains. */
    eq('an unreadable file is null', parseChainsFile('not-a-document'), null);
    eq('and so is a missing one', parseChainsFile(null), null);

    /* One record of the chains: ui-state.json carries none. */
    installMockFs({ [uuidToChainsPath('M')]: doc });
    installMockEngine();
    saveSet('M', true);
    const ui = JSON.parse(readUiBlob('M'));
    eq('ui-state.json holds no chains', ui.chains, undefined);
    eq('nor sends', ui.sends, undefined);
    uninstallMockEngine(); uninstallMockFs();
}
}
