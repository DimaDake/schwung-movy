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
    installMockFs, uninstallMockFs, resetStoreRotation, ok, fail, eq, _log,
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
    const { resetSetSave } = await import('../../dist/esm/seq/set-save.js');

    const ACTIVE = '/data/UserData/schwung/active_set.txt';

    /* `chpend` is the engine's own count of chain-module loads it has accepted
     * but not yet released — one per audio callback. Until it hits zero the
     * Set's modules do not exist yet, whatever the state blob says. */
    const boot = (files, pend) => {
        const fs = installMockFs(files);
        const eng = installMockEngine();
        eng.status.chpend = pend;
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
        for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
        return { fs, eng };
    };
    const teardown = () => {
        uninstallMockEngine(); uninstallMockFs();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
    };
    const run = (n = 200) => { for (let i = 0; i < n; i++) { seqEngineTick(); sessionTick(); } };

    /* S1 — modules still draining: the Set is loaded but not playable, so the
     * splash stays and input stays refused. */
    {
        const { eng } = boot({ [ACTIVE]: 'SET1\nA Set\n' }, 3);
        eq('S1 phase is settling', sessionPhase(), 'settling');
        eq('S1 not ready', sessionReady(), false);
        eq('S1 the Set is nonetheless identified', currentSetUuid(), 'SET1');
        eq('S1 the state went in once', eng.stateLoads.length, 1);
        teardown();
    }

    /* S2 — the last module lands, and only then does movy go live. */
    {
        const { eng } = boot({ [ACTIVE]: 'SET1\nA Set\n' }, 3);
        eng.status.chpend = 0;
        run();
        eq('S2 ready once the loads drained', sessionPhase(), 'ready');
        eq('S2 and it never re-pushed the Set', eng.stateLoads.length, 1);
        teardown();
    }

    /* S3 — a module that never loads must not brick the instrument: the wait is
     * capped, and the cap goes live rather than to the failure screen. */
    {
        const realNow = Date.now;
        let t = 100000; Date.now = () => t;
        const { eng } = boot({ [ACTIVE]: 'SET1\nA Set\n' }, 2);
        eq('S3 still settling before the cap', sessionPhase(), 'settling');
        t += 11000;
        run(4);
        eq('S3 the cap goes live', sessionPhase(), 'ready');
        eq('S3 with the load still outstanding', eng.status.chpend, 2);
        Date.now = realNow;
        teardown();
    }

    /* S4 — a Set SWITCH shows the splash again. It used to be invisible:
     * identityChanged → enterLoading → ready all completed inside one tick, so
     * no frame ever rendered a non-ready phase. */
    {
        const { fs, eng } = boot({ [ACTIVE]: 'SET1\nA Set\n' }, 0);
        eq('S4 live on the first Set', sessionPhase(), 'ready');
        eng.status.chpend = 4;                  // the incoming Set's modules
        fs.files[ACTIVE] = 'SET2\nB Set\n';
        run();
        eq('S4 the switch re-enters settling', sessionPhase(), 'settling');
        eq('S4 on the new Set', currentSetUuid(), 'SET2');
        eng.status.chpend = 0;
        run();
        eq('S4 and finishes', sessionPhase(), 'ready');
        teardown();
    }

    /* S6 — `chpend` is a mirror: it still reads the previous Set's zero on the
     * tick the loads are queued, so promoting on it before the engine has been
     * asked again is promoting on a stale answer. */
    {
        const fs = installMockFs({ [ACTIVE]: 'SET1\nA Set\n' });
        const eng = installMockEngine();
        resetSeqEngine(); resetSeqState(); resetSetSession(); resetSetSave(); resetStoreRotation();
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
        const { eng } = boot({ [ACTIVE]: 'SET1\nA Set\n' }, 5);
        run(2000);
        eq('S5 still settling', sessionPhase(), 'settling');
        eq('S5 the Set was pushed exactly once', eng.stateLoads.length, 1);
        teardown();
    }

    /* S7 — a Set Move has not committed yet gets a track-button press injected
     * so Move makes it real. That press hands Move the surface for ~1.75 s, so
     * it belongs INSIDE the splash: it used to run just after movy declared
     * itself ready, and a pad hit in that window played Move, not movy. */
    {
        const realNow = Date.now;
        let t = 500000; Date.now = () => t;
        const injected = [];
        const origInject = globalThis.move_midi_inject_to_move;
        const origMode = globalThis.shadow_set_overtake_mode;
        globalThis.move_midi_inject_to_move = (d) => injected.push(d.slice());
        globalThis.shadow_set_overtake_mode = () => {};

        boot({ [ACTIVE]: '__pending-4-2\nNew Set\n' }, 0);
        eq('S7 settling while the Set is uncommitted', sessionPhase(), 'settling');
        eq('S7 nothing pressed yet', injected.length, 0);

        t += 1600; run(4);                     // Move has finished loading the Set
        eq('S7 still settling while Move holds the surface', sessionPhase(), 'settling');
        t += 300; run(4);                      // the press goes out
        t += 300; run(4);                      // and is released
        t += 300; run(4);                      // surface handed back
        eq('S7 the press was injected', injected.length, 2);
        eq('S7 ready only once the surface came back', sessionPhase(), 'ready');

        Date.now = realNow;
        if (origInject) globalThis.move_midi_inject_to_move = origInject;
        else delete globalThis.move_midi_inject_to_move;
        if (origMode) globalThis.shadow_set_overtake_mode = origMode;
        else delete globalThis.shadow_set_overtake_mode;
        teardown();
    }
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
    /* The tail of the wait: the modules are in and the Set is being committed. */
    eq('settling with none left', loadingStage('settling', 0), 'PREPARING SET');
}

}
