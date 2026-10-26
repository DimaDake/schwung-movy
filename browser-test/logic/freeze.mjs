/* browser-test/logic/freeze.mjs — Freeze's UI half (src/seq/freeze.ts):
 * the status fields, the Shift + double-tap gesture, the dialog, the guard,
 * and what reaches the engine. The engine half is movy-dsp's cargo tests.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    const fz = await import('../../dist/esm/seq/freeze.js');
    const { seqToastText, seqToastActive } = await import('../../dist/esm/seq/render.js');
    const modal = await import('../../dist/esm/app/leave-modal.js');

    /* The engine channel, swapped in and back out (as host-param.mjs does). */
    const savedSet = globalThis.host_module_set_param;
    const writes = [];
    globalThis.host_module_set_param = (k, v) => { writes.push(k + '=' + v); return true; };

    _log('\nfreeze: status fields');
    fz.resetFreeze();
    fz.freezeStatusField('frz', '-');
    fz.freezeStatusField('frz', '0');
    eq('nothing frozen', fz.isFrozen(3), false);
    fz.freezeStatusField('frz', '18'); // hex: tracks 4 and 5 (index 3, 4)
    eq('mask is hex: T4 frozen', fz.isFrozen(3), true);
    eq('mask is hex: T5 frozen', fz.isFrozen(4), true);
    eq('T1 not', fz.isFrozen(0), false);
    eq('a negative track is never frozen', fz.isFrozen(-1), false);

    fz.freezeStatusField('frzc', '2:45');
    eq('capturing T3', fz.freezeCapturing(), 2);
    ok('progress is shown, in steps of 10', seqToastActive() && seqToastText() === 'FREEZING T3 40%');
    const { seqToastVersion } = await import('../../dist/esm/seq/render.js');
    const v0 = seqToastVersion();
    fz.freezeStatusField('frzc', '2:49');
    eq('inside the same step: no new toast, no repaint', seqToastVersion(), v0);
    fz.freezeStatusField('frzc', '2:51');
    ok('the next step is a new toast version (tick.ts repaints on it)', seqToastVersion() === v0 + 1);
    eq('the toast says it', seqToastText(), 'FREEZING T3 50%');
    fz.freezeStatusField('frzc', '2:52');
    eq('more of the same step is not', seqToastVersion(), v0 + 1);
    fz.freezeStatusField('frzc', '-');
    eq('no capture', fz.freezeCapturing(), -1);

    _log('\nfreeze: events are news only once seen');
    fz.freezeStatusField('frze', '7:2:frozen'); // the first status after boot
    ok('an old event says nothing', seqToastText() !== 'T3 FROZEN');
    fz.freezeStatusField('frze', '8:2:frozen');
    eq('a new one does', seqToastText(), 'T3 FROZEN');
    fz.freezeStatusField('frze', '8:2:frozen');
    fz.freezeStatusField('frze', '9:5:notplaying');
    eq('a refusal says why', seqToastText(), "LAUNCH T6'S CLIP FIRST");
    fz.freezeStatusField('frze', '10:5:stopped');
    eq('a cancel', seqToastText(), 'FREEZE CANCELLED');

    _log('\nfreeze: the guard');
    eq('an unfrozen track passes', fz.freezeGuard(0), false);
    eq('a frozen one is refused', fz.freezeGuard(3), true);
    eq('and told why', seqToastText(), 'UNFREEZE T4 FIRST');

    _log('\nfreeze: Shift + double tap');
    fz.resetFreeze();
    eq('first tap is an ordinary press', fz.freezeTrackTap(2, 1000), false);
    eq('second within 450 ms opens the dialog', fz.freezeTrackTap(2, 1300), true);
    eq('a third does not chain on', fz.freezeTrackTap(2, 1400), false);
    eq('too slow is two single taps', fz.freezeTrackTap(2, 2000), false);
    eq('another track does not count', fz.freezeTrackTap(5, 2100), false);

    _log('\nfreeze: the dialog');
    modal.openFreezeModal(2, false);
    eq('title', modal.leaveModalTitle(), 'Freeze T3?');
    eq('options, Freeze first (the default)', modal.leaveModalLabels().join('|'), 'Freeze|Cancel');
    eq('confirm', modal.leaveModalConfirm(), 'freeze');
    eq('the track rides the state', modal.leaveModalState.track, 2);
    modal.openFreezeModal(3, true);
    eq('a frozen track asks to unfreeze', modal.leaveModalTitle(), 'Unfreeze T4?');
    eq('stopped: no note', modal.leaveModalNote(), '');
    modal.leaveModalMove(1);
    eq('Cancel is one jog step away', modal.leaveModalConfirm(), 'cancel');

    _log('\nfreeze: unfreeze while playing warns that playback stops');
    const transport = (await import('../../dist/esm/seq/state.js')).seqState;
    transport.playing = true;
    modal.openFreezeModal(3, true);
    eq('same title', modal.leaveModalTitle(), 'Unfreeze T4?');
    eq('the note says playback stops', modal.leaveModalNote(), 'Playback will stop');
    eq('a yes/no question', modal.leaveModalLabels().join('|'), 'Yes|No');
    eq('Yes (the default) unfreezes', modal.leaveModalConfirm(), 'unfreeze');
    modal.openFreezeModal(3, true);
    modal.leaveModalMove(1);
    eq('No cancels', modal.leaveModalConfirm(), 'cancel');
    modal.openFreezeModal(2, false);
    eq('a freeze while playing does not stop: no note', modal.leaveModalNote(), '');
    eq('and keeps its options', modal.leaveModalLabels().join('|'), 'Freeze|Cancel');
    modal.closeLeaveModal('test');
    modal.openFreezeModal(3, true);
    transport.playing = false;
    eq('Stop pressed with the dialog up: the note goes', modal.leaveModalNote(), '');
    eq('and the options are the plain ones', modal.leaveModalLabels().join('|'), 'Unfreeze|Cancel');
    modal.closeLeaveModal('test');
    modal.openLeaveModal();
    eq('the leave menu is unchanged', modal.leaveModalTitle(), 'Leave Movy?');
    modal.closeLeaveModal('test');

    _log('\nfreeze: what reaches the engine');
    writes.length = 0;
    fz.freezeConfirm(2, false);
    fz.freezeConfirm(3, true);
    eq('frz / unfrz <track>', writes.join(' '), 'frz=2 unfrz=3');
    writes.length = 0;
    eq('Back with no capture does nothing', fz.freezeCancelCapture(), false);
    fz.freezeStatusField('frzc', '6:10');
    eq('Back during a capture cancels it', fz.freezeCancelCapture(), true);
    eq('frzx <track>', writes.join(' '), 'frzx=6');

    _log('\nfreeze: the synth it was, and the pads');
    fz.resetFreeze();
    fz.freezeConfirm(4, false, 'Surge');
    eq('the name taken at confirm', fz.frozenName(4), 'Surge');
    eq('unknown elsewhere', fz.frozenName(5), '');
    fz.freezeStatusField('frz', '20');
    fz.freezeStatusField('frzm', '5:surge');
    eq('after a reboot: the engine\'s module id', fz.frozenName(5), 'SURGE');
    eq('the confirmed name still wins', fz.frozenName(4), 'Surge');
    fz.freezeStatusField('frz', '0');
    eq('nothing frozen, no stale id', fz.frozenName(5), '');
    const { C_WHITE, TRACK_COLOR } = await import('../../dist/esm/seq/colors.js');
    const ICE = TRACK_COLOR[2];
    // t = 0: the "F" sits in columns 0-2. Top row (pads 24-31) reads 111.
    eq('F top bar', [24, 25, 26].map(i => fz.frozenPadColor(i, 0)).every(c => c === C_WHITE), true);
    eq('the gap column is ice', fz.frozenPadColor(27, 0), ICE);
    // Second row from the top (pads 16-23): F is 100.
    eq('F stem', [fz.frozenPadColor(16, 0), fz.frozenPadColor(17, 0)].join(','), [C_WHITE, ICE].join(','));
    // One step later everything has moved one column left.
    eq('it scrolls', fz.frozenPadColor(24, 220), fz.frozenPadColor(25, 0));
    ok('only white and ice', Array.from({ length: 32 }, (_, i) => fz.frozenPadColor(i, 1234))
        .every(c => c === C_WHITE || c === ICE));

    _log('\nfreeze: the CPU page');
    const { buildCpuPageVM } = await import('../../dist/esm/seq/cpu-page-vm.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');
    const saved ={ c: seqState.cpuCost, m: seqState.cpuMask };
    seqState.cpuCost = Array.from({ length: 16 }, (_, i) => (i === 3 ? '2/2/3' : '0/0/0')).join(',');
    seqState.cpuMask = '0009/0000';    // tracks 1 and 4 loaded
    fz.freezeStatusField('frz', '8');  // track 4 frozen
    const cols = buildCpuPageVM().columns;
    eq('a frozen track has its own kind', cols[3].kind, 'frozen');
    eq('with its real (tiny) cost', cols[3].totalUs, 2);
    eq('a live one is unchanged', cols[0].kind, 'live');
    seqState.cpuCost = saved.c; seqState.cpuMask = saved.m;

    fz.resetFreeze();
    globalThis.host_module_set_param = savedSet;
}
