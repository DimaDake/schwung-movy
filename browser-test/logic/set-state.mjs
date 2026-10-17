/* browser-test/logic/set-state.mjs — per-set state: paths, the state envelope, the durable store, the chains mirror
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    uuidToStatePath, uuidToUiStatePath, BLANK_STATE, sessionTick, resetSetSession, wrapState,
    parseState, adler32, installMockFs, uninstallMockFs, safeWrite, readBestState,
    readUiBlob, shadowPath, keyboardState, installMockEngine,
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
    eq('BLANK_STATE is the format tag', BLANK_STATE, 'movy1\n');
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

_log('\nTest: reading the best copy of a Set\'s state');
{
    const fs = installMockFs();
    const canon = uuidToStatePath('S');

    /* The engine writes a shadow first and the canonical file last; the UI
     * only reads them, to tell an unreadable Set from a blank one. */
    fs.files[shadowPath('S', 1)] = wrapState('movy1\nbpm 12000\n', 1);
    fs.files[shadowPath('S', 2)] = wrapState('movy1\nbpm 14000\n', 2);
    fs.files[canon] = wrapState('movy1\nbpm 14000\n', 2);
    eq('best-of read picks the newest', readBestState('S').payload, 'movy1\nbpm 14000\n');

    // The crash case: the canonical file is torn. The set must come back from
    // a shadow instead of loading as a partial set or as blank.
    fs.files[canon] = fs.files[canon].slice(0, 12);
    eq('torn canonical falls back to a shadow', readBestState('S').payload, 'movy1\nbpm 14000\n');
    eq('fallback keeps the generation', readBestState('S').gen, 2);

    // Every copy torn → nothing loadable, and the caller must be told so it
    // can say so rather than silently start from a partial set.
    fs.files[shadowPath('S', 1)] = 'movy1\ngen 1\nbp';
    fs.files[shadowPath('S', 2)] = 'movy1\ngen 2\nbp';
    eq('all copies torn → null', readBestState('S'), null);

    /* Downgrade ordering: a build without the envelope never touches the
     * shadows, so a canonical file with no envelope AND real content was
     * necessarily written after them — the user rolled back, worked, rolled
     * forward. Generation order would restore the pre-downgrade set over it. */
    fs.files[shadowPath('D', 1)] = wrapState('movy1\nbpm 11000\n', 9);
    fs.files[uuidToStatePath('D')] = 'movy1\nbpm 12500\nswing 60\n';
    eq('legacy canonical outranks a higher-gen shadow',
        readBestState('D').payload, 'movy1\nbpm 12500\nswing 60\n');

    // …but a canonical torn down past its `gen` line also reads as legacy, and
    // that must fall through to the shadow rather than blank the set.
    fs.files[uuidToStatePath('D')] = 'movy1\n';
    eq('bare-tag canonical falls through to the shadow',
        readBestState('D').payload, 'movy1\nbpm 11000\n');

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

/* ── The chains mirror ────────────────────────────────────────────────────
 * ui-state.json carries a copy of chains.json, which a load falls back on when
 * chains.json is missing or unreadable (ui-state.ts `engineChains`). */
_log('\nTest: the chains mirror written from the engine\'s own file');
{
    const { saveSet } = await import('../../dist/esm/seq/set-save.js');
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

    const fs = installMockFs({ [uuidToChainsPath('M')]: doc });
    installMockEngine();

    saveSet('M', true);
    const ui = JSON.parse(readUiBlob('M'));
    eq('the mirror carries the module', ui.chains[0].comp[0].m, 'noisemaker');
    eq('and the preset blob, which no chain document carries',
       ui.chains[0].comp[0].s, 'blob-A');
    eq('and the second component', ui.chains[0].comp[1].m, 'mverb');
    eq('and the mixer triple', ui.chains[0].mix, '1.0000,0.0000,0');

    /* The send half of the same document. It lands in its own array, not as a
     * chain with `t: 17`: a reader that took `t` for a track index would address
     * a track that does not exist. Engine side is `GOLDEN` in chain_state.rs. */
    eq('a send record becomes a send, not a chain', ui.sends.length, 1);
    eq('addressed to its bus, not its document slot', ui.sends[0].b, 1);
    eq('with its module', ui.sends[0].m, 'delay');
    eq('and its preset blob', ui.sends[0].s, 'blob-C');

    /* An unreadable chains.json must NEVER write []: that is §3 in a new file.
     * It is not the authority, so keeping a stale mirror costs nothing, while
     * blanking it throws away the one fallback a load has. */
    fs.files[uuidToChainsPath('M')] = 'not-a-document';
    saveSet('M', true);
    const after = JSON.parse(readUiBlob('M'));
    /* Counted before it is indexed: the failure mode this guards against is an
     * EMPTY mirror, and indexing [0] of that throws instead of reporting. */
    eq('an unreadable chains.json leaves the previous mirror alone',
       after.chains.length, 1);
    eq('with its module', after.chains[0]?.comp[0]?.m, 'noisemaker');
    eq('and its blob', after.chains[0]?.comp[0]?.s, 'blob-A');

    uninstallMockEngine(); uninstallMockFs();
}
}
