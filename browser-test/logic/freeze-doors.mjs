/* browser-test/logic/freeze-doors.mjs — every door into a frozen or freezing
 * track, through the real router (PR #30's review): the capture swallowing
 * presses and darkening every LED but Back (knob rings included), the clip
 * page, the MIX slot, the master's browser, the external keyboard, solo,
 * per-voice mutes, and the engine's own refusals (`frzr`).
 *
 * The engine refuses the edits whatever the UI does (seq-core
 * engine/freeze_lock.rs, cargo-tested); these pin the UI's half: what is
 * swallowed, what is said, and what still works.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    _log('\nfreeze: the doors');
    const { installMockFs, uninstallMockFs } = await import('../mock-fs.mjs');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { sessionTick, resetSetSession, sessionReady } = await import('../../dist/esm/seq/set-session.js');
    const { appState, VIEW_CLIP_PARAMS, VIEW_BROWSE, VIEW_CHAIN } = await import('../../dist/esm/app/state.js');
    const { selectTrack } = await import('../../dist/esm/track/focus.js');
    const { seqToastText, resetSeqToast } = await import('../../dist/esm/seq/render.js');
    const fz = await import('../../dist/esm/seq/freeze.js');
    const busy = await import('../../dist/esm/seq/freeze-busy.js');
    const { onMidiMessageExternal } = await import('../../dist/esm/midi/external.js');
    const { padMuteGesture } = await import('../../dist/esm/mixer/pad-mutes.js');
    const { MIX_CHAIN_INDEX } = await import('../../dist/esm/chain/config.js');
    await import('../../dist/esm/app/globals.js');
    const midi = globalThis.onMidiMessageInternal;

    installMockFs({});
    const eng = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetSetSession(); fz.resetFreeze();
    const run = (n = 1) => { for (let i = 0; i < n; i++) { seqEngineTick(); sessionTick(); } };
    run(200);
    ok('the session is live', sessionReady());
    selectTrack(2);
    run(2);
    const ops = () => { run(); const o = eng.ops.slice(); eng.ops.length = 0; return o; };
    ops();

    /* ── a capture owns the device ─────────────────────────────────────── */
    fz.freezeConfirm(2, false, 'Surge', 10_000);
    ok('busy from the confirm, before the status shows it', fz.freezeBusy(10_000));
    eq('the toast is up at once', seqToastText(), 'FREEZING T3 0%');
    eq('and nobody answering frees it', fz.freezeBusy(14_000), false);
    fz.freezeStatusField('frzc', '2:30');
    ok('a capture is busy', fz.freezeBusy(Date.now()));
    eq('a press is swallowed', busy.freezeSwallows([0xB0, 85, 127]), true);
    eq('a pad too', busy.freezeSwallows([0x90, 70, 100]), true);
    eq('a knob turn too', busy.freezeSwallows([0xB0, 71, 1]), true);
    eq('aftertouch too', busy.freezeSwallows([0xA0, 70, 40]), true);
    eq('a release passes', busy.freezeSwallows([0x80, 70, 0]), false);
    eq('a note-on at zero is a release', busy.freezeSwallows([0x90, 70, 0]), false);
    eq('a button up passes', busy.freezeSwallows([0xB0, 85, 0]), false);
    eq('Back passes', busy.freezeSwallows([0xB0, globalThis.MoveBack, 127]), false);
    /* Reviewed on device: Play during a capture cancelled it, three times in a row. */
    seqState.playing = true;
    midi([0xB0, 85, 127]); midi([0xB0, 85, 0]);
    ok('Play reaches nothing', !ops().some((o) => o === 'play' || o === 'stop'));
    midi([0x90, 16, 100]); midi([0x80, 16, 0]);
    ok('a step press edits nothing', !ops().some((o) => o.startsWith('tog')));
    /* Reviewed: the external keyboard was not blocked during a capture. */
    selectTrack(0); ops();
    onMidiMessageExternal([0x90, 60, 100]); onMidiMessageExternal([0x80, 60, 0]);
    ok('a key on another track records nothing while a capture runs', !ops().some((o) => o.startsWith('non ')));
    selectTrack(2); ops();
    fz.freezeStatusField('frzc', '2:40');
    fz.freezeBusyToast();
    eq('the toast follows the progress', seqToastText(), 'FREEZING T3 40%');
    eng.params.frzx = undefined;
    midi([0xB0, globalThis.MoveBack, 127]);
    eq('Back cancels the capture', eng.params.frzx, '2');
    fz.freezeStatusField('frzc', '-');
    fz.freezeStatusField('frze', '1:2:asked');
    ok('and the device is the user\'s again', !fz.freezeBusy(Date.now()));
    seqState.playing = false;

    /* LEDs: everything movy lit goes dark, Back stays lit. */
    {
        const { ledFrameReset, cachedSetButtonLED } = await import('../../dist/esm/seq/led-cache.js');
        const lit = new Map();
        const savedB = globalThis.setButtonLED, savedL = globalThis.setLED;
        globalThis.setButtonLED = (cc, c) => lit.set('b' + cc, c);
        globalThis.setLED = (n, c) => lit.set('n' + n, c);
        ledFrameReset();
        cachedSetButtonLED(85, 127);   // Play, lit before the capture
        cachedSetButtonLED(54, 127);   // an octave arrow
        for (let f = 0; f < 6; f++) { ledFrameReset(); busy.freezeBusyLeds(); }
        eq('Play dark', lit.get('b85'), 0);
        eq('the octave arrow dark', lit.get('b54'), 0);
        ok('Back lit', lit.get('b' + globalThis.MoveBack) > 0);
        eq('the steps dark', [16, 23, 31].map((n) => lit.get('n' + n)).join(','), '0,0,0');
        eq('the pads dark', [68, 85, 99].map((n) => lit.get('n' + n)).join(','), '0,0,0');
        busy.freezeBusyEnd();
        globalThis.setButtonLED = savedB; globalThis.setLED = savedL;
    }

    /* The knob rings too, through the real tick (app/tick.ts's busy branch). */
    {
        const { ledFrameReset } = await import('../../dist/esm/seq/led-cache.js');
        const { updateKnobLEDsFrom, resetKnobLedCache } = await import('../../dist/esm/renderer/knob-leds.js');
        const lit = new Map();
        const savedB = globalThis.setButtonLED, savedL = globalThis.setLED;
        globalThis.setButtonLED = (cc, c) => lit.set('b' + cc, c);
        globalThis.setLED = (n, c) => lit.set('n' + n, c);
        ledFrameReset();
        updateKnobLEDsFrom([1, 1, 1, 1, 1, 1, 1, 1]);   // a page's rings, lit
        ok('the rings start lit', lit.get('b71') > 0 && lit.get('n0') > 0);
        fz.freezeConfirm(2, false, 'Surge', Date.now());
        for (let f = 0; f < 4; f++) globalThis.tick();
        eq('the knob rings dark during a capture', [71, 74, 78].map((cc) => lit.get('b' + cc)).join(','), '0,0,0');
        eq('the knob touch LEDs dark too', [0, 3, 7].map((n) => lit.get('n' + n)).join(','), '0,0,0');
        fz.freezeCancelCapture();
        fz.freezeStatusField('frze', '5:2:asked');
        globalThis.tick();
        globalThis.setButtonLED = savedB; globalThis.setLED = savedL;
        ledFrameReset(); resetKnobLedCache();   // the suites after start from a cold frame
        ops();
    }

    /* ── a frozen track ────────────────────────────────────────────────── */
    fz.freezeStatusField('frz', '4');   // T3
    ops();

    /* Reviewed: solo is the other tracks' mutes, which a loop never heard.
     * The engine's mute now silences the loop (freeze_bank.rs, cargo); solo
     * reaches it through that same mute. */
    {
        const { toggleSolo, resetTrackMutes } = await import('../../dist/esm/mixer/track-mutes.js');
        resetTrackMutes(); ops();
        toggleSolo(0);
        ok('soloing T1 mutes the frozen T3 in the engine', ops().some((o) => o === 'mute 2 1'));
        toggleSolo(0);
        ok('and the unsolo unmutes it', ops().some((o) => o === 'mute 2 0'));
        resetTrackMutes(); ops();
    }

    /* Reviewed: clipPageActive() returned before the guard. */
    appState.currentView = VIEW_CLIP_PARAMS;
    resetSeqToast();
    midi([0x90, 0, 127]);   // a finger on knob 1, before any turn
    eq('a touch on the clip page already says why', seqToastText(), 'UNFREEZE T3 FIRST');
    midi([0x80, 0, 0]);
    resetSeqToast();
    for (let k = 71; k <= 74; k++) midi([0xB0, k, 1]);
    ok('the clip page edits nothing', !ops().some((o) => /^(cscl|clen|ctr|cq) /.test(o)));
    eq('and says why', seqToastText(), 'UNFREEZE T3 FIRST');

    /* Reviewed: the MIX page of a frozen track was unreachable. */
    appState.currentView = VIEW_CHAIN;
    appState.trackChainIndex[2] = MIX_CHAIN_INDEX;
    resetSeqToast();
    midi([0xB0, 71, 1]);
    ok('the MIX slot is not refused', seqToastText() !== 'UNFREEZE T3 FIRST');
    appState.trackChainIndex[2] = 1;
    resetSeqToast();
    midi([0xB0, 71, 1]);
    eq('the synth slot is', seqToastText(), 'UNFREEZE T3 FIRST');

    /* Reviewed: a send FX could not be added while a frozen track was focused.
     * The same click on the same synth slot: refused on the track's chain,
     * the master's own in Session mode. The clip page's knob turns above
     * left the quantize overlay up, and it takes the click. */
    (await import('../../dist/esm/seq/quant-overlay.js')).resetQuantOverlay();
    selectTrack(2);
    appState.trackChainIndex[2] = 1;
    appState.currentView = VIEW_BROWSE;
    resetSeqToast();
    midi([0xB0, globalThis.MoveMainButton, 127]);
    eq('the browser on the frozen track\'s chain says why', seqToastText(), 'UNFREEZE T3 FIRST');
    seqState.sessionMode = true;
    appState.currentView = VIEW_BROWSE;
    resetSeqToast();
    midi([0xB0, globalThis.MoveMainButton, 127]);
    ok('the master\'s browser picks', seqToastText() !== 'UNFREEZE T3 FIRST');
    seqState.sessionMode = false;
    appState.currentView = VIEW_CHAIN;

    /* Reviewed: the keyboard bypassed the pad guard. */
    resetSeqToast();
    onMidiMessageExternal([0x90, 60, 100]); onMidiMessageExternal([0x80, 60, 0]);
    ok('a key records nothing', !ops().some((o) => o.startsWith('non ')));
    eq('and says why', seqToastText(), 'UNFREEZE T3 FIRST');

    /* Reviewed: Mute + pad toggled voice mutes the loop cannot honour. */
    padMuteGesture(2, 36, false);
    padMuteGesture(2, 36, true);
    ok('no voice mute or solo', !ops().some((o) => /^p(mute|solo) /.test(o)));

    /* The engine's word, whatever the door. */
    resetSeqToast();
    fz.freezeStatusField('frzr', '3:2');
    ok('first sight says nothing', seqToastText() === '');
    fz.freezeStatusField('frzr', '4:5');
    eq('a refusal the engine made is said', seqToastText(), 'UNFREEZE T6 FIRST');
    fz.freezeStatusField('frze', '2:4:muted');
    eq('a muted track is not frozen', seqToastText(), 'UNMUTE T5 TO FREEZE IT');
    fz.freezeStatusField('frze', '3:4:long');
    eq('nor a loop over the cap', seqToastText(), 'T5: LOOP OVER 60 S');
    fz.freezeStatusField('frze', '4:4:mem');
    eq('nor past the memory budget', seqToastText(), 'FREEZE: MEMORY FULL');

    fz.resetFreeze();
    resetSeqToast();
    uninstallMockEngine(); uninstallMockFs();
    resetSeqEngine(); resetSeqState(); resetSetSession();
}
