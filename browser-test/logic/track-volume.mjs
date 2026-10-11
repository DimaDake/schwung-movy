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

    /* Every track is a movy chain now, so the gain lives in the `mix` triple
     * rather than a bare `slot:volume` float — same fader, same ladder, a
     * wider value on the wire. The tail (pan/mute/sends) is carried through
     * unchanged by the gesture, so it is fixed here rather than asserted on. */
    const TAIL = ',0,0,0,0';
    const mixOf = (amp) => amp + TAIL;

    const start = (track = 1, vol = '1.00') => {
        resetTrackVolume();
        env.setParams({ 'mix': mixOf(vol) });
        volumeTrackDown(track);
        volumeTouch(true);
    };

    eq('MASTER_CC is 79', MASTER_CC, 79);
    eq('master touch note is 8', MASTER_TOUCH_NOTE, 8);

    // Idle knob is the master's (master-volume.ts): not consumed here.
    resetTrackVolume();
    env.setParams({ 'mix': mixOf('1.00') });
    eq('no track held: turn not consumed', volumeKnobDelta(CW), false);
    eq('no track held: volume untouched', env.params['mix'], mixOf('1.00'));

    start(1);

    // One detent is one dB anywhere in the range. The old flat 0.05 of linear
    // amplitude was 0.1 dB at the top and a 6 dB cliff at the bottom.
    eq('CW detent consumed', volumeKnobDelta(CW), true);
    eq('CW detent = +1 dB', env.params['mix'], mixOf('1.1220'));
    volumeKnobDelta(CCW);
    eq('CCW returns to exactly unity', env.params['mix'], mixOf('1.0000'));
    for (let i = 0; i < 10; i++) volumeKnobDelta(CCW);
    eq('10 detents down = -10 dB', env.params['mix'], mixOf('0.3162'));

    // The field report: "adjustable down to about -8.5/9 dB, then completely
    // cuts off the sound". The quiet half of the fader has to keep stepping.
    start(0, (10 ** (-8 / 20)).toFixed(4));      // -8 dB
    volumeKnobDelta(CCW);
    eq('quiet range still steps (-8 → -9 dB)', env.params['mix'], mixOf('0.3548'));
    for (let i = 0; i < 38; i++) volumeKnobDelta(CCW);
    eq('still audible near the floor (-47 dB)', env.params['mix'], mixOf('0.0045'));
    volumeKnobDelta(CCW);
    volumeKnobDelta(CCW);
    eq('one step below the floor is silence', env.params['mix'], mixOf('0.0000'));

    // Range is still the full 0-4 span.
    start(0, '0.10');
    for (let i = 0; i < 40; i++) volumeKnobDelta(CCW);
    eq('clamps at silence', env.params['mix'], mixOf('0.0000'));
    start(0, '3.90');
    for (let i = 0; i < 10; i++) volumeKnobDelta(CW);
    eq('clamps at 4', env.params['mix'], mixOf('4.0000'));

    // Multi-detent packets (d2 = accumulated detents) scale on the same ladder.
    start(2, '1.00');
    volumeKnobDelta(4);
    eq('4-detent packet = +4 dB', env.params['mix'], mixOf('1.5849'));
    volumeKnobDelta(124);   // -4
    eq('-4-detent packet returns to unity', env.params['mix'], mixOf('1.0000'));

    // Overlay follows the gesture, and reports the track being edited.
    start(3, '1.00');
    eq('overlay track', volumeOverlay()?.track, 3);
    eq('overlay value', volumeOverlay()?.value, 1);
    eq('overlay fill sits on the unity mark', volumeOverlay()?.frac, volumeOverlay()?.unityFrac);
    volumeKnobDelta(CW);
    eq('overlay tracks the edit', volumeOverlay()?.value.toFixed(4), '1.1220');
    // Releasing the knob hides the slider but keeps the gesture: the track
    // button is still down, so a second touch-and-turn edits the same track.
    volumeTouch(false);
    eq('overlay hidden on touch release', volumeOverlay(), null);
    volumeTouch(true);
    eq('re-touch shows the slider again', volumeOverlay()?.track, 3);

    // Releasing the track button ends the gesture even with the knob still held.
    start(1);
    volumeTrackUp(1);
    eq('overlay hidden after track release', volumeOverlay(), null);
    eq('turn after release not consumed', volumeKnobDelta(CW), false);

    // A missed capacitive touch must not lose the gesture (the overlay stays
    // hidden, but the turn still edits — the track button armed it).
    resetTrackVolume();
    env.setParams({ 'mix': mixOf('1.00') });
    volumeTrackDown(2);
    eq('turn without touch is consumed', volumeKnobDelta(CW), true);
    eq('turn without touch edits volume', env.params['mix'], mixOf('1.1220'));
    eq('no overlay without touch', volumeOverlay(), null);

    // Missing param reads as unity rather than NaN-ing the gesture.
    resetTrackVolume();
    env.setParams({});
    volumeTrackDown(0);
    volumeTouch(true);
    eq('absent mix defaults to unity', volumeOverlay()?.value, 1);

    resetTrackVolume();

    /* All 16 tracks (WP7 T3). Every track is a movy chain, so the gesture is
     * the same write on each — what must not survive is a track index that
     * only reaches the first group. */
    const realSet = globalThis.host_module_set_param_blocking;
    const wrote = [];
    globalThis.host_module_set_param_blocking = (k, v, ...a) => { wrote.push(k); return realSet(k, v, ...a); };
    try {
        const missed = [];
        for (let t = 0; t < 16; t++) {
            resetTrackVolume();
            env.setParams({ 'mix': mixOf('1.00') });
            wrote.length = 0;
            volumeTrackDown(t);
            volumeTouch(true);
            const took = volumeKnobDelta(CW);
            const ov = volumeOverlay();
            volumeTrackUp(t);
            if (!took || ov?.title !== 'T' + (t + 1) + ' VOLUME' || !wrote.some((k) => k === 'ch' + t + ':mix'))
                missed.push(t + 1 + ':' + wrote.join('|'));
        }
        eq('hold any of the 16 tracks + turn writes THAT track\'s mix', missed.join(' '), '');
    } finally {
        globalThis.host_module_set_param_blocking = realSet;
        resetTrackVolume();
    }
}

}
