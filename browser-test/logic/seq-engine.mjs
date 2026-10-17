/* browser-test/logic/seq-engine.mjs — sequencer engine plumbing: cmd batching, status parsing, Capture, tempo, swing
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    installMockEngine, uninstallMockEngine, seqCmd, seqEngineTick, resetSeqEngine, eq,
    lastMusicalOp, _log, ok,
} from './harness.mjs';

export async function run() {
/* ── seq engine plumbing: cmd batching + the status snapshot (WP10) ──────── */
{
    _log('\nseq engine plumbing:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqCmd, seqEngineTick, resetSeqEngine, engineReady, engineAbsent,
            engineAbsentReason, engineMark, engineCaughtUp, takeNoopSnapId } =
        await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState();

    seqEngineTick(); // boot: one ping, and it matches
    eq('one ping boots the engine', engineReady(), true);
    seqEngineTick(); // the first snapshot is parsed
    eq('the snapshot marks engineOk', seqState.engineOk, true);
    eq('status play=0 parsed', seqState.playing, false);

    /* Boot writes the flags and paths straight out, which is traffic of its
     * own — the coalescing assertions are about the ops a gesture queues. */
    engine.cmdBatches.length = 0; engine.ops.length = 0;

    // Multiple queued ops must flush as ONE batched set_param (coalescing).
    seqCmd('watch 0');
    seqCmd('non 0 60 100');
    seqCmd('nof 0 60');
    seqEngineTick();
    eq('three ops → one set_param call', engine.cmdBatches.length, 1);
    /* movy-host's queue loses nothing, so a batch is sent once, as written:
     * no `#<seq>` resend tag for the engine to dedupe on. */
    eq('the batch is the ops joined with ;, untagged',
        engine.cmdBatches[0], 'watch 0;non 0 60 100;nof 0 60');
    eq('ops parsed on engine side', engine.ops.length, 3);

    // No queued ops → no set_param traffic.
    const before = engine.setParamCalls;
    seqEngineTick();
    eq('idle tick sends no cmd', engine.setParamCalls, before);

    /* Status arrives from the snapshot, not a poll: no `status` get at all. */
    engine.getParamCalls = 0;
    engine.status.play = 1;
    engine.status.tick = 4321;
    engine.status.bpm = 13350;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('play state mirrored', seqState.playing, true);
    eq('engine tick mirrored', seqState.engineTick, 4321);
    eq('bpm mirrored', seqState.bpmX100, 13350);
    eq('and no status was polled for it', engine.getParamCalls, 0);

    /* A snapshot that has not moved is not re-read: the copy is the cost. */
    let reads = 0;
    const realSnap = globalThis.movy_engine_snapshot;
    globalThis.movy_engine_snapshot = () => { reads++; return { ...realSnap(), seq: 7 }; };
    const realSeq = globalThis.movy_engine_snapshot_seq;
    globalThis.movy_engine_snapshot_seq = () => 7;
    for (let i = 0; i < 20; i++) seqEngineTick();
    ok('an unmoved snapshot is read at most once', reads <= 1);
    globalThis.movy_engine_snapshot_seq = realSeq;
    globalThis.movy_engine_snapshot = realSnap;

    // Mock engine serializes arbitrary status keys so tests can inject act=.
    const { activeHasNote } = await import('../../dist/esm/seq/state.js');
    engine.status.act = '38';            // track 0 pitch 38 sounding
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('injected act= populates activeNotes', activeHasNote(0, 38), true);
    delete engine.status.act;

    // Unknown status keys must be ignored (forward compat).
    engine.status.future_key = 42;
    engine.status.tick = 9;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('unknown status key ignored', seqState.engineTick, 9);
    delete engine.status.future_key;

    /* `unop` is reported on every status until the next no-op replaces it
     * (the engine no longer drains it), so the UI acts on a CHANGE, once. */
    while (takeNoopSnapId() >= 0) { /* drain */ }
    engine.status.unop = 5;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('a no-op group is taken once', takeNoopSnapId(), 5);
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('and not again while the engine keeps reporting it', takeNoopSnapId(), -1);
    engine.status.unop = 6;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('the next one is taken', takeNoopSnapId(), 6);
    delete engine.status.unop;

    /* "Has the engine spoken since I asked" is exact: a mark is a point in the
     * request stream, and a snapshot stamped with fewer served requests has
     * not seen it — whatever its zeroes say. */
    engine.holdServed = engine.submitted;
    seqCmd('play');
    seqEngineTick();
    const mark = engineMark();
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('a snapshot from before the request has not caught up', engineCaughtUp(mark), false);
    engine.holdServed = null;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('one stamped after it has', engineCaughtUp(mark), true);

    /* Boot is one question. No answer: the engine did not load, and movy-host
     * never reloads it, so there is nothing to wait for. */
    const dead = installMockEngine();
    dead.pingUnavailable = true;
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    eq('no engine: absent at once', engineAbsent(), true);
    eq('and says it did not answer', engineAbsentReason(), 'silent');
    const pings = dead.getParamCalls;
    for (let i = 0; i < 100; i++) seqEngineTick();
    eq('and is not asked again', dead.getParamCalls, pings);
    eq('engineOk stays false', seqState.engineOk, false);
    seqCmd('play');
    for (let i = 0; i < 5; i++) seqEngineTick();
    eq('nothing is sent to a missing engine', dead.cmdBatches.length, 0);

    /* Another version answered: ui.js and dsp.so from different builds. */
    const odd = installMockEngine();
    odd.pingVersion = '0.0.1';
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    eq('a version mismatch is absent too', engineAbsent(), true);
    eq('named as a mismatch', engineAbsentReason(), 'mismatch');
    eq('no reload is asked for', odd.params.load, undefined);

    uninstallMockEngine();
    resetSeqEngine();
}

/* ── automation: status fields parse into the mirror ─────────────────────── */
{
    _log('\nautomation status parse:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=0 trk=0 alanes=80000005 aauto=80000004 hauto=2:50.31:9');
    eq('autoAssigned parsed', seqState.autoAssigned, 0x80000005);
    eq('autoActive parsed', seqState.autoActive, 0x80000004);
    // D13: lane 31 is the sign bit of the int32 the bit tests run in.
    eq('lane 31 reads as assigned', (seqState.autoAssigned & (1 << 31)) !== 0, true);
    eq('lane 1 does not', (seqState.autoAssigned & (1 << 1)) !== 0, false);
    eq('heldLocks lane 2 = 50', seqState.heldLocks.get(2), 50);
    eq('heldLocks lane 31 = 9', seqState.heldLocks.get(31), 9);
    // Empty hauto clears the map.
    parseStatusForTest('play=0 trk=0 hauto=');
    eq('empty hauto clears heldLocks', seqState.heldLocks.size, 0);
}

/* ── sapl: an APPLIED Set re-arms the automation label sync ──────────────── */
{
    _log('\napplied-set label sync:');
    const { parseStatusForTest, resetSeqEngine, takeLabelSync, requestLabelSync } =
        await import('../../dist/esm/seq/engine.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqEngine(); resetSeqState();

    /* THE BUG, at the level that reproduces it. `openSet` arms the sync when it
     * ASKS the engine to open, and the engine applies the bytes on another
     * thread hundreds of ms later — so the one shot was routinely spent reading
     * the outgoing Set's labels, and the registry stayed empty for the session
     * (device evidence: two `auto sync labels="-.-.-…"` reads, both before
     * `seq: set ready`, and no lanes afterwards). */
    requestLabelSync();
    eq('the open-time request is still one-shot', takeLabelSync(), true);
    eq('and spending it leaves nothing armed', takeLabelSync(), false);

    /* The fix: the engine counts the Sets it has APPLIED, and the first value
     * counts — the engine may have been holding this Set since before movy
     * launched, and the UI's registry starts empty either way. */
    parseStatusForTest('play=0 trk=0 sapl=7');
    eq('the first sapl arms a sync', takeLabelSync(), true);
    /* An unchanged counter is not an event: re-syncing every poll would re-issue
     * a lane mapping write per assigned lane, forever. */
    parseStatusForTest('play=0 trk=0 sapl=7');
    eq('an unchanged sapl arms nothing', takeLabelSync(), false);
    /* And the case the device test caught: the Set landed AFTER the open-time
     * shot was spent. */
    parseStatusForTest('play=0 trk=0 sapl=8');
    eq('an applied Set arms a sync after the fact', takeLabelSync(), true);

    /* A re-dlopened engine starts counting again, so its first value must read
     * as an applied Set rather than as a counter going backwards. */
    resetSeqEngine();
    parseStatusForTest('play=0 trk=0 sapl=0');
    eq('a rebooted engine arms a sync too', takeLabelSync(), true);
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
    // A capinfo read that does not get through must not spend the generation.
    // It did: the gen was marked seen BEFORE the read, so one dropped get lost
    // that commit's overlay for good — seen on device as a fitted take the
    // engine reported and movy never showed, under param IPC contention.
    {
        const { captureTick, resetCapture } = await import('../../dist/esm/seq/capture.js');
        resetCapture();
        const realGet = globalThis.host_module_get_param;
        let capinfo = null;
        globalThis.host_module_get_param = (k) => (k === 'capinfo' ? capinfo : realGet(k));
        parseStatusForTest('play=0 trk=0 cap=0.20');
        captureTick();
        eq('a dropped capinfo read leaves the overlay closed', captureState.overlay, 'none');
        capinfo = 'mode=fix bpm=102 why=notes bars=2 stretch=133';
        captureTick();
        eq('the next tick re-reads the same generation and opens it', captureState.overlay, 'fixed');
        eq('with the engine\'s reason', captureState.why, 'notes');
        globalThis.host_module_get_param = realGet;
        resetCapture();
    }

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

/* ── swing: engine swing status field ────────────────────────────────────── */
{
    _log('\nswing status parse:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=1 bpm=12000 swing=66');
    eq('swing mirrored from status', seqState.swingPct, 66);
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

/* ── seq: a Play press against a "playing" mirror claims the event and
 * queues `stop` — plans/2026-09-12-test-device-migration-followups.md item 6's
 * cheapest-path step 1. `seq: play=0` in the log fires only from inside
 * `parseStatus`, so "no play=0 line appeared" on device is the SAME fact as
 * "play= stayed 1", not independent evidence the press never reached the
 * router. This pins the UI half of that chain forever, with no device: the
 * router-side logic is not what the failing legs could be blaming. */
{
    _log('\nseq: Play press against a playing mirror:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { CC_PLAY } = await import('../../dist/esm/seq/constants.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqEngineTick(); seqEngineTick();   // boot probe → ready, first poll
    engine.ops.length = 0;

    seqState.playing = true;   // the mirror already believes the transport runs
    const claimed = seqHandleMidi([0xB0, CC_PLAY, 127], false);
    eq('a Play press against a playing mirror is claimed', claimed, true);
    eq('and the mirror flips to stopped optimistically', seqState.playing, false);
    seqEngineTick();
    eq('and `stop` is queued for the engine', engine.ops.includes('stop'), true);

    resetSeqEngine(); resetSeqState(); uninstallMockEngine();
}

}
