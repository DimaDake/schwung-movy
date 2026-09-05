/* browser-test/logic/mixer.mjs — the dB ladder, the MIX page and send routing.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {

/* ── The dB ladder, shared by the volume gesture and the MIX page ────────── */

_log('\nTest: mixer dB ladder');

{
    const { ampToIdx, idxToAmp, volumeFrac, VOL_MAX, VOL_STEPS } =
        await import('../../dist/esm/mixer/db-ladder.js');

    /* One detent is one dB anywhere in the range. A fixed LINEAR step made the
     * quiet half of the fader five detents wide and the last one drop straight
     * to silence — reported from the field as "adjustable to about -8.5 dB,
     * then it completely cuts off the sound". */
    const unity = ampToIdx(1);
    eq('unity is an exact ladder position', idxToAmp(unity), 1);
    ok('one detent below unity is 1 dB down',
       Math.abs(20 * Math.log10(idxToAmp(unity - 1)) + 1) < 1e-6);
    eq('index 0 is true silence', idxToAmp(0), 0);
    eq('the top of the ladder is the fader maximum', idxToAmp(VOL_STEPS), VOL_MAX);
    eq('the ladder round-trips', ampToIdx(idxToAmp(30)), 30);
    ok('unity sits inside the travel', volumeFrac(1) > 0 && volumeFrac(1) < 1);
    eq('silence is the bottom of the travel', volumeFrac(0), 0);
}

}
