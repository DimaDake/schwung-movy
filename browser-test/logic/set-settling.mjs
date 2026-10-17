/* browser-test/logic/set-settling.mjs — the loading splash's readiness gate
 *
 * A Set being LOADED is not a Set being PLAYABLE: `restoreChains` only queues
 * the module loads, and the engine releases one per audio callback. This suite
 * owns the settling phase that closes that gap, and the splash text that names
 * what it is waiting on.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    installMockFs, uninstallMockFs, resetPorts,
    ok, fail, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── settling: the splash stays up until the Set is usable ───────────────── */
{
    _log('\nset settling:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { sessionTick, sessionPhase, sessionReady, currentSetUuid, resetSetSession }
        = await import('../../dist/esm/seq/set-session.js');

    /* Identity is the mock library's one Set, `S1`; the engine owns its files,
     * so "the Set went in" is an `open` command, counted here. */
    const opens = (eng) => eng.setCmds.filter((c) => c === 'open S1').length;

    /* `chpend` is the engine's own count of chain-module loads it has accepted
     * but not yet released — one per audio callback. Until it hits zero the
     * Set's modules do not exist yet, whatever the state blob says. */
    const boot = (files, pend) => {
        const fs = installMockFs(files);
        const eng = installMockEngine();
        eng.status.chpend = pend;
        resetSeqEngine(); resetSeqState(); resetSetSession();
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        return { fs, eng };
    };
    const teardown = () => {
        uninstallMockEngine(); uninstallMockFs();
        resetSeqEngine(); resetSeqState(); resetSetSession();
    };
    const run = (n = 200) => { for (let i = 0; i < n; i++) { seqEngineTick(); sessionTick(); } };

    /* S1 — modules still draining: the Set is loaded but not playable, so the
     * splash stays and input stays refused. */
    {
        const { eng } = boot({}, 3);
        eq('S1 phase is settling', sessionPhase(), 'settling');
        eq('S1 not ready', sessionReady(), false);
        eq('S1 the Set is nonetheless identified', currentSetUuid(), 'S1');
        eq('S1 the open went out once', opens(eng), 1);
        teardown();
    }

    /* S2 — the last module lands, and only then does movy go live. */
    {
        const { eng } = boot({}, 3);
        eng.status.chpend = 0;
        run();
        eq('S2 ready once the loads drained', sessionPhase(), 'ready');
        eq('S2 and it never re-opened the Set', opens(eng), 1);
        teardown();
    }

    /* S3 — a module that never loads must not brick the instrument: the wait is
     * capped, and the cap goes live rather than to the failure screen. */
    {
        const realNow = Date.now;
        let t = 100000; Date.now = () => t;
        const { eng } = boot({}, 2);
        eq('S3 still settling before the cap', sessionPhase(), 'settling');
        t += 11000;
        run(4);
    console.log('S9 after run(4): phase=', sessionPhase());
        eq('S3 the cap goes live', sessionPhase(), 'ready');
        eq('S3 with the load still outstanding', eng.status.chpend, 2);
        Date.now = realNow;
        teardown();
    }

    /* S4 — a Set SWITCH shows the splash again. It used to be invisible:
     * identityChanged → enterLoading → ready all completed inside one tick, so
     * no frame ever rendered a non-ready phase. */
    {
        const { wantSet } = await import('../../dist/esm/seq/set-source.js');
        const { eng } = boot({}, 0);
        eq('S4 live on the first Set', sessionPhase(), 'ready');
        eng.status.chpend = 4;                  // the incoming Set's modules
        eng.lib.sets.push({ id: 'S2', name: 'B Set', clips: 0 });
        eng.lib.rev++;
        wantSet('S2');
        run();
        eq('S4 the switch re-enters settling', sessionPhase(), 'settling');
        eq('S4 on the new Set', currentSetUuid(), 'S2');
        eng.status.chpend = 0;
        run();
        eq('S4 and finishes', sessionPhase(), 'ready');
        teardown();
    }

    /* S6 — `chpend` is a mirror: it still reads the previous Set's zero on the
     * tick the loads are queued, so promoting on it before the engine has been
     * asked again is promoting on a stale answer. */
    {
        const fs = installMockFs({});
        const eng = installMockEngine();
        resetSeqEngine(); resetSeqState(); resetSetSession();
        seqEngineTick(); sessionTick();      // probe lands, the Set loads — no status yet
        eq('S6 the loading tick does not also declare it ready', sessionPhase(), 'settling');
        seqEngineTick(); sessionTick();      // first status poll of this Set
        eq('S6 ready once the engine has answered', sessionPhase(), 'ready');
        void fs; void eng;
        teardown();
    }

    /* S5 — the settling window is not a load loop. The identity poll re-runs
     * every ~0.5 s, and reloading the Set on each pass would restart every
     * module load it is waiting on. */
    {
        const { eng } = boot({}, 5);
        run(2000);
        eq('S5 still settling', sessionPhase(), 'settling');
        eq('S5 the Set was opened exactly once', opens(eng), 1);
        teardown();
    }

    /* S8 — the loads draining is not the end of the wait. A chain's preset
     * blob, LFOs and mixer level address modules those loads bring in, so
     * they are delivered HERE, once the loads have drained, and the Set goes
     * playable with them in the queue. Promoting before them is what put a
     * live surface in front of modules sitting at their factory defaults: the
     * filter reopened, the oscillator octaves reset.
     * See plans/2026-08-29-chain-payload-delivery.md. */
    {
        const { armChainPayloads, chainPayloadsPending, resetChainPayloads } =
            await import('../../dist/esm/track/chain-payload.js');
        const arm = () => armChainPayloads(
            [{ t: 4, pairs: [['synth:state', 'BLOB42']], saved: { t: 4, comp: [] } }]);

        let loaded = true;
        const delivered = [];
        const oBS = globalThis.shadow_set_params;
        globalThis.shadow_set_params = (_s, _m, payload) => { if (!loaded) return false; delivered.push(payload); return true; };

        const fs = installMockFs({});
        const eng = installMockEngine();
        eng.status.chpend = 0;
        resetSeqEngine(); resetSeqState(); resetSetSession();
        resetChainPayloads();

        seqEngineTick(); sessionTick();        // the Set loads; settling begins
        arm();
        run(3);
        eq('S8 the payload is delivered before the Set goes live', delivered.length, 1);
        eq('S8 delivering it goes live', sessionPhase(), 'ready');
        eq('S8 with nothing outstanding', chainPayloadsPending(), false);

        /* With no engine to take it, a payload must not brick the instrument
         * either — same rule as the load cap above — and it stays outstanding,
         * so the capture keeps guarding the set file. */
        resetSetSession(); 
        loaded = false;
        seqEngineTick(); sessionTick();
        arm();
        run(3);
        eq('S8 a payload that cannot land still goes live', sessionPhase(), 'ready');
        eq('S8 and stays outstanding', chainPayloadsPending(), true);

        globalThis.shadow_set_params = oBS;
        resetChainPayloads();
        void fs; void eng;
        teardown();
    }
}

/* ── S9: the UI's own caches are part of "loaded" ────────────────────────── */
{
    _log('\nset load re-reads the UI caches:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { sessionTick, sessionPhase, resetSetSession }
        = await import('../../dist/esm/seq/set-session.js');
    const { appState } = await import('../../dist/esm/app/state.js');

    /* A Model caches its module name and its whole param hierarchy behind a
     * ~1 s poll, and nothing used to kick that poll on a Set load — so the
     * first frame after the splash was drawn from a cache older than the Set.
     * These stand in for the models: `reloadNow()` is the synchronous re-read
     * the load owes the one on screen, `reload()` the scheduled one the rest
     * get. `phaseAt` records that it happens BEFORE movy goes live, which is
     * the whole claim — doing it after is what the user saw. */
    const mk = () => ({
        now: 0, later: 0, phaseAt: '',
        reloadNow() { this.now++; this.phaseAt = sessionPhase(); },
        reload() { this.later++; },
        getDrumConfig() { return null; },     // read off every synth slot each tick
        getViewModel() { return { isEmpty: false }; },
    });
    const shown = mk();
    const offscreen = mk();

    const origModels = appState.trackModels;
    const origMaster = appState.masterFxModels;
    appState.trackModels = [[offscreen, shown], [offscreen, offscreen]];
    appState.masterFxModels = [];
    appState.trackChainIndex[0] = 1;

    const fs = installMockFs({});
    const eng = installMockEngine();
    eng.status.chpend = 2;                    // the Set's modules are still draining
    resetSeqEngine(); resetSeqState(); resetSetSession();
    const run = (n) => { for (let i = 0; i < n; i++) { seqEngineTick(); sessionTick(); } };

    run(4);
    eq('S9 nothing is re-read while the modules are still loading', shown.now, 0);
    eq('S9 and the splash is still up', sessionPhase(), 'settling');

    eng.status.chpend = 0;
    run(200);                                 // enough for a status poll to land
    eq('S9 the shown model is re-read once the engine holds the Set', shown.now, 1);
    eq('S9 and it happened BEFORE movy went live', shown.phaseAt, 'settling');
    eq('S9 so the first live frame is truthful', sessionPhase(), 'ready');
    /* Eighty models' worth of synchronous reads on one tick would cost far more
     * than it buys, and each re-reads on the tick it becomes visible. */
    eq('S9 an off-screen model is scheduled, not read now', offscreen.now, 0);
    eq('S9 but it IS scheduled', offscreen.later > 0, true);

    run(200);
    eq('S9 a load re-reads once, not once per tick', shown.now, 1);

    appState.trackModels = origModels;
    appState.masterFxModels = origMaster;
    void fs;
    uninstallMockEngine(); uninstallMockFs();
    resetSeqEngine(); resetSeqState(); resetSetSession();
}

/* ── S10: a Set whose slot is empty does not land on a module page ───────── */
{
    const { refreshModelsForSet } = await import('../../dist/esm/app/model-refresh.js');
    const { appState, VIEW_CHAIN, VIEW_KNOBS } = await import('../../dist/esm/app/state.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');
    const mk = (isEmpty) => ({
        reloadNow() {}, reload() {}, getViewModel() { return { isEmpty }; },
    });
    const orig = { models: appState.trackModels, master: appState.masterFxModels,
                   view: appState.currentView, tv: appState.trackView.slice(),
                   track: appState.activeTrack.index, ci: appState.trackChainIndex[0],
                   session: seqState.sessionMode };
    seqState.sessionMode = false;
    appState.masterFxModels = [];
    appState.activeTrack.index = 0;
    appState.trackChainIndex[0] = 1;

    appState.trackModels = [[mk(false), mk(true)], [mk(false), mk(false)]];
    appState.currentView = VIEW_KNOBS;
    appState.trackView[1] = VIEW_KNOBS;
    refreshModelsForSet();
    eq('S10 an empty slot on the module page falls back to the chain page', appState.currentView, VIEW_CHAIN);
    eq('S10 another track\'s remembered module page goes too', appState.trackView[1], VIEW_CHAIN);

    appState.trackModels = [[mk(false), mk(false)], [mk(false), mk(false)]];
    appState.currentView = VIEW_KNOBS;
    refreshModelsForSet();
    eq('S10 a slot with a module keeps its module page', appState.currentView, VIEW_KNOBS);

    appState.trackModels = orig.models; appState.masterFxModels = orig.master;
    appState.currentView = orig.view; appState.trackView = orig.tv;
    appState.activeTrack.index = orig.track; appState.trackChainIndex[0] = orig.ci;
    seqState.sessionMode = orig.session;
}

/* ── a short wait draws no splash at all ─────────────────────────────────── */
{
    _log('\nsplash is held back for short waits:');
    const lv = await import('../../dist/esm/renderer/loading-view.js');
    let cleared = 0;
    const origClear = globalThis.clear_screen;
    globalThis.clear_screen = () => { cleared++; };
    lv.loadingWaitMs(true, 0);                      // a fresh wait
    const w0 = lv.loadingWaitMs(false, 1000);
    eq('the first frame of a wait draws no words', lv.renderLoadingView('booting', '', 0, 'set', w0), false);
    eq('but still blanks the screen (a switch must cover the old page)', cleared, 1);
    ok('and is not yet due', !lv.splashDue(w0));
    const w1 = lv.loadingWaitMs(false, 1000 + lv.SPLASH_DELAY_MS - 1);
    ok('nor just under the delay', !lv.splashDue(w1));
    const w2 = lv.loadingWaitMs(false, 1000 + lv.SPLASH_DELAY_MS);
    ok('a wait that lasts brings it up', lv.splashDue(w2));
    ok('once', !lv.splashDue(lv.loadingWaitMs(false, 1000 + lv.SPLASH_DELAY_MS + 50)));
    eq('and then the words are drawn', lv.renderLoadingView('booting', '', 0, 'set', w2), true);
    eq('a failure is never held back', lv.renderLoadingView('failed', 'X', 0, 'set', false, 0), true);
    eq('live resets the wait', lv.loadingWaitMs(true, 5000), 0);
    ok('so the next wait is held back again', !lv.splashDue(lv.loadingWaitMs(false, 5001)));
    globalThis.clear_screen = origClear;
}

/* ── splash text ─────────────────────────────────────────────────────────── */
{
    _log('\nloading splash names the stage:');
    const { loadingStage } = await import('../../dist/esm/renderer/loading-view.js');

    eq('booting', loadingStage('booting', 0), 'STARTING ENGINE');
    eq('loading', loadingStage('loading', 0), 'LOADING SET');
    /* A switch reads as a load: from the user's side it is the same wait, and
     * naming it differently would only tell them which branch of the lifecycle
     * they are in. */
    eq('switching reads as loading', loadingStage('switching', 0), 'LOADING SET');
    eq('settling with loads outstanding', loadingStage('settling', 4), 'LOADING MODULES');
    /* The tail of the wait: the modules are in, their payloads are landing. */
    eq('settling with none left', loadingStage('settling', 0), 'PREPARING SET');
}

}
