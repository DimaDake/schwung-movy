/* browser-test/logic/track-volume.mjs — the hold-track + master-volume gesture
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    eq, _log, env,
} from './harness.mjs';

export async function run() {
/* ── Track volume: hold track button + master volume knob ────────────────── */

_log('\nTest: track volume gesture (hold track + CC 79)');

{
    const {
        volumeTrackDown, volumeTrackUp, volumeTouch, volumeKnobDelta,
        volumeOverlay, resetTrackVolume, MASTER_CC, MASTER_TOUCH_NOTE,
    } = await import('../../dist/esm/mixer/track-volume.js');

    const CW  = 1;     // one detent clockwise
    const CCW = 127;   // one detent counter-clockwise

    const start = (track = 1, vol = '1.00') => {
        resetTrackVolume();
        env.setParams({ 'slot:volume': vol });
        env.clearInjected();
        volumeTrackDown(track);   // divert must be injected here, before any touch
        volumeTouch(true);
    };

    eq('MASTER_CC is 79', MASTER_CC, 79);
    eq('master touch note is 8', MASTER_TOUCH_NOTE, 8);

    // Idle knob belongs to Move: not consumed, nothing written.
    resetTrackVolume();
    env.setParams({ 'slot:volume': '1.00' });
    eq('no track held: turn not consumed', volumeKnobDelta(CW), false);
    eq('no track held: volume untouched', env.params['slot:volume'], '1.00');

    // The divert must be injected on track-button DOWN, before the knob is
    // touched: Move decides what the volume knob targets at touch time, so a
    // hold injected in response to the touch arrives too late and the gesture
    // moves master volume as well (CC 43 = track 1 → slot 0, so slot 1 = CC 42).
    resetTrackVolume();
    env.setParams({ 'slot:volume': '1.00' });
    env.clearInjected();
    volumeTrackDown(1);
    eq('track-down injects the divert', env.injected.length, 1);
    eq('injected track-hold press', JSON.stringify(env.injected[0]), JSON.stringify([0x0B, 0xB0, 42, 127]));
    volumeTouch(true);
    eq('touch adds no further injection', env.injected.length, 1);

    start(1);

    // One detent is one dB anywhere in the range. The old flat 0.05 of linear
    // amplitude was 0.1 dB at the top and a 6 dB cliff at the bottom.
    eq('CW detent consumed', volumeKnobDelta(CW), true);
    eq('CW detent = +1 dB', env.params['slot:volume'], '1.1220');
    volumeKnobDelta(CCW);
    eq('CCW returns to exactly unity', env.params['slot:volume'], '1.0000');
    for (let i = 0; i < 10; i++) volumeKnobDelta(CCW);
    eq('10 detents down = -10 dB', env.params['slot:volume'], '0.3162');

    // The field report: "adjustable down to about -8.5/9 dB, then completely
    // cuts off the sound". The quiet half of the fader has to keep stepping.
    start(0, (10 ** (-8 / 20)).toFixed(4));      // -8 dB
    volumeKnobDelta(CCW);
    eq('quiet range still steps (-8 → -9 dB)', env.params['slot:volume'], '0.3548');
    for (let i = 0; i < 38; i++) volumeKnobDelta(CCW);
    eq('still audible near the floor (-47 dB)', env.params['slot:volume'], '0.0045');
    volumeKnobDelta(CCW);
    volumeKnobDelta(CCW);
    eq('one step below the floor is silence', env.params['slot:volume'], '0.0000');

    // Range is still the full schwung slot span, 0-4.
    start(0, '0.10');
    for (let i = 0; i < 40; i++) volumeKnobDelta(CCW);
    eq('clamps at silence', env.params['slot:volume'], '0.0000');
    start(0, '3.90');
    for (let i = 0; i < 10; i++) volumeKnobDelta(CW);
    eq('clamps at 4', env.params['slot:volume'], '4.0000');

    // Multi-detent packets (d2 = accumulated detents) scale on the same ladder.
    start(2, '1.00');
    volumeKnobDelta(4);
    eq('4-detent packet = +4 dB', env.params['slot:volume'], '1.5849');
    volumeKnobDelta(124);   // -4
    eq('-4-detent packet returns to unity', env.params['slot:volume'], '1.0000');

    // Overlay follows the gesture, and reports the track being edited.
    start(3, '1.00');
    eq('overlay track', volumeOverlay()?.track, 3);
    eq('overlay value', volumeOverlay()?.value, 1);
    eq('overlay fill sits on the unity mark', volumeOverlay()?.frac, volumeOverlay()?.unityFrac);
    volumeKnobDelta(CW);
    eq('overlay tracks the edit', volumeOverlay()?.value.toFixed(4), '1.1220');
    // Releasing the knob hides the slider but keeps the divert: the track button
    // is still down, so a second touch-and-turn must not need a re-inject (and
    // must not leave Move back in master-volume mode in between).
    env.clearInjected();
    volumeTouch(false);
    eq('overlay hidden on touch release', volumeOverlay(), null);
    eq('touch release keeps the divert', env.injected.length, 0);
    volumeTouch(true);
    eq('re-touch shows the slider again', volumeOverlay()?.track, 3);
    eq('re-touch needs no new injection', env.injected.length, 0);

    // Releasing the track button ends the divert even with the knob still held.
    start(1);
    env.clearInjected();
    volumeTrackUp(1);
    eq('track release injects hold-off', JSON.stringify(env.injected[0]), JSON.stringify([0x0B, 0xB0, 42, 0]));
    eq('overlay hidden after track release', volumeOverlay(), null);
    eq('turn after release not consumed', volumeKnobDelta(CW), false);

    // A missed capacitive touch must not lose the gesture (the overlay stays
    // hidden, but the turn still edits — the divert is already in place).
    resetTrackVolume();
    env.setParams({ 'slot:volume': '1.00' });
    env.clearInjected();
    volumeTrackDown(2);
    eq('divert precedes any touch', JSON.stringify(env.injected[0]), JSON.stringify([0x0B, 0xB0, 41, 127]));
    eq('turn without touch is consumed', volumeKnobDelta(CW), true);
    eq('turn without touch edits volume', env.params['slot:volume'], '1.1220');
    eq('no overlay without touch', volumeOverlay(), null);

    // Only one divert per gesture, however many detents arrive.
    env.clearInjected();
    for (let i = 0; i < 5; i++) volumeKnobDelta(CW);
    eq('no repeat injection while turning', env.injected.length, 0);

    // Missing param reads as unity rather than NaN-ing the gesture.
    resetTrackVolume();
    env.setParams({});
    volumeTrackDown(0);
    volumeTouch(true);
    eq('absent slot:volume defaults to unity', volumeOverlay()?.value, 1);

    resetTrackVolume();

    // New-schwung path: when the host advertises
    // shadow_set_overtake_suppress_master_volume, the gesture excludes Move via
    // that flag instead of injectHold, and needs no Shift to draw — see
    // movy/plans/2026-08-24-track-volume-unification.md.
    const suppressCalls = [];
    globalThis.shadow_set_overtake_suppress_master_volume = (flag) => { suppressCalls.push(flag); };

    resetTrackVolume();
    env.setParams({ 'slot:volume': '1.00' });
    env.clearInjected();
    volumeTrackDown(1);
    eq('new path: track-down suppresses Move, no injectHold', JSON.stringify(suppressCalls), '[1]');
    eq('new path: track-down injects nothing', env.injected.length, 0);
    volumeTouch(true);
    eq('new path: overlay shows with no Shift plumbing involved', volumeOverlay()?.track, 1);
    volumeKnobDelta(CW);
    eq('new path: edit still lands on the ladder', env.params['slot:volume'], '1.1220');
    suppressCalls.length = 0;
    volumeTrackUp(1);
    eq('new path: track-up un-suppresses Move, no injectHold', JSON.stringify(suppressCalls), '[0]');
    eq('new path: track-up injects nothing', env.injected.length, 0);

    delete globalThis.shadow_set_overtake_suppress_master_volume;
    resetTrackVolume();
}

}
