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

    fz.freezeStatusField('frzc', '2:0/3:45:0:0');
    eq('capturing T3', fz.freezeCapturing(), 2);
    ok('progress: which clip of how many, in steps of 10', seqToastActive() && seqToastText() === 'FREEZING T3 1/3 40%');
    const { seqToastVersion } = await import('../../dist/esm/seq/render.js');
    const v0 = seqToastVersion();
    fz.freezeStatusField('frzc', '2:0/3:49');
    eq('inside the same step: no new toast, no repaint', seqToastVersion(), v0);
    fz.freezeStatusField('frzc', '2:0/3:51');
    ok('the next step is a new toast version (tick.ts repaints on it)', seqToastVersion() === v0 + 1);
    eq('the toast says it', seqToastText(), 'FREEZING T3 1/3 50%');
    fz.freezeStatusField('frzc', '2:1/3:0');
    eq('the next clip', seqToastText(), 'FREEZING T3 2/3 0%');
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
    const ftoast = await import('../../dist/esm/seq/freeze-toast.js');
    ftoast.resetFreezeToast();
    eq('an unfrozen track passes', fz.freezeGuard(0), false);
    eq('no toast for it', ftoast.freezeToastTrack(), -1);
    eq('a frozen one is refused', fz.freezeGuard(3), true);
    eq('with the big toast naming it', ftoast.freezeToastTrack(), 3);
    eq('for about a second and a half', ftoast.freezeToastTrack(Date.now() + 1600), -1);
    ftoast.resetFreezeToast();
    fz.freezeStatusField('frzr', '4:3');
    eq('an engine refusal first seen says nothing', ftoast.freezeToastTrack(), -1);
    fz.freezeStatusField('frzr', '5:3');
    eq('a new engine refusal shows the big toast', ftoast.freezeToastTrack(), 3);
    eq('there is no double tap any more', fz.freezeTrackTap, undefined);

    _log('\nfreeze: the track menu (Shift + track)');
    const menu = await import('../../dist/esm/seq/track-menu.js');
    const transport = (await import('../../dist/esm/seq/state.js')).seqState;
    writes.length = 0;
    menu.openTrackMenu(2);
    eq('open for T3', menu.trackMenuTrack(), 2);
    let vm = menu.buildTrackMenuVM();
    eq('one row: FREEZE T3', vm.rows.map(r => r.name).join('|'), 'FREEZE T3');
    eq('the hint says what it does', vm.hint, 'Records every clip. Saves CPU.');
    menu.trackMenuClick('Surge');
    eq('a click freezes it', writes.join(' '), 'frz=2');
    eq('and closes the menu', menu.trackMenuActive(), false);
    fz.resetFreeze();
    fz.freezeStatusField('frz', '8');            // T4 frozen
    writes.length = 0;
    menu.openTrackMenu(3);
    eq('a frozen track offers UNFREEZE', menu.buildTrackMenuVM().rows[0].name, 'UNFREEZE T4');
    transport.playing = false;
    menu.trackMenuClick('');
    eq('stopped: one click unfreezes', writes.join(' '), 'unfrz=3');
    writes.length = 0;
    transport.playing = true;
    menu.openTrackMenu(3);
    menu.trackMenuClick('');
    eq('playing: the first click only arms', writes.length, 0);
    eq('and asks', menu.buildTrackMenuVM().rows[0].value, 'CONFIRM?');
    eq('saying play stops', menu.buildTrackMenuVM().hint, 'Click again: play stops, the synth comes back.');
    menu.trackMenuClick('');
    eq('the second unfreezes', writes.join(' '), 'unfrz=3');
    menu.openTrackMenu(3);
    menu.trackMenuClick('');
    transport.playing = false;
    eq('Stop meanwhile: the arm is gone', menu.buildTrackMenuVM().rows[0].value, '>');
    menu.closeTrackMenu();
    transport.playing = false;
    fz.resetFreeze();

    _log('\nfreeze: the waveform shows only the playable part, on the strip\'s bars');
    {
        const vmMod = await import('../../dist/esm/seq/frozen-view-vm.js');
        const { buildFrozenViewVM, buildFreezingViewVM, frozenPlayX, freezingPlayX, WAVE_COLS } = vmMod;
        const { stripPlayheadX } = await import('../../dist/esm/seq/loop-strip.js');
        const { resetFreezeWave } = await import('../../dist/esm/seq/freeze-wave.js');
        const st = (await import('../../dist/esm/seq/state.js')).seqState;
        const savedGet = globalThis.host_module_get_param;
        const asked = [];
        // Recorded over steps 0-15: quiet first half, loud second half.
        globalThis.host_module_get_param = (k) => {
            asked.push(k);
            return k === 'frzpk_3_0' ? '0 16 ' + '10'.repeat(128) + 'f0'.repeat(128) : null;
        };
        resetFreezeWave();
        fz.freezeStatusField('frz', '8');
        fz.freezeStatusField('frzp', '1');
        st.session[3] = { exist: 1, playing: 0, queued: -1, selected: 0 };
        st.loopStart = 0; st.lenSteps = 16; st.barOffset = 0; st.playing = false;
        let vm = buildFrozenViewVM(3, 1, 6);
        eq('the whole recording: quiet then loud', [vm.cols[0], vm.cols[WAVE_COLS - 1]].join(','), '16,240');
        eq('stopped: no playhead', frozenPlayX(3), -1);
        globalThis.host_module_get_param = (k) => k === 'frzpk_3_0' ? '0 16 ' + '00'.repeat(256) : null;
        fz.freezeStatusField('frzp', '9');
        vm = buildFrozenViewVM(3, 1, 6);
        ok('a silent frozen clip is a line across it', vm.cols.every((c) => c === 0)
            && vmMod.waveSpans(vm, 5).length === 1);
        globalThis.host_module_get_param = (k) => {
            asked.push(k);
            return k === 'frzpk_3_0' ? '0 16 ' + '10'.repeat(128) + 'f0'.repeat(128) : null;
        };
        asked.length = 0;
        fz.freezeStatusField('frzp', '1');
        st.loopStart = 8; st.lenSteps = 8;
        vm = buildFrozenViewVM(3, 1, 6);
        ok('a Loop-mode cut shows only the part that plays', vm.cols.slice(0, 64).every((c) => c === -1));
        ok('where the strip has it', vm.cols.slice(64).every((c) => c === 240));
        st.playing = true; st.posTick = (8 + 4) * 24;
        eq('the playhead IS the strip\'s', frozenPlayX(3), stripPlayheadX());
        ok('over the audio it plays', vm.cols[frozenPlayX(3)] === 240);
        st.session[3] = { exist: 3, playing: 1, queued: -1, selected: 0 };
        eq('another clip playing: no playhead on this one', frozenPlayX(3), -1);
        eq('fetched once, not per frame', asked.filter((k) => k === 'frzpk_3_0').length, 1);
        fz.freezeStatusField('frzp', '2');
        buildFrozenViewVM(3, 1, 6);
        eq('a new waveform is fetched again', asked.filter((k) => k === 'frzpk_3_0').length, 2);
        st.session[3] = { exist: 0, playing: -1, queued: -1, selected: 0 };
        eq('an empty slot says so', buildFrozenViewVM(3, 1, 6).empty, true);

        // While it records: the clip being recorded, across the width, growing.
        globalThis.host_module_get_param = (k) => k === 'frzpk_3_2' ? '0 16 ' + 'ff'.repeat(64) + '00'.repeat(192) : null;
        fz.freezeStatusField('frzc', '3:1/3:30:2:250');
        fz.freezeStatusField('frzp', '3');
        vm = buildFreezingViewVM(3, 1, 6);
        ok('the recorded quarter is drawn, the rest not yet', vm.cols[10] === 255 && vm.cols[100] === -1);
        eq('nothing yet: no line', vmMod.waveSpans(vm, 100).length, 0);
        fz.freezeStatusField('frzc', '3:1/3:30:2:500');
        vm = buildFreezingViewVM(3, 1, 6);
        eq('recorded silence is a flat line', JSON.stringify(vmMod.waveSpans(vm, 40)),
            JSON.stringify([[(vmMod.WAVE_TOP + vmMod.WAVE_BOT) >> 1, 1]]));
        fz.freezeStatusField('frzc', '3:1/3:30:2:250');
        eq('it says FREEZING', vm.recording, true);
        eq('the playhead is where the capture writes', freezingPlayX(), 32);
        fz.freezeStatusField('frzc', '-');
        st.playing = false; st.loopStart = 0; st.lenSteps = 0; st.posTick = 0;
        globalThis.host_module_get_param = savedGet;
        resetFreezeWave();
        fz.resetFreeze();
    }

    _log('\nfreeze: what reaches the engine');
    writes.length = 0;
    fz.freezeConfirm(2, false);
    fz.freezeConfirm(3, true);
    eq('frz / unfrz <track>', writes.join(' '), 'frz=2 unfrz=3');
    writes.length = 0;
    eq('Back right after a confirm cancels it, before the status shows it', fz.freezeCancelCapture(), true);
    eq('frzx <the confirmed track>', writes.join(' '), 'frzx=2');
    writes.length = 0;
    eq('Back with no capture does nothing', fz.freezeCancelCapture(), false);
    fz.freezeStatusField('frzc', '6:0/1:10');
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
    const { frozenPadColor } = await import('../../dist/esm/seq/freeze-pads.js');
    /* The pads spell FREEZING while it records (FROZEN would say it is done). */
    const { FREEZE_PAD_TEXT } = await import('../../dist/esm/seq/freeze-pads.js');
    eq('the pads say FREEZING', FREEZE_PAD_TEXT.trim(), 'FREEZING');
    // t = 0: the "F" sits in columns 0-2. Top row (pads 24-31) reads 111.
    eq('F top bar', [24, 25, 26].map(i => frozenPadColor(i, 0)).every(c => c === C_WHITE), true);
    eq('the gap column is ice', frozenPadColor(27, 0), ICE);
    // Second row from the top (pads 16-23): F is 100.
    eq('F stem', [frozenPadColor(16, 0), frozenPadColor(17, 0)].join(','), [C_WHITE, ICE].join(','));
    // One step later everything has moved one column left.
    eq('it scrolls', frozenPadColor(24, 220), frozenPadColor(25, 0));
    ok('only white and ice', Array.from({ length: 32 }, (_, i) => frozenPadColor(i, 1234))
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
