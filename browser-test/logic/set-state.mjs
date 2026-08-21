/* browser-test/logic/set-state.mjs — per-set state: paths, the state envelope, the durable store, inherit-on-copy
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    readActiveSet, uuidToStatePath, uuidToUiStatePath, loadNameIndex, rememberSet, BLANK_STATE,
    stripCopySuffix, findInheritCandidates, resolveState, sessionTick, resetSetSession, wrapState,
    parseState, adler32, installMockFs, uninstallMockFs, safeWrite, readBestState,
    readUiBlob, writeStateBlob, resetStoreRotation, shadowPath, keyboardState, installMockEngine,
    uninstallMockEngine, seqEngineTick, resetSeqEngine, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── Per-set state ───────────────────────────────────────────────────────── */

_log('\nTest: set-context paths + active-set reader + name index');
{
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;

    fs['/data/UserData/schwung/active_set.txt'] = 'abc-123\nMy Song\n';
    const as = readActiveSet();
    eq('readActiveSet uuid', as.uuid, 'abc-123');
    eq('readActiveSet name', as.name, 'My Song');

    eq('state path keyed by uuid', uuidToStatePath('abc-123'),
        '/data/UserData/schwung/modules/tools/movy/sets/abc-123/seq-state.json');
    eq('ui path keyed by uuid', uuidToUiStatePath('abc-123'),
        '/data/UserData/schwung/modules/tools/movy/sets/abc-123/ui-state.json');
    eq('empty uuid → _default state path', uuidToStatePath(''),
        '/data/UserData/schwung/modules/tools/movy/sets/_default/seq-state.json');

    eq('BLANK_STATE is the format tag', BLANK_STATE, 'movy1\n');

    rememberSet('My Song', 'abc-123');
    eq('name index round-trips', loadNameIndex()['My Song'], 'abc-123');

    // "Unknown" must be distinguishable from "a set called ''". Movy follows
    // active_set.txt; a transient unreadable file used to resolve to the
    // `_default` set and quietly redirect every autosave there.
    delete fs['/data/UserData/schwung/active_set.txt'];
    eq('missing active_set → null', readActiveSet(), null);

    fs['/data/UserData/schwung/active_set.txt'] = '\n\n';
    eq('empty active_set → null', readActiveSet(), null);

    // Move reports a placeholder id while a set is being created. A device in
    // the wild ended up with a whole sets/__pending-0-1/ directory this way.
    fs['/data/UserData/schwung/active_set.txt'] = '__pending-0-1\nNew Set\n';
    eq('placeholder set id → null', readActiveSet(), null);

    fs['/data/UserData/schwung/active_set.txt'] = 'abc-123\nMy Song\n';
    eq('real uuid still resolves', readActiveSet().uuid, 'abc-123');
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

_log('\nTest: durable store (rotation + verified writes)');
{
    const fs = installMockFs();
    resetStoreRotation();
    const canon = uuidToStatePath('S');

    // A save lands in both a shadow slot and the canonical path, newest first
    // in the shadow so the canonical still holds the previous generation until
    // the shadow has verified.
    eq('gen 1 write reported durable', writeStateBlob('S', 'movy1\nbpm 12000\n', 1), true);
    eq('canonical holds gen 1', readBestState('S').gen, 1);
    eq('shadow 1 holds gen 1', parseState(fs.files[shadowPath('S', 1)]).gen, 1);

    // The next save rotates to the other slot, so slot 1 keeps generation 1.
    eq('gen 2 write reported durable', writeStateBlob('S', 'movy1\nbpm 14000\n', 2), true);
    eq('shadow 1 still holds gen 1', parseState(fs.files[shadowPath('S', 1)]).gen, 1);
    eq('shadow 2 holds gen 2', parseState(fs.files[shadowPath('S', 2)]).gen, 2);
    eq('best-of read picks the newest', readBestState('S').payload, 'movy1\nbpm 14000\n');

    // The crash case: the canonical file is torn. The set must come back from
    // a shadow instead of loading as a partial set or as blank.
    fs.files[canon] = fs.files[canon].slice(0, 12);
    eq('torn canonical falls back to a shadow', readBestState('S').payload, 'movy1\nbpm 14000\n');
    eq('fallback keeps the generation', readBestState('S').gen, 2);

    // Every copy torn → nothing loadable, and the caller must be told so it
    // can fall back rather than silently start from a partial set.
    fs.files[shadowPath('S', 1)] = 'movy1\ngen 1\nbp';
    fs.files[shadowPath('S', 2)] = 'movy1\ngen 2\nbp';
    eq('all copies torn → null', readBestState('S'), null);

    // A write the host rejects must be reported, not swallowed.
    fs.failWrites = true;
    eq('failed write reported', writeStateBlob('S', 'movy1\nbpm 9000\n', 3), false);
    fs.failWrites = null;

    // A write that lies — reports success but stores a short file — is caught
    // by reading it back. This is the failure class fsync would cover and we
    // cannot: at least we refuse to call it saved.
    fs.truncate = { path: 'seq-state', at: 8 };
    eq('short write caught by read-back', writeStateBlob('S', 'movy1\nbpm 9000\n', 4), false);
    fs.truncate = null;

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

    uninstallMockFs();
}

_log('\nTest: inherit-on-copy resolution');
{
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';
    const uiPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/ui-state.json';
    const setDir = (u) => '/data/UserData/UserLibrary/Sets/' + u;

    eq('strip " Copy"',   stripCopySuffix('My Song Copy'),   'My Song');
    eq('strip " Copy 2"', stripCopySuffix('My Song Copy 2'), 'My Song');
    eq('no suffix → null', stripCopySuffix('My Song'),        null);

    // Parent "p-uuid" (name "My Song") has state + a live Move set.
    fs[stPath('p-uuid')] = 'movy1\nbpm 12000\n';
    fs[uiPath('p-uuid')] = '{"root":50,"scale":1}';
    fs[setDir('p-uuid')] = '';            // dir marker
    fs[setDir('c-uuid')] = '';            // the copy's Move set exists too
    const idx = { 'My Song': 'p-uuid' };

    const cands = findInheritCandidates('My Song Copy', idx);
    eq('one inherit candidate found', cands.length, 1);
    eq('candidate is the parent', cands[0].uuid, 'p-uuid');

    // Resolving a copy with no own state seeds + returns the parent's blob.
    fs['/data/UserData/schwung/modules/tools/movy/sets/name-index.json'] = JSON.stringify(idx);
    const st = resolveState('c-uuid', 'My Song Copy');
    eq('inherited state payload', st.payload, 'movy1\nbpm 12000\n');
    eq('seeded copy starts at generation 1', st.gen, 1);
    eq('copy seeded into dst state file', readBestState('c-uuid').payload, 'movy1\nbpm 12000\n');
    eq('copy seeded dst ui file', readUiBlob('c-uuid'), '{"root":50,"scale":1}');

    // Unknown brand-new set with no family → blank.
    eq('unknown set → blank', resolveState('z-uuid', 'Fresh').payload, 'movy1\n');

    // A set that already has its own state returns it (no inherit).
    fs[stPath('own')] = 'movy1\nswing 60\n';
    eq('own state wins', resolveState('own', 'Whatever').payload, 'movy1\nswing 60\n');
}

_log('\nTest: a set switch saves the outgoing set before loading the incoming one');
{
    const eng = installMockEngine();         // installs host_module_* on globalThis
    const { seqState: seqStateForSwitch } = await import('../../dist/esm/seq/state.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { sessionTick, resetSetSession, currentSetUuid: curSet } =
        await import('../../dist/esm/seq/set-session.js');
    const { resetSetSave } = await import('../../dist/esm/seq/set-save.js');
    const mock = installMockFs();
    const fs = mock.files;
    const ACTIVE_SW = '/data/UserData/schwung/active_set.txt';
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';
    const uiPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/ui-state.json';
    const spin = (n = 200) => { for (let i = 0; i < n; i++) { seqEngineTick(); sessionTick(); } };

    resetSetSession(); resetSetSession(); resetSetSave(); resetStoreRotation(); resetSeqEngine();
    eng.reset();

    // Set A has saved state + ui; opening on it loads both.
    fs[ACTIVE_SW] = 'A\nSong A\n';
    fs[stPath('A')] = 'movy1\nbpm 13000\n';
    fs[uiPath('A')] = '{"root":55,"scale":2}';
    spin();
    eq('loaded A blob into engine', eng.stateLoads[eng.stateLoads.length - 1], 'movy1\nbpm 13000\n');
    eq('applied A ui root', keyboardState.rootPc, 7);   // 55 % 12
    eq('applied A ui scale', keyboardState.scale, 2);
    eq('current uuid is A', curSet(), 'A');

    /* Switching to a set that ALREADY has state must save A first and then load
     * B — the rename rule only applies to a set with nothing of its own. */
    fs[stPath('B')] = 'movy1\nbpm 9000\n';
    eng.stateBlob = 'movy1\nbpm 13000\nEDITED\n';
    seqStateForSwitch.dirty = true;
    fs[ACTIVE_SW] = 'B\nSong B\n';
    spin();
    eq('A saved before B load', readBestState('A').payload, 'movy1\nbpm 13000\nEDITED\n');
    eq('B loaded from its own file', eng.stateLoads[eng.stateLoads.length - 1], 'movy1\nbpm 9000\n');
    eq('B ui reset to defaults (root C)', keyboardState.rootPc, 0);
    eq('B ui reset to defaults (scale 0)', keyboardState.scale, 0);
    eq('current uuid is B', curSet(), 'B');
    uninstallMockEngine(); uninstallMockFs(); resetSetSession(); resetSeqEngine();
}

}
