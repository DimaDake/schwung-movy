/* browser-test/logic/master-volume.mjs — the volume knob alone, where movy
 * owns it (caps.ownsMasterVolume: standalone). WP7 T3.
 *
 * Beside Move the knob is Move's and movy must not touch the engine stage;
 * on movy-host it walks the same 1 dB ladder as hold-track+volume, topped at
 * unity, writes `mfx:vol`, and saves to prefs.json once per gesture. A held
 * track still wins the knob. Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    _log('\n── Master volume: the knob alone drives mfx:vol where movy owns it ──');
    const { platform, setPlatformForTest } = await import('../../dist/esm/platform/index.js');
    const mv = await import('../../dist/esm/mixer/master-volume.js');
    const tv = await import('../../dist/esm/mixer/track-volume.js');
    const { PREFS_PATH, FACTORY_MASTER_VOLUME } = await import('../../dist/esm/seq/prefs.js');

    const real = platform;
    const files = {};
    let sets = [], writes = 0;
    const host = (owns) => ({
        ...real,
        caps: { coexistsWithMove: !owns, canSuspend: !owns, ownsMasterVolume: owns },
        engineSetBlocking: (k, v) => { sets.push(k + '=' + v); return true; },
        readFile: (p) => files[p] ?? null,
        writeFile: (p, c) => { files[p] = c; writes++; return true; },
    });
    const CW = 1, CCW = 127;

    try {
        /* Beside Move: not ours, nothing sent, nothing drawn. */
        setPlatformForTest(host(false));
        mv.resetMasterVolume(); sets = [];
        ok('overtake: the knob is Move\'s', !mv.masterVolumeKnob(CW));
        const pushedOt = []; mv.pushMasterVolume((k, v) => pushedOt.push(k));
        eq('overtake: the engine stage is never set', sets.length + pushedOt.length, 0);
        mv.masterVolumeTouch(true);
        eq('overtake: no master slider', mv.masterVolumeOverlay(), null);
        mv.masterVolumeTouch(false);

        /* movy-host, first launch: the factory level reaches the engine. */
        setPlatformForTest(host(true));
        mv.resetMasterVolume(); sets = []; delete files[PREFS_PATH];
        const pushed = []; mv.pushMasterVolume((k, v) => pushed.push(k + '=' + v));
        eq('first boot pushes the factory level (-12 dB)', pushed.join(), 'mfx:vol=' + FACTORY_MASTER_VOLUME.toFixed(4));

        mv.masterVolumeTouch(true);
        ok('a turn is consumed', mv.masterVolumeKnob(CW));
        eq('one detent is one dB', sets.join(), 'mfx:vol=' + (10 ** (-11 / 20)).toFixed(4));
        eq('the slider shows while touched', mv.masterVolumeOverlay()?.title, 'MASTER VOLUME');
        eq('nothing saved mid-gesture', writes, 0);
        for (let i = 0; i < 30; i++) mv.masterVolumeKnob(CW);
        eq('topped at unity', sets[sets.length - 1], 'mfx:vol=1.0000');
        eq('the fill is full at the top', mv.masterVolumeOverlay()?.frac, 1);
        mv.masterVolumeTouch(false);
        eq('saved once, on release', writes, 1);
        eq('prefs.json holds it', JSON.parse(files[PREFS_PATH]).masterVolume, 1);
        eq('no slider after release', mv.masterVolumeOverlay(), null);

        /* Down to silence and no further. */
        for (let i = 0; i < 80; i++) mv.masterVolumeKnob(CCW);
        eq('the bottom is silence', sets[sets.length - 1], 'mfx:vol=0.0000');

        /* A reboot reads it back. */
        mv.masterVolumeTouch(false);
        mv.resetMasterVolume();
        const again = []; mv.pushMasterVolume((k, v) => again.push(v));
        eq('a reboot restores the saved level', again.join(), '0.0000');

        /* A held track wins the knob; the master is left alone. */
        mv.resetMasterVolume(); tv.resetTrackVolume(); sets = [];
        tv.volumeTrackDown(2);
        tv.volumeTouch(true); mv.masterVolumeTouch(true);
        const trackTook = tv.volumeKnobDelta(CW);
        ok('with a track held the turn is the track\'s', trackTook);
        ok('the master stage was not written', !sets.some((s) => s.startsWith('mfx:vol')));
        eq('the track slider is the one shown', (tv.volumeOverlay() ?? mv.masterVolumeOverlay())?.title, 'T3 VOLUME');
        tv.volumeTrackUp(2); tv.volumeTouch(false); mv.masterVolumeTouch(false);
    } finally {
        setPlatformForTest(real);
        mv.resetMasterVolume(); tv.resetTrackVolume();
    }
}
