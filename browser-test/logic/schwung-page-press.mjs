/* schwung-page-press.mjs — what a pad press costs before its page is on screen.
 *
 * SP-39. Its own module because `schwung-page.mjs` is at the browser-test line
 * ceiling and because the subject is a MEASUREMENT rather than a contract: the
 * tests next door assert what the delegated page plans and draws, this one
 * asserts what the gesture that turns it spends on the wire.
 *
 * Run by browser-test/logic.mjs, after `schwung-page.mjs` — it re-arms the grid
 * and drops it again on the way out.
 */

import { schwungLibAvailable, eq, ok, _log,
         env, MOCK_SYNTHS, schwungPageFor, schwungGridReload,
         setSchwungGridMode, countTripKinds } from './harness.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: schwung pad press — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nTest: a pad press covers its page in ONE bulk request');
{
    /*
     * THE GESTURE, IN THE ONE UNIT THE DEVICE AGREES WITH. On device the pad
     * press added +0.3 single `host_module_get_param` reads a tick across the
     * press section, and the worst frame in the window went 14 -> 20.5 ms —
     * while the `off` arm, movy's own bank switch, cost nothing at all. `mget`
     * is the single-key read, `shadow_get_params` is the bulk one, and this is
     * the harness's own counter over exactly those two.
     *
     * Schwung's `goToPage` runs `warmCurrentPage()` synchronously, and that asks
     * for every cell of the arriving page it does not already hold — one
     * blocking round trip each. The cache cannot cover them on its own:
     * `batchKeys` walks the entries it already has, and a key enters that map
     * only by being asked for, so a page's FIRST read is always live.
     * `focusVoice` knows the page it is about to turn to, which is where the
     * warm is.
     *
     * THE MOCK HAS TO SERVE WHAT THE DEVICE SERVES, or this measures the wrong
     * walk. `warmCurrentPage` STOPS at the first key that answers null, and the
     * device answers "" for a key a module does not serve — a real answer, which
     * the cache keeps — where the mock's store answers null for anything not in
     * the preset, and a null is never cached. Left alone the walk stops after
     * one key and the whole cost this test exists for is invisible; serving a
     * real value for every cell of every page is what the module itself does.
     */
    const jumpFrom = () => {
        setSchwungGridMode('page');
        schwungGridReload();
        env.setParams(MOCK_SYNTHS['6w6']);
        const q = schwungPageFor(0, 'synth');
        for (let i = 0; i < 12 * 60 && !q.ready; i++) q.tick();
        q.goToPage(0);
        for (let i = 0; i < 16; i++) q.tick();
        for (const pg of q.ctl.pages) {
            for (const k of (pg.keys || [])) {
                if (k && !('synth:' + k in env.params)) env.params['synth:' + k] = '0.5';
            }
        }
        return q;
    };

    const p = jumpFrom();
    ok('the page resolved', p.ready);

    /* Onto a page whose cells this session has never read, so nothing below is
     * measuring a page that was already covered. */
    const jump = countTripKinds(() => { p.focusVoice(8); });
    _log(`    (${jump.trips} round trips for the jump: `
       + `${jump.bulk} bulk, ${jump.single} single)`);
    eq('...and it arrived', p.ctl.pages[p.pageIndex].name, 'Clap');

    /* ONE BULK REQUEST FOR THE PAGE, AND NO CELL READ ONE AT A TIME. Without
     * the warm this is the arriving page's eight cells read singly — measured 8
     * here and as the device's +0.3 reads a tick across the press — so the
     * `single` count is what has teeth: the warm does not make the total
     * smaller by accident, it moves the page off the single-key channel. */
    eq('a pad press onto an unread page is one bulk request', jump.bulk, 1);
    /* THE ONE SINGLE IS NOT A CELL. `focusVoice` reads the module's contract
     * first, off the same cache, and rung 1 answers `''` for this rack — a real
     * answer, but not a plan — so rung 2's `ui_pages` is asked for, is not
     * served, and a null is never cached. Every press pays it, warm or not; it
     * is the price of the lookup, not of the page. */
    eq('...and reads no cell of it one at a time', jump.single, 1);

    /* The SECOND press is the control: page 10 is in the cache now, so the same
     * gesture spends nothing on the page at all, and the one single left is the
     * contract read above. A ceiling both presses satisfy would be testing the
     * gesture rather than the warm. */
    const again = countTripKinds(() => { p.focusVoice(8); });
    eq('...and the same press again spends no request on the page', again.bulk, 0);

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

}
