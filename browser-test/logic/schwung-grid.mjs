/* browser-test/logic/schwung-grid.mjs — the Schwung page cache.
 *
 * Run by browser-test/logic.mjs.
 */

import { schwungPageFor, schwungGridReload, ok } from './harness.mjs';

export async function run() {
    /* ── SP-52: a master/send page is built on the right PORT ────────────── */
    /* `schwungPageFor` used to build every page on `portFor(trackIndex)` —
     * a track's own chain port. Correct for an ordinary module, wrong for
     * `mfx:` (schwung's own, global) and `snd<n>` (movy's engine
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
    schwungPageFor(5, 'mfx:fx1');
    globalThis.shadow_get_param = origShimGet;
    ok('a master FX page reads shadow slot 0, never track 5\'s chain',
       shimGets.length > 0 && shimGets.every((sk) => sk.startsWith('0:mfx:fx1')));
    schwungGridReload();

}
