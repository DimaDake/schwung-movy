/* browser-test/logic/schwung-grid.mjs — the runtime switch between movy's own
 * parameter renderer and Schwung's.
 *
 * The switch used to be a build-time define, so there was nothing to test: a
 * build had one renderer in it. Now one build carries both and a Settings flag
 * chooses, which puts three things at risk that a define could not get wrong —
 * the flag-to-mode mapping, the cached controller surviving a flip, and the
 * library being unavailable while the flag says otherwise.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    flagValue, setFlag, resetFlags,
    schwungGridMode, setSchwungGridMode, schwungPageFor,
    schwungLibAvailable, schwungLibError,
    ok, eq, _log,
} from './harness.mjs';

export function run() {
    _log('\nlogic: schwung grid switch');

    resetFlags();
    setSchwungGridMode(null);          // production path: ask the flag

    /* ── the flag IS the mode ─────────────────────────────────────────────── */
    eq('default is movy\'s own renderer', flagValue('schwunggrid'), 0);

    if (schwungLibAvailable()) {
        setFlag('schwunggrid', 0);
        eq('flag 0 -> movy draws', schwungGridMode(), 'off');
        setFlag('schwunggrid', 1);
        eq('flag 1 -> Schwung draws the widgets', schwungGridMode(), 'body');
        setFlag('schwunggrid', 2);
        eq('flag 2 -> Schwung plans and draws', schwungGridMode(), 'page');

        /* A VALUE OUTSIDE THE TABLE IS NOT A CRASH. `clampFlag` should stop it
         * ever arriving, but prefs.json is a file on a device and this is the
         * one read that turns a number into a renderer. */
        setFlag('schwunggrid', 99);
        ok('an out-of-range flag still names a real mode',
           ['off', 'body', 'page'].includes(schwungGridMode()));

        /* ── flipping the mode drops the cached controller ─────────────────── */
        /* A SchwungPage caches a controller bound to the component's contract.
         * Coming back to PAGE holding the old one draws the page the module had
         * before the user went away and changed it. The cache is keyed by
         * (track, component), so identity is the observable. */
        setFlag('schwunggrid', 2);
        const first = schwungPageFor(0, 'synth');
        eq('the same mode reuses the page', schwungPageFor(0, 'synth'), first);
        setFlag('schwunggrid', 0);
        schwungGridMode();                       // the read is what notices
        setFlag('schwunggrid', 2);
        ok('a mode flip drops the cached page', schwungPageFor(0, 'synth') !== first);
    } else {
        /* ── the library is not there, and the switch must not pretend ─────── */
        /* This is the branch that matters on an older Schwung: the flag can say
         * PAGE and there is no renderer behind it. Pinning to 'off' is what
         * keeps a chosen-but-impossible mode from taking the screen to a
         * controller that cannot run. */
        ok('an unavailable library reports why', schwungLibError().length > 0);
        for (const v of [0, 1, 2]) {
            setFlag('schwunggrid', v);
            eq(`flag ${v} is pinned to movy without the library`, schwungGridMode(), 'off');
        }
    }

    /* Whichever branch ran, say which — the other one is vacuous, and a suite
     * that cannot say which half it exercised is how a green run comes to mean
     * nothing. The pinning branch only has teeth in a build made without
     * SCHWUNG set; the mapping branch only has teeth with it. */
    _log(`  (schwung param_pages ${schwungLibAvailable() ? 'available' : 'ABSENT'} in this build)`);

    resetFlags();
    setSchwungGridMode(null);
}
