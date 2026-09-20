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
    schwungGridMode, setSchwungGridMode, schwungPageFor, schwungGridReload,
    schwungLibAvailable, schwungLibError,
    ok, eq, _log,
} from './harness.mjs';

export async function run() {
    _log('\nlogic: schwung grid switch');

    resetFlags();
    setSchwungGridMode(null);          // production path: ask the flag

    /* ── the flag IS the mode ─────────────────────────────────────────────── */
    eq('default is movy\'s own renderer', flagValue('schwunggrid'), 0);

    if (schwungLibAvailable()) {
        setFlag('schwunggrid', 0);
        eq('flag 0 -> movy draws', schwungGridMode(), 'off');
        setFlag('schwunggrid', 1);
        eq('flag 1 -> Schwung plans and draws', schwungGridMode(), 'page');

        /* A VALUE OUTSIDE THE TABLE IS NOT A CRASH. `clampFlag` should stop it
         * ever arriving, but prefs.json is a file on a device and this is the
         * one read that turns a number into a renderer. */
        setFlag('schwunggrid', 99);
        ok('an out-of-range flag still names a real mode',
           ['off', 'page'].includes(schwungGridMode()));

        /* ── flipping the mode drops the cached controller ─────────────────── */
        /* A SchwungPage caches a controller bound to the component's contract.
         * Coming back to PAGE holding the old one draws the page the module had
         * before the user went away and changed it. The cache is keyed by
         * (track, component), so identity is the observable. */
        setFlag('schwunggrid', 1);
        const first = schwungPageFor(0, 'synth');
        eq('the same mode reuses the page', schwungPageFor(0, 'synth'), first);
        setFlag('schwunggrid', 0);
        schwungGridMode();                       // the read is what notices
        setFlag('schwunggrid', 1);
        ok('a mode flip drops the cached page', schwungPageFor(0, 'synth') !== first);

        /* ── an under-floor Schwung is pinned the same way ─────────────────── */
        /* Availability is not vintage: the files can all be present and the
         * renderer behind them still unable to run, because a link error is not
         * a missing file. That is the same hole as the branch below, one version
         * number further along — and it is asked with the flag at SCHWUNG, so
         * what is asserted is the floor and not the default. */
        const { resetSchwungFloorOnce } =
            await import('../../dist/esm/renderer/schwung-floor.js');
        const realRead = globalThis.host_read_file;
        globalThis.host_read_file = (p) =>
            p === '/data/UserData/schwung/release.json'
                ? JSON.stringify({ version: '0.11.4', download_url: '' })
                : realRead?.(p) ?? null;
        resetSchwungFloorOnce();
        setFlag('schwunggrid', 1);
        eq('an under-floor Schwung pins to movy with the flag on SCHWUNG',
           schwungGridMode(), 'off');
        globalThis.host_read_file = realRead;
        resetSchwungFloorOnce();
    } else {
        /* ── the library is not there, and the switch must not pretend ─────── */
        /* This is the branch that matters on an older Schwung: the flag can say
         * SCHWUNG and there is no renderer behind it. Pinning to 'off' is what
         * keeps a chosen-but-impossible mode from taking the screen to a
         * controller that cannot run. */
        ok('an unavailable library reports why', schwungLibError().length > 0);
        for (const v of [0, 1]) {
            setFlag('schwunggrid', v);
            eq(`flag ${v} is pinned to movy without the library`, schwungGridMode(), 'off');
        }
    }

    /* ── SP-52: a master/send page is built on the right PORT ────────────── */
    if (schwungLibAvailable()) {
        /* `schwungPageFor` used to build every page on `portFor(trackIndex)` —
         * a track's own chain port. Correct for an ordinary module, wrong for
         * `master_fx:` (schwung's own, global) and `snd<n>` (movy's engine
         * root, self-namespacing): either reached through a chain port gets
         * `ch<N>:` glued onto a key that already names its destination. The
         * fix takes `componentPort(trackIndex, componentKey)` instead
         * (`renderer/schwung-grid.ts`).
         *
         * TRACK INDEX 5 IS DELIBERATE: production always calls this with 0 for
         * these two kinds (`app/page-owner.ts`'s fixed carrier), so a test
         * that also used 0 could not tell "addressed correctly" from
         * "addressed by accident because the index was the giveaway value".
         *
         * The page's very first read happens SYNCHRONOUSLY inside
         * `schwungPageFor` (`reload()` → the contract's `ctl.load()`, which
         * reads `ui_hierarchy` off the injected io before this call returns) —
         * a cache miss falls straight through to `port.getParam`
         * (`schwung-page-cache.ts`) — so no tick loop is needed to observe it. */
        setSchwungGridMode('page');
        schwungGridReload();

        const engineGets = [];
        const origEngineGet = globalThis.host_module_get_param;
        globalThis.host_module_get_param = (key) => { engineGets.push(key); return null; };
        schwungPageFor(5, 'snd0');
        globalThis.host_module_get_param = origEngineGet;
        ok('a send page reads verbatim off the engine root, never a chain',
           engineGets.length > 0 && engineGets.every((k) => k.startsWith('snd0:')));
        schwungGridReload();

        const shimGets = [];
        const origShimGet = globalThis.shadow_get_param;
        globalThis.shadow_get_param = (slot, key) => { shimGets.push(slot + ':' + key); return null; };
        schwungPageFor(5, 'master_fx:fx1');
        globalThis.shadow_get_param = origShimGet;
        ok('a master FX page reads shadow slot 0, never track 5\'s chain',
           shimGets.length > 0 && shimGets.every((sk) => sk.startsWith('0:master_fx:fx1')));
        schwungGridReload();

        setSchwungGridMode(null);
    }

    /* Whichever branch ran, say which — the other one is vacuous, and a suite
     * that cannot say which half it exercised is how a green run comes to mean
     * nothing. The pinning branch only has teeth in a build made without
     * SCHWUNG set; the mapping branch only has teeth with it. */
    _log(`  (schwung param_pages ${schwungLibAvailable() ? 'available' : 'ABSENT'} in this build)`);

    resetFlags();
    setSchwungGridMode(null);
}
