/* browser-test/logic/set-session.mjs — set sessions: engine generation, set switching, set-load, the active-note mirror
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    setFlag as setFlagFixture,
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
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { sessionTick, sessionPhase, sessionReady, currentSetUuid,
            resetSetSession } = await import('../../dist/esm/seq/set-session.js');
    const { resetSetSave } = await import('../../dist/esm/seq/set-save.js');
    const { readBestState } = await import('../../dist/esm/seq/persist-store.js');

    const SAVED  = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';

    /* Identity is the library's (the mock engine's: one Set, `S1`), and the
     * engine owns the Set files — the only arrangement movy-host runs. */
    const boot = (files, opts = {}) => {
        const fs = installMockFs(files);
        const eng = installMockEngine();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
        setFlagFixture('engpersist', 1);
        if (!opts.skipBoot) for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        return { fs, eng };
    };
    const teardown = () => {
        uninstallMockEngine(); uninstallMockFs();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
    };
    const run = (n = 200) => { for (let i = 0; i < n; i++) { seqEngineTick(); sessionTick(); } };
    const opens = (eng, id) => eng.setCmds.filter((c) => c === 'open ' + id).length;

    /* R5 — the phase gate. Nothing is live until the engine holds the Set. */
    {
        const { eng } = boot({}, { skipBoot: true });
        eq('R5 booting before the engine answers', sessionPhase(), 'booting');
        eq('R5 and not ready', sessionReady(), false);
        run();
        eq('R5 ready once loaded', sessionPhase(), 'ready');
        eq('R5 and live', sessionReady(), true);
        eq('R5 on the library\'s Set', currentSetUuid(), 'S1');
        eq('R5 which the engine was told to open', opens(eng, 'S1'), 1);

        /* R5b — SP-52: session mode has no `currentView` of its own, so the
         * module grid must answer off `masterDetail`, never off whatever view
         * was on screen when Session was entered. */
        const { appState, VIEW_KNOBS, VIEW_CHAIN, VIEW_BROWSE, VIEW_CPU, VIEW_CLIP_PARAMS } =
            await import('../../dist/esm/app/state.js');
        const { moduleGridOnScreen } = await import('../../dist/esm/app/page-poll.js');
        const savedView = appState.currentView;

        seqState.sessionMode = false;
        appState.currentView = VIEW_KNOBS;
        ok('the track module page is the grid', moduleGridOnScreen());
        appState.currentView = VIEW_BROWSE;
        ok('a different track view is not', !moduleGridOnScreen());

        seqState.sessionMode = true;
        appState.masterDetail = false;
        appState.currentView = VIEW_CHAIN; // leftover from before Session opened
        /* SP-58: the master GRID draws the focused slot's knob body under the
         * slot bar, exactly as a track's VIEW_CHAIN does. */
        ok('the master GRID draws a param body too', moduleGridOnScreen());
        appState.masterDetail = true;
        ok('the master DETAIL page is', moduleGridOnScreen());
        appState.currentView = VIEW_KNOBS; // leftover the other way — must not matter
        ok('...regardless of what currentView says', moduleGridOnScreen());
        appState.currentView = VIEW_BROWSE;
        ok('a browser opened from the master chain is not', !moduleGridOnScreen());
        appState.currentView = VIEW_CPU;
        ok('the CPU page over Session is not', !moduleGridOnScreen());
        appState.currentView = VIEW_CLIP_PARAMS;
        ok('Clip Params over Session is its own grid', moduleGridOnScreen());

        seqState.sessionMode = false;
        appState.masterDetail = false;
        appState.currentView = savedView;
        teardown();
    }

    /* R6 — the destructive one. A re-dlopened engine comes up EMPTY. The
     * session must open the Set into it again before anything can save from it. */
    {
        const { eng } = boot({ [uuidToStatePath('S1')]: SAVED });
        eq('R6 opened once', opens(eng, 'S1'), 1);
        eng.statusUnavailable = true;
        run(160);
        eng.statusUnavailable = false;
        run(80);
        eq('R6 the new engine was told to open the Set again', opens(eng, 'S1'), 2);
        eq('R6 and the Set on disk was never touched by the UI', readBestState('S1').payload, SAVED);
        teardown();
    }

    /* R9 — a Set whose state file will not parse is NAMED, not silently blanked.
     * Recovery is offered rather than taken: the file may still be salvageable
     * off-device, and movy overwriting it destroys the only copy. */
    {
        const { sessionError } = await import('../../dist/esm/seq/set-session.js');
        const { sessionStartFromScratch } = await import('../../dist/esm/seq/set-fail.js');
        const { fs, eng } = boot({ [uuidToStatePath('S1')]: 'not a movy blob at all' });

        eq('R9 the failure is reported', sessionPhase(), 'failed');
        eq('R9 and named', sessionError(), 'SET FILE UNREADABLE');
        eq('R9 movy is not live', sessionReady(), false);
        eq('R9 the bad file was not overwritten',
            fs.files[uuidToStatePath('S1')], 'not a movy blob at all');
        eq('R9 nor blanked behind the user\'s back', eng.setCmds.includes('blank S1'), false);

        sessionStartFromScratch();      // the user takes the offer
        fs.files[uuidToStatePath('S1')] = 'movy1\n';   // what the engine's blank writes
        run();
        eq('R9 starting from scratch asks the engine to blank it', eng.setCmds.includes('blank S1'), true);
        eq('R9 and recovers', sessionPhase(), 'ready');
        eq('R9 on the same set', currentSetUuid(), 'S1');
        teardown();
    }

    /* R10 — an engine that never answers is a failure, not an endless spinner. */
    {
        const { sessionError } = await import('../../dist/esm/seq/set-session.js');
        const { eng } = boot({}, { skipBoot: true });
        eng.statusUnavailable = true;
        eng.pingUnavailable = true;
        run(4000);                      // past every probe and load retry
        eq('R10 gave up visibly', sessionPhase(), 'failed');
        eq('R10 and said why', sessionError(), 'ENGINE DID NOT START');
        teardown();
    }

    /* R13 — the engine ANSWERED, with the wrong version: a `dsp.so` other than
     * the one this ui.js was built with. Reported as silence it is a dead end;
     * reported as what it is, the fix is a restart. */
    {
        const { sessionError, sessionFailScope }
            = await import('../../dist/esm/seq/set-session.js');
        const { engineAbsentReason } = await import('../../dist/esm/seq/engine.js');
        const { fs, eng } = boot({ [uuidToStatePath('S1')]: SAVED }, { skipBoot: true });
        eng.statusUnavailable = true;
        eng.pingVersion = '0.0.1-previous';
        run(4000);
        eq('R13 gave up visibly', sessionPhase(), 'failed');
        eq('R13 knowing an engine answered', engineAbsentReason(), 'stale');
        eq('R13 and named the update, not a dead engine',
            sessionError(), 'MOVY WAS UPDATED');
        eq('R13 the failure is the engine, not this set', sessionFailScope(), 'engine');
        eq('R13 the set was not touched', fs.files[uuidToStatePath('S1')], SAVED);
        teardown();
    }

    /* R14 — the failure screen only offers to blank the set when blanking it
     * could possibly help. Starting empty answers ONE failure: this set's file
     * will not parse. Offered against an engine that never started it destroys
     * an intact set for a user who read the jog click as "get me out of here". */
    {
        const { failureLines } = await import('../../dist/esm/renderer/loading-view.js');
        /* Through the app entry, which is what the device calls: it is the only
         * built artefact carrying the router. */
        await import('../../dist/esm/app/globals.js');
        const onMidiMessageInternal = globalThis.onMidiMessageInternal;
        const { sessionError, sessionFailScope }
            = await import('../../dist/esm/seq/set-session.js');

        eq('R14 an unreadable set is offered the wipe',
            failureLines('SET FILE UNREADABLE', 'set')[2], 'JOG CLICK = START EMPTY');
        eq('R14 an engine failure is offered a restart',
            failureLines('MOVY WAS UPDATED', 'engine')[1], 'RESTART YOUR MOVE');
        eq('R14 and no wipe at all',
            failureLines('MOVY WAS UPDATED', 'engine')[2], '');
        eq('R14 nor is the set blamed for it',
            failureLines('MOVY WAS UPDATED', 'engine')[0], 'MOVY WAS UPDATED');

        /* And the button itself, which is what actually writes. The engine has
         * to die AFTER the Set is open, which is the case that can lose data —
         * an engine that never started leaves movy with no Set identity, and
         * asserting on that passes with the guard removed. */
        const { eng } = boot({ [uuidToStatePath('S1')]: SAVED });
        eq('R14 the Set opened first', currentSetUuid(), 'S1');
        eng.statusUnavailable = true;
        eng.pingVersion = '0.0.1-previous';
        run(4000);
        eq('R14 the engine failure is up', sessionFailScope(), 'engine');
        eq('R14 with the Set still identified', currentSetUuid(), 'S1');

        onMidiMessageInternal([0xB0, globalThis.MoveMainButton, 127]);
        eq('R14 a jog click does NOT blank the set', eng.setCmds.includes('blank S1'), false);
        eq('R14 and the screen still says what to do', sessionError(), 'MOVY WAS UPDATED');
        teardown();
    }

    /* R7 — teardown flushes: the engine is told to keep this point in the
     * Set's history, since it cannot see a teardown itself. */
    {
        const { sessionFlush } = await import('../../dist/esm/seq/set-session.js');
        const { eng } = boot({ [uuidToStatePath('S1')]: SAVED });
        sessionFlush(true);          // what onUnload calls
        ok('R7 the flush asks the engine to keep an exit version', eng.setCmds.includes('keep exit'));
        teardown();
    }

    /* R11 — a switch is a switch: the library Set the UI wants is opened, and
     * the one it left is flushed first. */
    {
        const { wantSet } = await import('../../dist/esm/seq/set-source.js');
        const { eng } = boot({});
        eng.lib.sets.push({ id: 'S2', name: 'Song Two', clips: 0 });
        eng.lib.rev++;
        const before = eng.setCmds.length;
        wantSet('S2');
        run();
        const after = eng.setCmds.slice(before);
        eq('R11 the switch opened the wanted Set', currentSetUuid(), 'S2');
        ok('R11 after keeping the one it left', after.indexOf('keep exit') >= 0
            && after.indexOf('keep exit') < after.indexOf('open S2'), after.join(' | '));
        teardown();
    }
}

/* ── set-load ────────────────────────────────────────────────────────────── */
{
    _log('\nset-load:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { loadSet, pushState } = await import('../../dist/esm/seq/set-load.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');
    const { readBestState } = await import('../../dist/esm/seq/persist-store.js');

    const SAVED = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';
    /* The UI-writer half (`engpersist` off) is still code — a debug build can
     * select it — so these unit cases pin it explicitly. */
    setFlagFixture('engpersist', 0);

    {
        installMockFs({ [uuidToStatePath('S1')]: SAVED });
        const eng = installMockEngine();
        const got = loadSet('S1');
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
    setFlagFixture('engpersist', 1);
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
        [uuidToStatePath('S1')]: 'movy1\nau 0 0 100 synth:cutoff\n',   // a persisted lane label
    });
    installMockEngine();
    const origSetB = globalThis.host_module_set_param_blocking;
    globalThis.host_module_set_param_blocking = () => true;

    resetSeqEngine(); resetSeqState(); resetLabelSession(); resetStoreRotation();
    seqEngineTick();          // boot probe → ready → requestLabelSync (the boot's own)
    takeLabelSync();          // consume it, to isolate the restore's re-request
    eq('no pending label sync before restore', takeLabelSync(), false);
    labelSessionTick();         // first ready tick → the library names S1 and the open goes out
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
