/* browser-test/logic/seq-engine.mjs — sequencer engine plumbing: cmd batching, status parsing, Capture, tempo, swing
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    installMockEngine, uninstallMockEngine, seqCmd, seqEngineTick, resetSeqEngine, eq,
    lastMusicalOp, _log,
} from './harness.mjs';

export async function run() {
/* ── seq engine plumbing: cmd batching + status polling ──────────────────── */
{
    _log('\nseq engine plumbing:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqCmd, seqEngineTick, resetSeqEngine, engineAvailable } =
        await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState();

    eq('engine detected via host_module_* globals', engineAvailable(), true);
    seqEngineTick(); // boot probe: ping matches → engine ready
    seqEngineTick(); // first post-boot tick polls status

    eq('status poll marks engineOk', seqState.engineOk, true);
    eq('status play=0 parsed', seqState.playing, false);

    /* Boot writes the host's inject capability straight out (engine.ts), which
     * is traffic of its own — the coalescing assertions below are about the
     * ops a user gesture queues, so start them from a clean sheet. */
    engine.cmdBatches.length = 0; engine.ops.length = 0;

    // Multiple queued ops must flush as ONE batched set_param (coalescing).
    seqCmd('watch 0');
    seqCmd('non 0 60 100');
    seqCmd('nof 0 60');
    seqEngineTick();
    eq('three ops → one set_param call', engine.cmdBatches.length, 1);
    eq('batch joins ops with ;', engine.cmdBatches[0], 'watch 0;non 0 60 100;nof 0 60');
    eq('ops parsed on engine side', engine.ops.length, 3);

    // No queued ops → no set_param traffic.
    const before = engine.setParamCalls;
    seqEngineTick();
    eq('idle tick sends no cmd', engine.setParamCalls, before);

    // Status changes propagate on the next poll cadence.
    engine.status.play = 1;
    engine.status.tick = 4321;
    engine.status.bpm = 13350;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('play state mirrored', seqState.playing, true);
    eq('engine tick mirrored', seqState.engineTick, 4321);
    eq('bpm mirrored', seqState.bpmX100, 13350);

    // Mock engine serializes arbitrary status keys so tests can inject act=.
    const { activeHasNote } = await import('../../dist/esm/seq/state.js');
    engine.status.act = '38';            // track 0 pitch 38 sounding
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('injected act= populates activeNotes', activeHasNote(0, 38), true);
    delete engine.status.act;

    // Unknown status keys must be ignored (forward compat).
    engine.status.tick = 9;
    globalThis.host_module_get_param = (key) =>
        key === 'status' ? 'play=1 tick=9 bpm=13350 future_key=42' : null;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('unknown status key ignored', seqState.engineTick, 9);

    // Dead engine (all gets return null): the boot probe re-issues the DSP load
    // a bounded number of times, then backs off. The back-off is a pause, not a
    // surrender — slot 0 holds ONE overtake DSP for the whole device, so another
    // tool can take ours away and hand it back long after we stopped asking.
    const dead = installMockEngine();
    const deadGet = () => { deadGets++; return null; };
    let deadGets = 0;
    globalThis.host_module_get_param = deadGet;
    resetSeqEngine(); resetSeqState();
    const { engineReady } = await import('../../dist/esm/seq/engine.js');
    for (let i = 0; i < 1500; i++) seqEngineTick();
    eq('dead engine: 3 load attempts', dead.loadRequests.length, 3);
    eq('dead engine: load path correct',
        dead.loadRequests[0], '/data/UserData/schwung/modules/tools/movy/dsp.so');
    eq('dead engine: backs off (not ready)', engineReady(), false);
    eq('dead engine: probing bounded', deadGets <= 40, true);
    eq('dead engine: engineOk stays false', seqState.engineOk, false);

    // Recovery: once the engine answers again, the back-off ends on its own.
    // (It used to be terminal — commands were dropped for the rest of the tool's
    // life while the DSP played on, curable only by reopening movy.)
    installMockEngine();
    for (let i = 0; i < 2200; i++) seqEngineTick();
    eq('engine returns: back-off ends and it boots', engineReady(), true);

    // The three attempts are per outage, not cumulative over the session. Two
    // brief losses that each recovered on their own used to leave only one
    // attempt for the third — after which every command was silently dropped
    // while the DSP played on, curable only by reopening movy.
    const flaky = installMockEngine();
    const liveGet = globalThis.host_module_get_param;
    resetSeqEngine(); resetSeqState();
    seqEngineTick();                                    // boots clean
    globalThis.host_module_get_param = deadGet;
    for (let i = 0; i < 700; i++) seqEngineTick();      // outage 1: 2 attempts
    eq('outage 1: two attempts spent', flaky.loadRequests.length, 2);
    globalThis.host_module_get_param = liveGet;         // engine answers again
    for (let i = 0; i < 40; i++) seqEngineTick();
    eq('outage 1: recovers without backing off', engineReady(), true);

    flaky.reset();
    globalThis.host_module_get_param = deadGet;
    for (let i = 0; i < 1200; i++) seqEngineTick();
    eq('outage 2: a fresh 3 attempts, not 1', flaky.loadRequests.length, 3);

    // Stale engine (wrong version pong): reload requested immediately.
    const e3 = installMockEngine();
    globalThis.host_module_get_param = (key) => (key === 'ping' ? 'pong 0.0.1' : null);
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    eq('stale engine: reload requested on first probe', e3.loadRequests.length, 1);
    e3.reset();

    // No engine at all: everything is a no-op.
    uninstallMockEngine();
    resetSeqEngine();
    seqCmd('play');
    seqEngineTick();
    eq('no engine: engineAvailable false', engineAvailable(), false);
}

/* ── automation: status fields parse into the mirror ─────────────────────── */
{
    _log('\nautomation status parse:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=0 trk=0 alanes=05 aauto=04 hauto=2:50');
    eq('autoAssigned parsed', seqState.autoAssigned, 0x05);
    eq('autoActive parsed', seqState.autoActive, 0x04);
    eq('heldLocks lane 2 = 50', seqState.heldLocks.get(2), 50);
    // Empty hauto clears the map.
    parseStatusForTest('play=0 trk=0 hauto=');
    eq('empty hauto clears heldLocks', seqState.heldLocks.size, 0);
}

/* ── EXT follow: engine ext= status field ────────────────────────────────── */
{
    _log('\nEXT follow status parse:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    eq('extSync defaults false', seqState.extSync, false);
    parseStatusForTest('play=1 bpm=12500 ext=1 trk=0');
    eq('ext=1 sets extSync', seqState.extSync, true);
    parseStatusForTest('play=1 bpm=12500 ext=0 trk=0');
    eq('ext=0 clears extSync', seqState.extSync, false);
}

/* ── Capture: status mirror + the button's two gestures ──────────────────── */
{
    _log('\nCapture button:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { parseStatusForTest, resetSeqEngine, seqEngineTick, peekSeqCmdQueue } =
        await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { resetSeqToast, seqToastActive } = await import('../../dist/esm/seq/render.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetSeqToast();
    seqEngineTick(); // boot probe → ready
    // Commands queue up and flush on the next engine tick, so read the queue.
    const lastOp = () => lastMusicalOp(peekSeqCmdQueue());

    parseStatusForTest('play=0 trk=0 cap=4.7');
    eq('pending count parsed', seqState.capPending, 4);
    eq('overlay generation parsed', seqState.capGen, 7);

    seqHandleMidi([0xB0, 52, 127], false);
    eq('capture commits the buffer', lastOp(), 'cap 0');
    eq('the button claims the event', seqHandleMidi([0xB0, 52, 0], false), true);

    // Clear + Capture throws the buffer away. Not Shift + Capture: schwung's
    // shim claims that combo for skip-back and never forwards it.
    parseStatusForTest('play=0 trk=0 cap=4.8');
    const shiftBefore = peekSeqCmdQueue().length;
    seqHandleMidi([0xB0, 52, 127], true);
    eq('shift+capture is still a plain capture', lastOp(), 'cap 0');
    eq('shift is not a modifier here', peekSeqCmdQueue().length > shiftBefore, true);

    parseStatusForTest('play=0 trk=0 cap=4.9');
    seqHandleMidi([0xB0, 119, 127], false);   // hold Clear
    seqHandleMidi([0xB0, 52, 127], false);    // + Capture
    eq('clear+capture drops the buffer', lastOp(), 'capclr 0');
    seqHandleMidi([0xB0, 119, 0], false);     // release Clear

    // Nothing buffered: say so rather than sending a no-op the engine ignores.
    resetSeqToast();
    parseStatusForTest('play=0 trk=0 cap=0.9');
    const before = peekSeqCmdQueue().length;
    seqHandleMidi([0xB0, 52, 127], false);
    eq('empty buffer sends no command', peekSeqCmdQueue().length, before);
    eq('empty buffer explains itself', seqToastActive(), true);

    // The overlay: the jog applies a candidate as you pass it, and anything
    // else dismisses and releases the take.
    const { setCaptureStateForTest, captureJog, captureDismiss, captureOverlayActive, captureState } =
        await import('../../dist/esm/seq/capture.js');
    setCaptureStateForTest({ overlay: 'select', cands: [85, 120, 170], idx: 1, bpm: 120 });
    captureJog(1);
    eq('jog moves the selection', captureState.idx, 2);
    eq('and applies it at once', lastOp(), 'capsel 2');
    eq('the mirrored tempo follows', captureState.bpm, 170);
    captureJog(1);
    eq('the selection stops at the end', captureState.idx, 2);
    captureJog(-1);
    eq('jog back moves down', lastOp(), 'capsel 1');

    setCaptureStateForTest({ overlay: 'fixed', cands: [], idx: 0, bpm: 120 });
    const fixedOps = peekSeqCmdQueue().length;
    captureJog(1);
    eq('a fixed tempo has nothing to pick', peekSeqCmdQueue().length, fixedOps);

    // What each message means while the overlay is up. The jog touch lands
    // before the first detent, so it must not be a dismissal; the shim's empty
    // packets must not be either.
    const { captureOverlayAction } = await import('../../dist/esm/seq/capture.js');
    eq('jog turn selects',            captureOverlayAction([0xB0, 14, 1]), 'jog');
    eq('jog touch is not a dismiss',  captureOverlayAction([0x90, 9, 127]), 'swallow');
    eq('jog release is not either',   captureOverlayAction([0x80, 9, 0]), 'swallow');
    eq('an empty packet does nothing', captureOverlayAction([0, 0, 0]), 'through');
    eq('a pad press dismisses',       captureOverlayAction([0x90, 70, 110]), 'dismiss');
    eq('a button press dismisses',    captureOverlayAction([0xB0, 85, 127]), 'dismiss');
    eq('a jog click dismisses',       captureOverlayAction([0xB0, 3, 127]), 'dismiss');
    eq('a pad release passes through', captureOverlayAction([0x80, 70, 0]), 'through');

    eq('the overlay is up', captureOverlayActive(), true);
    captureDismiss();
    eq('dismissing releases the take', lastOp(), 'capdone');
    eq('and closes the overlay', captureOverlayActive(), false);

    uninstallMockEngine();
}

/* ── Capture overlay view model ──────────────────────────────────────────── */
{
    _log('\nCapture overlay:');
    const { setCaptureStateForTest, resetCapture } = await import('../../dist/esm/seq/capture.js');
    const { buildCaptureVM } = await import('../../dist/esm/seq/capture-vm.js');

    setCaptureStateForTest({ overlay: 'select', cands: [85, 120, 170], idx: 1, bars: 4 });
    let cvm = buildCaptureVM();
    eq('all candidates offered', cvm.values.join('|'), '85|120|170');
    eq('the applied one is highlighted', cvm.selIdx, 1);
    eq('bar count in the header', cvm.header, '4 BARS');
    eq('one bar reads singular', (setCaptureStateForTest({ overlay: 'select', cands: [120], idx: 0, bars: 1 }),
        buildCaptureVM().header), '1 BAR');

    setCaptureStateForTest({ overlay: 'fixed', cands: [], idx: 0, detected: 117, bpm: 120,
                             why: 'ext', stretchPermille: 26 });
    cvm = buildCaptureVM();
    eq('the reason replaces the bar count', cvm.header, 'EXT SYNC');
    eq('played tempo then set tempo', cvm.values.join('|'), '117|120');
    eq('the set tempo is the highlighted one', cvm.selIdx, 1);
    eq('stretch rounded for the caption', cvm.caption, 'STRETCHED 3% TO FIT');

    setCaptureStateForTest({ overlay: 'fixed', cands: [], idx: 0, detected: 120, bpm: 120,
                             why: 'notes', stretchPermille: 0 });
    eq('an overdub says so', buildCaptureVM().header, 'CLIP HAS NOTES');
    eq('no stretch, no stretch line', buildCaptureVM().caption, 'FITTED TO THE SET TEMPO');
    resetCapture();
}

/* ── Play-link toggle: link= status field + LINK Set-page cell ────────────── */
{
    _log('\nPlay-link toggle:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { buildMainPageVM } = await import('../../dist/esm/seq/main-page-vm.js');
    resetSeqState();
    eq('linkEnabled defaults false', seqState.linkEnabled, false);
    eq('LINK cell shows OFF by default', buildMainPageVM().rows[0][2].displayValue, 'OFF');
    parseStatusForTest('play=0 ext=0 link=1 trk=0');
    eq('link=1 sets linkEnabled', seqState.linkEnabled, true);
    eq('LINK cell shows ON', buildMainPageVM().rows[0][2].displayValue, 'ON');
    parseStatusForTest('play=0 ext=0 link=0 trk=0');
    eq('link=0 clears linkEnabled', seqState.linkEnabled, false);
}

/* ── tempo override: debounced desired-tempo write ───────────────────────── */
{
    _log('\ntempo override: debounced desired-tempo write');
    const { scheduleTempoOverride, tempoOverrideTick } =
        await import('../../dist/esm/seq/tempo-override.js');
    const writes = [];
    globalThis.host_write_file = (p, v) => { writes.push([p, v]); return true; };
    scheduleTempoOverride(12500);
    scheduleTempoOverride(12600);           // knob still turning — supersedes
    for (let i = 0; i < 59; i++) tempoOverrideTick();
    eq('no write during debounce', writes.length, 0);
    tempoOverrideTick();
    eq('single write after debounce', writes.length, 1);
    eq('path', writes[0][0], '/data/UserData/schwung/desired-tempo');
    eq('value is the LAST bpm, 4 decimals', writes[0][1], '126.0000\n');
    delete globalThis.host_write_file;
}

/* ── swing: engine swing status field ────────────────────────────────────── */
{
    _log('\nswing status parse:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=1 bpm=12000 swing=66');
    eq('swing mirrored from status', seqState.swingPct, 66);
}

/* ── play link: the movy→Move half needs a host that can carry the inject ── */
{
    _log('\nplay link capability probe:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');

    /* An old shim has no sentinel at all. Telling the engine so is what stops
     * movy's own CC 85 coming back at it as a Play press — the feedback loop
     * that toggled the transport ~18x/second until movy was closed. */
    delete globalThis.shadow_overtake_move_inject_active;
    let engine = installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqEngineTick();                       // boot probe → engine ready
    eq('no sentinel → minject 0', engine.ops.includes('minject 0'), true);
    uninstallMockEngine();

    globalThis.shadow_overtake_move_inject_active = () => 1;
    engine = installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    eq('sentinel says yes → minject 1', engine.ops.includes('minject 1'), true);

    /* A sentinel that exists but answers 0 is a host that says no. */
    globalThis.shadow_overtake_move_inject_active = () => 0;
    engine = installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    eq('sentinel says no → minject 0', engine.ops.includes('minject 0'), true);

    delete globalThis.shadow_overtake_move_inject_active;
    uninstallMockEngine();
}

/* ── CPU meter fields ────────────────────────────────────────────────────── */
{
    _log('\nseq engine: CPU meter fields');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');

    parseStatusForTest('play=0 chcost=1050/900/1180,0/0/0 chwall=1491/2180/2902 chmask=00ff/0100');
    eq('cpuCost kept raw', seqState.cpuCost, '1050/900/1180,0/0/0');
    eq('cpuWall kept raw', seqState.cpuWall, '1491/2180/2902');
    eq('cpuMask kept raw', seqState.cpuMask, '00ff/0100');

    /* An engine older than the page sends none of them. The previous poll's
     * values must not be left standing as if they were current — that is the
     * meter showing a number nothing measured. */
    parseStatusForTest('play=0');
    eq('a status without the fields clears them', seqState.cpuCost, '');
    eq('all three of them', seqState.cpuWall + seqState.cpuMask, '');
}

}
