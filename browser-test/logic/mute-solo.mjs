/* browser-test/logic/mute-solo.mjs — mute + solo gestures, the mute mirror, momentary holds, peek revert
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    trackRef, TRACK_COUNT, installMockEngine, uninstallMockEngine, resetSeqEngine, appState,
    eq, _log,
} from './harness.mjs';

export async function run() {
/* ── mute gesture ────────────────────────────────────────────────────────── */
{
    _log('\nmute gesture:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { muteTrack, setMuteHeld, muteHeld } = await import('../../dist/esm/seq/router.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { peekSeqCmdQueue, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();

    setMuteHeld(true);
    eq('mute held', muteHeld(), true);
    resetSeqEngine();
    seqState.muted[2] = false;
    muteTrack(2);
    eq('queues mute on', peekSeqCmdQueue().some(c => c === 'mute 2 1'), true);
    resetSeqEngine();
    seqState.muted[2] = true;
    muteTrack(2);
    eq('queues mute off', peekSeqCmdQueue().some(c => c === 'mute 2 0'), true);
    setMuteHeld(false);

    uninstallMockEngine();
}

/* ── mute tap: Track view tap mutes the active track ─────────────────────── */
{
    _log('\nmute tap:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetMomentary } = await import('../../dist/esm/seq/momentary.js');
    const { appState } = await import('../../dist/esm/app/state.js');

    const CC_MUTE = 88;
    installMockEngine();
    resetSeqEngine(); resetSeqState(); resetMomentary();

    // A quick down+up (< HOLD_MS) is a tap. In Track view it mutes the active
    // track (activeSlot), even though no track button was pressed while held.
    appState.activeTrack = trackRef(1);
    seqState.sessionMode = false;
    seqState.muted[1] = false;
    seqHandleMidi([0xB0, CC_MUTE, 127], false);
    seqHandleMidi([0xB0, CC_MUTE, 0], false);
    eq('track-view tap mutes active track', peekSeqCmdQueue().some(c => c === 'mute 1 1'), true);

    // A deliberate press mutes too. Duration is not a different intent for Mute,
    // and the old hold-gated release silently swallowed any press >= 500 ms.
    resetSeqEngine(); resetMomentary();
    appState.activeTrack = trackRef(3);
    seqState.muted[3] = false;
    const realNow = Date.now;
    seqHandleMidi([0xB0, CC_MUTE, 127], false);
    Date.now = () => realNow.call(Date) + 900;
    seqHandleMidi([0xB0, CC_MUTE, 0], false);
    Date.now = realNow;
    eq('long press mutes active track', peekSeqCmdQueue().some(c => c === 'mute 3 1'), true);

    // Mute+track must still suppress it: the track-button path marks the Mute
    // press as gestured (midi/router.ts), so the release mutes nothing more.
    // The mark itself stands in for that path — midi/router sits behind the
    // set-session gate, which a unit test has no set to satisfy.
    {
        const { muteMarkGestured } = await import('../../dist/esm/seq/router.js');
        resetSeqEngine(); resetMomentary();
        appState.activeTrack = trackRef(0);
        seqState.muted[0] = false;
        seqHandleMidi([0xB0, CC_MUTE, 127], false);
        muteMarkGestured();   // what Mute+track and Mute+step both call
        seqHandleMidi([0xB0, CC_MUTE, 0], false);
        eq('mute+track suppresses active-track mute',
            peekSeqCmdQueue().some(c => c === 'mute 0 1'), false);
    }

    // Session view: a Mute press must NOT mute (no current track there).
    resetSeqEngine(); resetMomentary();
    appState.activeTrack = trackRef(2);
    seqState.sessionMode = true;
    seqState.muted[2] = false;
    seqHandleMidi([0xB0, CC_MUTE, 127], false);
    seqHandleMidi([0xB0, CC_MUTE, 0], false);
    eq('session-view tap does not mute', peekSeqCmdQueue().some(c => c.startsWith('mute 2')), false);

    // ...including a long press, which now reaches the same branch.
    resetSeqEngine(); resetMomentary();
    const sessNow = Date.now;
    seqHandleMidi([0xB0, CC_MUTE, 127], false);
    Date.now = () => sessNow.call(Date) + 900;
    seqHandleMidi([0xB0, CC_MUTE, 0], false);
    Date.now = sessNow;
    eq('session-view press does not mute', peekSeqCmdQueue().some(c => c.startsWith('mute 2')), false);

    seqState.sessionMode = false;
    uninstallMockEngine();
}

/* ── solo: Shift+Mute (current track) and Shift+Mute+track ───────────────── */
{
    _log('\nsolo gesture:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, muteShiftHeld, muteTrack } = await import('../../dist/esm/seq/router.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetMomentary } = await import('../../dist/esm/seq/momentary.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    const { toggleSolo, toggleMute, isSoloed, anySolo, isMuted, resetTrackMutes } =
        await import('../../dist/esm/mixer/track-mutes.js');
    const { serializeUiState, applyUiState } = await import('../../dist/esm/seq/ui-state.js');
    const { seqToastText } = await import('../../dist/esm/seq/render.js');

    const CC_MUTE = 88;
    const cmds = () => peekSeqCmdQueue().filter((c) => c.startsWith('mute '));
    const fresh = () => { resetSeqEngine(); resetSeqState(); resetMomentary(); resetTrackMutes(); };

    installMockEngine();

    /* Solo mutes every OTHER track, so the expectation is derived from the
     * track count — pasting 16 entries would just have to be rewritten at the
     * next widening, and hides what is actually being asserted. */
    const othersMuted = (soloed, val, except = []) =>
      Array.from({ length: TRACK_COUNT }, (_, t) => t)
        .filter((t) => t !== soloed && !except.includes(t))
        .map((t) => `mute ${t} ${val}`).sort().join(',');

    // Solo mutes every other track in the engine and leaves the soloed one alone.
    fresh();
    toggleSolo(1);
    eq('solo mutes the others', cmds().sort().join(','), othersMuted(1, 1));
    eq('soloed track not muted', seqState.muted[1], false);
    eq('others muted in the mirror', seqState.muted[0] && seqState.muted[3], true);
    eq('anySolo', anySolo(), true);
    eq('isSoloed', isSoloed(1), true);

    // Un-solo restores what was there before — including a track the user had
    // muted themselves, which must stay muted.
    fresh();
    muteTrack(3);                     // user's own mute, before any solo
    eq('user mute applied', seqState.muted[3], true);
    resetSeqEngine();
    toggleSolo(0);
    eq('solo mutes others (3 already muted)', cmds().sort().join(','), othersMuted(0, 1, [3]));
    resetSeqEngine();
    toggleSolo(0);                    // un-solo
    eq('un-solo unmutes only the borrowed ones', cmds().sort().join(','), othersMuted(0, 0, [3]));
    eq('user mute survives un-solo', seqState.muted[3], true);
    eq('no solo left', anySolo(), false);

    // Solo overrides mute: soloing a track you had muted makes it audible, the
    // way it does everywhere else. Deriving the mute as `base || !solo` instead
    // left it silent, which is what made solo look broken with mutes around.
    fresh();
    muteTrack(2);
    resetSeqEngine();
    toggleSolo(2);                    // solo the muted track
    eq('soloing a muted track unmutes it', seqState.muted[2], false);
    eq('others muted by the solo', seqState.muted[0] && seqState.muted[1] && seqState.muted[3], true);
    resetSeqEngine();
    toggleSolo(2);                    // un-solo → its own mute comes back
    eq('its mute returns on un-solo', seqState.muted[2], true);
    eq('others restored', seqState.muted[0] || seqState.muted[1] || seqState.muted[3], false);

    // Solo is exclusive: soloing another track moves the solo.
    fresh();
    toggleSolo(0);
    resetSeqEngine();
    toggleSolo(2);
    eq('solo moves to the new track', isSoloed(2), true);
    eq('previous solo cleared', isSoloed(0), false);
    eq('swap unmutes the new, mutes the old', cmds().sort().join(','), 'mute 0 1,mute 2 0');
    eq('other tracks stay muted', seqState.muted[1] && seqState.muted[3], true);
    resetSeqEngine();
    toggleSolo(2);                    // same track again → no solo at all
    eq('re-press clears the solo', anySolo(), false);
    eq('everything unmuted again', cmds().sort().join(','), othersMuted(2, 0));

    // Muting while a solo is up edits the underlying intent. It is not audible
    // yet — solo overrides mute — but it lands when the solo drops.
    fresh();
    toggleSolo(1);
    toggleMute(1);                    // mute the soloed track itself
    eq('mute under solo is not audible yet', seqState.muted[1], false);
    eq('intent recorded', isMuted(1), true);
    resetSeqEngine();
    toggleSolo(1);                    // un-solo: track 1 stays muted, others return
    eq('intent survives un-solo', seqState.muted[1], true);
    eq('others unmuted', seqState.muted[0] || seqState.muted[2] || seqState.muted[3], false);

    // Shift+Mute press solos the current track instead of muting it.
    fresh();
    appState.activeTrack = trackRef(1);
    seqState.sessionMode = false;
    seqHandleMidi([0xB0, CC_MUTE, 127], /*shiftHeld*/ true);
    eq('shift captured at press', muteShiftHeld(), true);
    seqHandleMidi([0xB0, CC_MUTE, 0], /*shiftHeld*/ false);   // Shift released early
    eq('shift+mute solos active track', isSoloed(1), true);
    eq('shift+mute does not mute it', seqState.muted[1], false);
    eq('shift flag cleared on release', muteShiftHeld(), false);

    // Plain Mute still mutes and starts no solo.
    fresh();
    seqHandleMidi([0xB0, CC_MUTE, 127], false);
    seqHandleMidi([0xB0, CC_MUTE, 0], false);
    eq('plain mute still mutes', cmds().join(','), 'mute 1 1');
    eq('plain mute sets no solo', anySolo(), false);

    // Solo bookkeeping survives a reopen. The engine keeps the derived mutes,
    // but movy's memory of *why* they are muted is per-set state — losing it
    // would strand them as if the user had muted those tracks by hand.
    fresh();
    toggleSolo(0);
    const blob = serializeUiState();
    eq('solo is serialized', JSON.parse(blob).mutes.solo.join(''),
       '1' + '0'.repeat(TRACK_COUNT - 1));
    resetTrackMutes();                 // movy restarts: module state gone
    eq('reset clears the mirror-side bookkeeping', anySolo(), false);
    applyUiState(blob);                // ...restored from the set's UI blob
    eq('solo restored after reopen', isSoloed(0), true);
    resetSeqEngine();
    toggleSolo(0);                     // un-solo now restores correctly
    eq('un-solo after reopen unmutes the others',
        cmds().sort().join(','), othersMuted(0, 0));

    // A blob written before solo became exclusive can name several — keep the first.
    resetTrackMutes();
    applyUiState(JSON.stringify({ mutes: { solo: [0, 1, 1, 0], base: [0, 0, 0, 0] } }));
    eq('legacy multi-solo blob keeps one', [0, 1, 2, 3].filter(isSoloed).join(','), '1');
    resetTrackMutes();

    // Shift added AFTER Mute goes down still solos (either order is natural).
    fresh();
    appState.activeTrack = trackRef(2);
    seqHandleMidi([0xB0, CC_MUTE, 127], /*shiftHeld*/ false);   // Mute first...
    seqHandleMidi([0xB0, CC_MUTE, 0], /*shiftHeld*/ true);      // ...Shift after
    eq('mute-then-shift still solos', isSoloed(2), true);

    // Toasts name the track and the resulting solo set.
    fresh();
    toggleMute(1);
    eq('mute toast', seqToastText(), 'T2 MUTED');
    toggleMute(1);
    eq('unmute toast', seqToastText(), 'T2 UNMUTED');
    toggleSolo(0);
    eq('solo toast', seqToastText(), 'T1 SOLO');
    toggleSolo(2);
    eq('moved-solo toast names the new track', seqToastText(), 'T3 SOLO');
    toggleSolo(2);
    eq('solo off toast', seqToastText(), 'SOLO OFF');

    // Session view: no current track, so Shift+Mute does nothing there either.
    fresh();
    seqState.sessionMode = true;
    seqHandleMidi([0xB0, CC_MUTE, 127], true);
    seqHandleMidi([0xB0, CC_MUTE, 0], true);
    eq('session-view shift+mute does not solo', anySolo(), false);
    seqState.sessionMode = false;

    resetTrackMutes();
    uninstallMockEngine();
}

/* ── mute mirror ─────────────────────────────────────────────────────────── */
{
    _log('\nmute mirror:');
    const { muteFromStr, seqState } = await import('../../dist/esm/seq/state.js');

    muteFromStr('0100');
    eq('t0 unmuted', seqState.muted[0], false);
    eq('t1 muted',   seqState.muted[1], true);
    eq('t2 unmuted', seqState.muted[2], false);
    muteFromStr('1111');
    eq('all muted',  seqState.muted[3], true);
}

/* ── momentary: tap vs hold ───────────────────────────────────────────────── */
{
    _log('\nmomentary tap vs hold:');
    const { momentaryDownAt, momentaryUpAt, momentaryGesture, resetMomentary } =
        await import('../../dist/esm/seq/momentary.js');

    let restored = 0;
    const restore = () => { restored++; };

    // Timestamps are wall-clock ms (HOLD_MS = 500). A quick tap (< 500 ms) →
    // latch, restore NOT called.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    eq('tap returns tap', momentaryUpAt(40, 1300), 'tap'); // 300 ms
    eq('tap does not restore', restored, 0);

    // Hold (>= 500 ms) → revert, restore called.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    eq('hold returns revert', momentaryUpAt(40, 1700), 'revert'); // 700 ms
    eq('hold restores', restored, 1);

    // 499 ms is still a tap (one ms below threshold).
    resetMomentary();
    momentaryDownAt(40, 0, restore);
    eq('499 ms is still tap', momentaryUpAt(40, 499), 'tap');
    eq('499-ms does not restore', restored, 1);

    // 500 ms exactly → revert.
    resetMomentary();
    momentaryDownAt(40, 0, restore);
    eq('500 ms is hold', momentaryUpAt(40, 500), 'revert');
    eq('500-ms restores', restored, 2);

    // Gesture while held → revert even on a quick release.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    momentaryGesture();
    eq('gesture returns revert', momentaryUpAt(40, 1050), 'revert'); // 50 ms
    eq('gesture restores', restored, 3);

    // Up for a different button is ignored.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    eq('other-button up none', momentaryUpAt(58, 2000), 'none');
    eq('other-button up ignored', restored, 3);

    // Ungated release (Mute): duration is irrelevant, only a gesture suppresses.
    const { momentaryUpUngated } = await import('../../dist/esm/seq/momentary.js');
    resetMomentary();
    momentaryDownAt(88, 0, restore);
    eq('ungated quick release is clean', momentaryUpUngated(88), 'clean');
    resetMomentary();
    momentaryDownAt(88, 0, restore);
    eq('ungated long release is clean', momentaryUpUngated(88), 'clean');   // no time gate at all
    eq('ungated clean does not restore', restored, 3);
    resetMomentary();
    momentaryDownAt(88, 0, restore);
    momentaryGesture();
    eq('ungated gesture returns used', momentaryUpUngated(88), 'used');
    eq('ungated used restores', restored, 4);
    resetMomentary();
    momentaryDownAt(88, 0, restore);
    eq('ungated other-button none', momentaryUpUngated(58), 'none');
}

/* ── restoreTrackState: puts back watchTrack + barOffset on a peek revert ── */
{
    _log('\nrestoreTrackState:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { restoreTrackState } = await import('../../dist/esm/track/switch.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqState.watchTrack = 2;
    seqState.barOffset  = 3;

    restoreTrackState({ track: 0, view: 0, session: false, loop: false });
    eq('watchTrack restored to 0', seqState.watchTrack, 0);
    eq('barOffset reset to 0',     seqState.barOffset,  0);
    eq('watch cmd emitted', peekSeqCmdQueue().some(c => c === 'watch 0'), true);

    /* Restoring to the track already being watched is a no-op on the watch
     * target: the switch it reverts never moved it, so it never wiped the bar
     * offset either, and re-sending `watch` would be a wasted blocking IPC. */
    resetSeqEngine();
    seqState.watchTrack = 1; seqState.barOffset = 2;
    restoreTrackState({ track: 1, view: 0, session: false, loop: false });
    eq('same track: barOffset untouched', seqState.barOffset, 2);
    eq('same track: no watch cmd',        peekSeqCmdQueue().some(c => c === 'watch 1'), false);

    // The session/loop modes it carries are restored verbatim.
    resetSeqEngine();
    seqState.sessionMode = false; seqState.loopMode = false;
    restoreTrackState({ track: 3, view: 0, session: true, loop: true });
    eq('session restored', seqState.sessionMode, true);
    eq('loop restored',    seqState.loopMode,    true);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}

/* ── every track, not just the first four ────────────────────────────────── */
{
    /* toggleMute/toggleSolo carried a `track > 3` ceiling from when movy had
     * four tracks. Everything under it was already 16-wide, so the gesture
     * reached tracks 5-16 and was dropped at the door — silently, since the
     * toast and the LED both read the mirror it never moved. */
    _log('\nmute/solo above track 4:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetMomentary } = await import('../../dist/esm/seq/momentary.js');
    const { toggleSolo, toggleMute, isSoloed, isMuted, resetTrackMutes } =
        await import('../../dist/esm/mixer/track-mutes.js');

    const cmds = () => peekSeqCmdQueue().filter((c) => c.startsWith('mute '));
    const fresh = () => { resetSeqEngine(); resetSeqState(); resetMomentary(); resetTrackMutes(); };

    installMockEngine();

    fresh();
    toggleMute(15);
    eq('track 15 mute reaches the engine', cmds().some(c => c === 'mute 15 1'), true);
    eq('track 15 mute in the mirror', seqState.muted[15], true);
    toggleMute(15);
    eq('track 15 unmutes again', seqState.muted[15], false);

    /* One above the old ceiling, where an off-by-one would still pass at 15. */
    fresh();
    toggleMute(4);
    eq('track 4 mutes', seqState.muted[4], true);

    fresh();
    toggleSolo(12);
    eq('solo above 4 registers', isSoloed(12), true);
    eq('soloed track audible', seqState.muted[12], false);
    eq('every other track muted',
       Array.from({ length: TRACK_COUNT }, (_, t) => t).filter(t => t !== 12)
            .every(t => seqState.muted[t]), true);

    /* The user's own mute on a high track has to survive the borrowed ones. */
    fresh();
    toggleMute(9);
    toggleSolo(14);
    eq('intent held under solo', isMuted(9), true);
    toggleSolo(14);
    eq('un-solo restores the high-track mute', seqState.muted[9], true);
    eq('un-solo clears the borrowed ones', seqState.muted[10], false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetTrackMutes();
}

}
