/* browser-test/logic/set-session.mjs — set sessions: engine generation, set switching, set-load, the active-note mirror
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    uuidToStatePath, sessionTick, resetSetSession, installMockFs, uninstallMockFs, readBestState,
    resetStoreRotation, keyboardState, installMockEngine, uninstallMockEngine, takeLabelSync, seqEngineTick,
    resetSeqEngine, ok, fail, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── engine generation ───────────────────────────────────────────────────── */
{
    _log('\nengine generation tracks reloads:');
    const { resetSeqEngine, seqEngineTick, engineReady, engineGeneration } =
        await import('../../dist/esm/seq/engine.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');

    const eng = installMockEngine();
    resetSeqEngine(); resetSeqState();
    eq('generation starts at 0', engineGeneration(), 0);

    seqEngineTick();                       // probe → ping ok
    eq('engine ready', engineReady(), true);
    eq('first boot is generation 1', engineGeneration(), 1);

    // The engine wedges: 16 lost status polls send engine.ts back to probing,
    // and the probe re-dlopens dsp.so. Whatever comes back is a NEW engine.
    eng.statusUnavailable = true;
    for (let i = 0; i < 8 * 20; i++) seqEngineTick();
    eng.statusUnavailable = false;
    for (let i = 0; i < 8; i++) seqEngineTick();
    eq('engine ready again', engineReady(), true);
    eq('reload is a new generation', engineGeneration(), 2);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}

/* ── set session ─────────────────────────────────────────────────────────── */
{
    _log('\nset session:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { DIR } = await import('../mock-fs.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { sessionTick, sessionFlush, sessionPhase, sessionReady, currentSetUuid,
            resetSetSession } = await import('../../dist/esm/seq/set-session.js');
    const { resetSetSave } = await import('../../dist/esm/seq/set-save.js');
    const { readBestState } = await import('../../dist/esm/seq/persist-store.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');

    const ACTIVE = '/data/UserData/schwung/active_set.txt';
    const SAVED  = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';
    const EDITED = 'movy1\nbpm 14000\ncl 0 0 32 0 0:24:62:110\n';
    const BLANK  = 'movy1\n';

    const boot = (files, opts = {}) => {
        const fs = installMockFs(files);
        const eng = installMockEngine();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
        if (!opts.skipBoot) for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        return { fs, eng };
    };
    const teardown = () => {
        uninstallMockEngine(); uninstallMockFs();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
    };
    const run = (n = 200) => { for (let i = 0; i < n; i++) { seqEngineTick(); sessionTick(); } };

    /* R1 — a Set that names itself late must not load over work in hand. This
     * is #4/#5/#6: schwung works under a synthetic `__pending-*` id for 12-60 s
     * while Move materialises the real Set, and the pads, steps and transport
     * all work throughout. */
    {
        const { fs, eng } = boot({ [ACTIVE]: '__pending-13-3\nNew Set\n' });
        eq('R1 adopted the provisional id, keyed by pad', currentSetUuid(), '__pending-13');
        eng.stateBlob = EDITED;                       // the user enters a pattern
        seqState.dirty = true;

        fs.files[ACTIVE] = 'NEW1\nSet 26\n';          // Move materialises it
        run();

        eq('R1 renamed to the real id', currentSetUuid(), 'NEW1');
        eq('R1 the pattern survived', eng.stateBlob, EDITED);
        eq('R1 and reached disk under it', readBestState('NEW1').payload, EDITED);
        eq('R1 the pad directory did not survive it', readBestState('__pending-13'), null);
        teardown();
    }

    /* R2 — the counterpart: an incoming Set that HAS state is a real switch. */
    {
        const { fs, eng } = boot({ [ACTIVE]: '__pending-13-3\nNew Set\n' });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        fs.files[uuidToStatePath('S1')] = SAVED;
        fs.files[ACTIVE] = 'S1\nSong One\n';
        run();
        eq('R2 the saved set was restored', eng.stateBlob, SAVED);
        eq('R2 and we are on it', currentSetUuid(), 'S1');
        teardown();
    }

    /* R3 — a provisional id whose seq changes but whose PAD does not. schwung
     * mints a fresh seq freely; the pad is the set. (Its old form asserted that
     * a different pad was a rename too — see R10 for why that was the bug.) */
    {
        const { fs, eng } = boot({ [ACTIVE]: '__pending-11-3\nNew Set\n' });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        fs.files[ACTIVE] = '__pending-11-9\nNew Set\n';
        run();
        eq('R3 still the same pad', currentSetUuid(), '__pending-11');
        eq('R3 the work stayed put', eng.stateBlob, EDITED);
        teardown();
    }

    /* R4 — the keyboard follows the same rule, and needs no notes to do it. */
    {
        const { fs } = boot({ [ACTIVE]: '__pending-13-3\nNew Set\n' });
        keyboardState.mode = 1; keyboardState.layout = 1; keyboardState.scale = 3;
        fs.files[ACTIVE] = 'NEW2\nSet 27\n';
        run();
        eq('R4 still In Key', keyboardState.mode, 1);
        eq('R4 still Inline', keyboardState.layout, 1);
        eq('R4 still the chosen scale', keyboardState.scale, 3);
        keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
        teardown();
    }

    /* R5 — the phase gate. Nothing is live until the engine holds the Set. */
    {
        boot({ [ACTIVE]: 'S1\nSong One\n' }, { skipBoot: true });
        eq('R5 booting before the engine answers', sessionPhase(), 'booting');
        eq('R5 and not ready', sessionReady(), false);
        run();
        eq('R5 ready once loaded', sessionPhase(), 'ready');
        eq('R5 and live', sessionReady(), true);
        teardown();
    }

    /* R6 — the destructive one. engine.ts re-dlopens dsp.so after a wedge and
     * the new engine has NO clips. The session must restore into it and must
     * never write that blank engine over the Set. */
    {
        const { eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eq('R6 loaded', eng.stateBlob, SAVED);

        /* The engine stops answering and its RAM goes with it, so from here the
         * state it would serialize is empty — that is what the re-dlopen brings
         * back, and what a careless save would persist. */
        eng.statusUnavailable = true;
        eng.stateBlob = 'movy1\n';
        run(160);
        eng.statusUnavailable = false;
        run(80);

        seqState.dirty = true;       // an edit lands on the new engine
        run(700);

        eq('R6 the set was pushed back', eng.stateBlob, SAVED);
        eq('R6 the blank engine never overwrote it', readBestState('S1').payload, SAVED);
        teardown();
    }

    /* R9 — a Set whose state file will not parse is NAMED, not silently blanked.
     * The loader falls back to blank on unreadable state, and a silent blank is
     * exactly how a set "disappears" from the user's point of view. Recovery is
     * offered rather than taken: the file may still be salvageable off-device,
     * and movy overwriting it destroys the only copy. */
    {
        const { sessionError } = await import('../../dist/esm/seq/set-session.js');
        const { sessionStartFromScratch } = await import('../../dist/esm/seq/set-fail.js');
        const fs = installMockFs({ [ACTIVE]: 'BAD\nBroken Set\n' });
        const eng = installMockEngine();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
        fs.files[uuidToStatePath('BAD')] = 'not a movy blob at all';
        run();

        eq('R9 the failure is reported', sessionPhase(), 'failed');
        eq('R9 and named', sessionError(), 'SET FILE UNREADABLE');
        eq('R9 movy is not live', sessionReady(), false);
        eq('R9 the bad file was not overwritten',
            fs.files[uuidToStatePath('BAD')], 'not a movy blob at all');

        sessionStartFromScratch();      // the user takes the offer
        run();
        eq('R9 starting from scratch recovers', sessionPhase(), 'ready');
        eq('R9 on the same set', currentSetUuid(), 'BAD');
        eq('R9 with a readable file now', readBestState('BAD') !== null, true);
        teardown();
    }

    /* R10 — an engine that never answers is a failure, not an endless spinner. */
    {
        const { sessionError } = await import('../../dist/esm/seq/set-session.js');
        const eng = installMockEngine();
        installMockFs({ [ACTIVE]: 'S1\nSong One\n' });
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
        eng.statusUnavailable = true;
        eng.pingUnavailable = true;
        run(4000);                      // past every probe and load retry
        eq('R10 gave up visibly', sessionPhase(), 'failed');
        eq('R10 and said why', sessionError(), 'ENGINE DID NOT START');
        teardown();
    }

    /* R7 — teardown flushes rather than dropping the last edits. */
    {
        const { eng } = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        eng.stateBlob = EDITED;
        seqState.dirty = true;
        sessionFlush(true);          // what onUnload calls
        eq('R7 flush persisted immediately', readBestState('S1').payload, EDITED);
        teardown();
    }

    /* R8 — generations continue across sessions, so a save never loses to a
     * stale higher-numbered copy left by an earlier run. */
    {
        const first = boot({ [ACTIVE]: 'S1\nSong One\n', [uuidToStatePath('S1')]: SAVED });
        first.eng.stateBlob = EDITED;
        seqState.dirty = true;
        run(700);
        const genAfterFirstRun = readBestState('S1').gen;
        const carried = { ...first.fs.files };
        teardown();

        const second = boot(carried);
        second.eng.stateBlob = 'movy1\nbpm 15000\n';
        seqState.dirty = true;
        run(700);
        eq('R8 generation kept climbing', readBestState('S1').gen > genAfterFirstRun, true);
        eq('R8 newest wins', readBestState('S1').payload, 'movy1\nbpm 15000\n');
        teardown();
    }

    /* ── switch vs rename ────────────────────────────────────────────────
     *
     * The rename exists for ONE transition: schwung's provisional id being
     * replaced by the real one Move finally materialised. Every other identity
     * change is a switch, and a switch into a Set with no state of its own
     * starts blank — the same thing schwung does when it seeds an unseen set
     * with empty slots. Deleting a Set in Move produces exactly that shape, and
     * carrying the old work into it is what made a deleted Set come back. */

    /* R11 — real to real, incoming has no state: a switch, not a rename. */
    {
        const { fs, eng } = boot({ [ACTIVE]: 'SETA\nSong A\n', [uuidToStatePath('SETA')]: SAVED });
        eng.stateBlob = EDITED; seqState.dirty = true;   // work in hand
        run(40);
        fs.files[ACTIVE] = 'SETB\nSong B\n';           // the Set Move made after a delete
        run();
        eq('R11 we are on the new set', currentSetUuid(), 'SETB');
        eq('R11 the engine was cleared', eng.stateBlob, BLANK);
        eq('R11 nothing was carried onto disk', readBestState('SETB'), null);
        eq('R11 and the old set kept its work', readBestState('SETA').payload, EDITED);
        teardown();
    }

    /* R12 — the flipped R3. With provisional ids keyed by pad, a DIFFERENT
     * provisional id is a different pad, so it gets its own blank slate. */
    {
        const { fs, eng } = boot({ [ACTIVE]: '__pending-11-3\nNew Set\n' });
        eng.stateBlob = EDITED; seqState.dirty = true;
        run(40);
        fs.files[ACTIVE] = '__pending-10-2\nNew Set\n';
        run();
        eq('R12 followed the browse', currentSetUuid(), '__pending-10');
        eq('R12 the new pad is blank', eng.stateBlob, BLANK);
        eq('R12 pad 12 kept its work', readBestState('__pending-11').payload, EDITED);
        teardown();
    }

    /* R13 — the same pad revisited. schwung mints a fresh `-<seq>` on every
     * visit to a Set Move never materialised (a user who plays only through
     * movy never gives Move anything to save), so the seq is noise: the pad
     * index is the identity. Without this, every visit was a brand-new Set and
     * the pad recorded nothing that survived leaving it. */
    {
        const { fs, eng } = boot({ [ACTIVE]: '__pending-17-1\nNew Set 18\n' });
        eq('R13 keyed by pad, not by visit', currentSetUuid(), '__pending-17');
        eng.stateBlob = EDITED; seqState.dirty = true;
        run(700);                                        // autosave lands
        fs.files[ACTIVE] = 'SETA\nSong A\n';            // away to another set
        fs.files[uuidToStatePath('SETA')] = SAVED;
        run();
        fs.files[ACTIVE] = '__pending-17-6\nNew Set 18\n';   // back to the same pad
        run();
        eq('R13 back on the same pad', currentSetUuid(), '__pending-17');
        eq('R13 and its work came back', eng.stateBlob, EDITED);
        teardown();
    }

    /* R14 — the work already stranded on devices in the field: one directory
     * per visit, none of them ever read again. The highest intact one wins. */
    {
        const { eng } = boot({
            [ACTIVE]: '__pending-9-7\nNew Set 10\n',
            [uuidToStatePath('__pending-9-2')]: 'movy1\nbpm 11000\n',
            [uuidToStatePath('__pending-9-5')]: EDITED,
        });
        eq('R14 adopted the pad', currentSetUuid(), '__pending-9');
        eq('R14 the newest orphan was recovered', eng.stateBlob, EDITED);
        eq('R14 and now belongs to the pad', readBestState('__pending-9').payload, EDITED);
        teardown();
    }

    /* R15 — a Set deleted in Move leaves state behind that nothing can reach.
     * host_remove_dir is allowed anywhere under modules/, which is where this
     * lives, so it can actually be collected. */
    {
        const SETS = '/data/UserData/UserLibrary/Sets';
        const IDX  = '/data/UserData/schwung/modules/tools/movy/sets/name-index.json';
        const { fs } = boot({
            [ACTIVE]: 'LIVE\nStill Here\n',
            [SETS]: DIR,
            [SETS + '/LIVE']: DIR,
            [IDX]: JSON.stringify({ 'Still Here': 'LIVE', 'Deleted': 'DEAD' }),
            [uuidToStatePath('LIVE')]: SAVED,
            [uuidToStatePath('DEAD')]: EDITED,
        });
        eq('R15 the dead set was collected', readBestState('DEAD'), null);
        eq('R15 the live set was not', readBestState('LIVE').payload, SAVED);
        eq('R15 and it left the name index',
           JSON.parse(fs.files[IDX])['Deleted'] === undefined, true);
        teardown();
    }

    /* R16 — the guard on R13. An unreadable Sets/ directory says nothing about
     * which sets exist, and collecting on that answer would delete all of them. */
    {
        const IDX = '/data/UserData/schwung/modules/tools/movy/sets/name-index.json';
        boot({
            [ACTIVE]: 'LIVE\nStill Here\n',
            [IDX]: JSON.stringify({ 'Deleted': 'DEAD' }),
            [uuidToStatePath('DEAD')]: EDITED,
        });
        eq('R16 nothing collected without a Sets dir', readBestState('DEAD').payload, EDITED);
        teardown();
    }
}

/* ── set-load ────────────────────────────────────────────────────────────── */
{
    _log('\nset-load:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { setHasState, loadSet, pushState } = await import('../../dist/esm/seq/set-load.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');
    const { readBestState } = await import('../../dist/esm/seq/persist-store.js');

    const SAVED = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';

    /* "Does this Set already have state?" is the question the whole
     * rename-vs-switch rule turns on, so it gets its own assertion. */
    {
        installMockFs({});
        installMockEngine();
        eq('an unknown set has no state', setHasState('NEW'), false);
        uninstallMockEngine(); uninstallMockFs();
    }
    {
        installMockFs({ [uuidToStatePath('S1')]: SAVED });
        const eng = installMockEngine();
        eq('a saved set has state', setHasState('S1'), true);
        const got = loadSet('S1', 'Song One');
        eq('loadSet returns the payload', got.payload, SAVED);
        eq('loadSet pushed it into the engine', eng.stateBlob, SAVED);
        uninstallMockEngine(); uninstallMockFs();
    }
    {
        installMockFs({});
        const eng = installMockEngine();
        pushState('movy1\nbpm 12000\n');
        eq('pushState reaches the engine', eng.stateBlob, 'movy1\nbpm 12000\n');
        uninstallMockEngine(); uninstallMockFs();
    }

    /* set-save: the engine's payload reaches disk, and an unchanged payload is
     * not rewritten — flash on this device is not free. */
    {
        installMockFs({});
        const eng = installMockEngine();
        const { saveSet, resetSetSave } = await import('../../dist/esm/seq/set-save.js');
        resetSetSave();

        eng.stateBlob = 'movy1\nbpm 13000\n';
        seqState.dirty = true;
        const first = saveSet('S9', 0, true);
        eq('saveSet wrote', first.wrote, true);
        eq('and it is readable back', readBestState('S9').payload, 'movy1\nbpm 13000\n');

        const second = saveSet('S9', first.gen, true);
        eq('an unchanged payload is not rewritten', second.wrote, false);
        uninstallMockEngine(); uninstallMockFs();
    }

    /* A failed write must stay pending: reading `state` clears the engine's own
     * dirty flag, so a write we drop is one nothing will ask us for again. */
    {
        const fs = installMockFs({});
        const eng = installMockEngine();
        const { saveSet, saveNeeded, resetSetSave } = await import('../../dist/esm/seq/set-save.js');
        resetSetSave();
        fs.failWrites = true;
        eng.stateBlob = 'movy1\nbpm 14500\n';
        seqState.dirty = true;
        const r = saveSet('S8', 0, true);
        eq('a failed write reports failure', r.ok, false);
        eq('and stays pending past the engine mirror', saveNeeded(), true);
        uninstallMockEngine(); uninstallMockFs();
    }
}

/* ── automation: restore re-requests label sync ──────────────────────────────
 * The boot label-sync runs before the persist restore, so it reads the engine
 * before its lanes exist (empty registry → no dot, no held value, no read-back
 * suppression). The restore must re-request the sync so the registry repopulates
 * from the now-restored engine labels. */
_log('\nautomation: restore re-requests label sync:');
{
    const { resetSeqEngine, seqEngineTick, takeLabelSync } = await import('../../dist/esm/seq/engine.js');
    const { sessionTick: labelSessionTick, resetSetSession: resetLabelSession } =
        await import('../../dist/esm/seq/set-session.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');

    installMockFs({
        '/data/UserData/schwung/active_set.txt': 'LS1\nLabel Set\n',
        [uuidToStatePath('LS1')]: 'movy1\nau 0 0 100 synth:cutoff\n',   // a persisted lane label
    });
    installMockEngine();
    const origSetB = globalThis.host_module_set_param_blocking;
    globalThis.host_module_set_param_blocking = () => true;

    resetSeqEngine(); resetSeqState(); resetLabelSession(); resetStoreRotation();
    seqEngineTick();          // boot probe → ready → requestLabelSync (the boot's own)
    takeLabelSync();          // consume it, to isolate the restore's re-request
    eq('no pending label sync before restore', takeLabelSync(), false);
    labelSessionTick();         // first ready tick → restore pushes state
    eq('restore re-requests label sync', takeLabelSync(), true);

    globalThis.host_module_set_param_blocking = origSetB;
    uninstallMockFs();
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetLabelSession();
}

/* ── active-notes mirror ─────────────────────────────────────────────────── */
{
    _log('\nactive-notes mirror:');
    const { activeFromStr, activeHasNote } = await import('../../dist/esm/seq/state.js');

    activeFromStr('60.64,,38,');
    eq('track0 has 60',  activeHasNote(0, 60), true);
    eq('track0 has 64',  activeHasNote(0, 64), true);
    eq('track0 lacks 38', activeHasNote(0, 38), false);
    eq('track1 empty',   activeHasNote(1, 60), false);
    eq('track2 has 38',  activeHasNote(2, 38), true);
    activeFromStr(',,,'); // all clear
    eq('cleared',        activeHasNote(2, 38), false);
}

/* ── last-held set ───────────────────────────────────────────────────────── */
{
    _log('\nlast-held set:');
    const { noteHeld, setHeldSet, clearHeldSet } = await import('../../dist/esm/seq/held.js');

    clearHeldSet(0);
    eq('empty initially', noteHeld(0, 60), false);
    setHeldSet(0, [60, 64, 67]);
    eq('60 held',  noteHeld(0, 60), true);
    eq('64 held',  noteHeld(0, 64), true);
    eq('62 not',   noteHeld(0, 62), false);
    eq('track1 unaffected', noteHeld(1, 60), false);
    setHeldSet(0, [72]);                 // replaces
    eq('replaced: 60 gone', noteHeld(0, 60), false);
    eq('replaced: 72 in',   noteHeld(0, 72), true);
}

}
