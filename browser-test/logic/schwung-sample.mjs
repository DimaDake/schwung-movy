/* browser-test/logic/schwung-sample.mjs — SP-42: a .wav's peak envelope
 * actually builds, through the real delegated grid.
 *
 * TWO INDEPENDENT DEFECTS, proven by ONE assertion chain rather than two
 * suites, because either one alone leaves the SAME symptom (no picture) by a
 * DIFFERENT cache signature — which is exactly what makes this catch a
 * partial revert of either fix:
 *   - IO never registered (schwung-lib.ts's ladder missing wav_io_qjs.mjs):
 *     the job STARTS (wavPeaksTick ran) but wav_peaks.mjs's own IO guard
 *     fails it immediately — `wavPeaks(path)` comes back `{done:true,
 *     error:"unreadable wav", points:[]}`.
 *   - Nothing advances the job (schwung-page-sample.ts's advanceSample never
 *     wired into schwung-page-contract.ts's tick): `wavPeaksTick` is never
 *     called at all, so `wavPeaks(path)` stays `null` forever — no job ever
 *     started.
 * Only with both fixed does it reach `{done:true, error:"", points:[...]}`
 * with real peak data in it.
 */
import { schwungLib } from '../../dist/esm/renderer/schwung-lib.js';
import {
    env, setSchwungGridMode, schwungGridReload, schwungPageFor,
    schwungLibAvailable, MOCK_SYNTHS, ok, eq, _log,
} from './harness.mjs';
import { makeWav } from './wav-fixture.mjs';

/* Already the value baked into MOCK_SYNTHS.wav_beside_filter's sample_path —
 * reusing it rather than inventing a path keeps the fixture and the mock in
 * one place. */
const FILE = '/s/scene.wav';

/* Small on purpose: BLOCK_BYTES=32768 * BLOCKS_PER_TICK=2 = 65536 B/tick in
 * wav_peaks.mjs, so 80 000 B of 16-bit mono data (40 000 frames) finishes in
 * two ticks once the job has started — this suite is about wiring, not
 * chunking (wav-peaks.mjs already covers chunking against movy's own reader). */
const FRAMES = 40000;

function openSamplePage() {
    setSchwungGridMode('page');
    schwungGridReload();
    /* mrsample's real shape (SP-42 §3): sample_path + a wav_position marker
     * declaring filepath_param, the same pairing detectSample requires to
     * claim a VIZ_SAMPLE group at all. Reused rather than inventing a
     * seventh mock. */
    env.setParams(MOCK_SYNTHS.wav_beside_filter);
    return schwungPageFor(0, 'synth');
}

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: Schwung sample envelope — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nTest: Schwung sample envelope actually builds (SP-42)');

/* A typo in the ladder (schwung-lib.ts) should fail here, loud and cheap,
 * rather than be diagnosed later as "the envelope never fills in". */
{
    const lib = schwungLib();
    eq('wavPeaksTick exposed',  typeof lib.wavPeaksTick, 'function');
    eq('wavPeaksDone exposed',  typeof lib.wavPeaksDone, 'function');
    eq('wavPeaks exposed',      typeof lib.wavPeaks,     'function');
    ok('VIZ_SAMPLE exposed',    lib.VIZ_SAMPLE != null);
}

{
    env.setFiles({ [FILE]: makeWav(FRAMES, (t) => (t > 0.33 && t < 0.66) ? 1 : 0) });

    const p = openSamplePage();
    let n = 0;
    while (n < 12 * 60 && !p.ready) { p.tick(); n++; }
    ok('the page resolved', p.ready);

    /* Generous: a few FILL_TICKS cycles for state.values to carry sample_path,
     * then a couple more for the 2-tick job itself. */
    for (let i = 0; i < 40; i++) p.tick();

    const c = schwungLib().wavPeaks(FILE);
    ok('the envelope job reached a resolved cache entry', c != null);
    if (c) {
        eq('no read error (defect A: IO unregistered -> "unreadable wav")', c.error, '');
        ok('the job finished (defect B: nothing ever called wavPeaksTick)', c.done === true);
        ok('the envelope carries real peak data, not the empty fallback',
           Array.isArray(c.points) && c.points.some((v) => v > 0.5));
    }

    schwungGridReload();
    setSchwungGridMode(null);
    env.setFiles({});
}

}
