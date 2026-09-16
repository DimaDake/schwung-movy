/* schwung-page-contract.ts — is there a page set to draw, and if not, ask again.
 *
 * The tri-state verdict that decides it, the reload that re-plans when the
 * module in the slot changes, and the placeholder retry that covers a page
 * built while its module was still loading. Separated from the binding because
 * the retry budget is the thing SP-15's Cause-D hypothesis is about.
 */

import type { TrackPort } from '../track/port.js';
import { moduleReadKey } from '../chain/config.js';
import { registerModuleWidgets } from './schwung-widgets.js';

export function createPageContract(ctl: any, port: TrackPort, componentKey: string) {
    let loaded = false;
    let attempts = 0;
    let sinceRetry = 0;

    /*
     * IS THERE A PAGE SET TO DRAW — asked every tick, not decided once.
     *
     * `loaded` used to be set inside reload() alone. Once true it stayed true,
     * so when the module was removed from the slot the controller re-planned to
     * NO PAGES and this still claimed ready: Schwung went on drawing the
     * departed module's page and movy never got the frame back, so the view
     * that should have ejected just sat there. Reported as "if I choose None I
     * do not get kicked out".
     *
     * The tri-state decides the middle case. `contractUnresolved` means the
     * READ failed, which is not news about the module — ejecting on it would
     * throw the user out of a live editor because one param request timed out.
     * So an unresolved read HOLDS the previous verdict, exactly as schwung's
     * own host holds its screen, and only a resolved, genuinely empty plan
     * hands the frame back.
     */
    function refreshLoaded(): void {
        if (ctl.contractUnresolved) return;          /* a failed read empties nothing */
        const has = !!(ctl.pages && ctl.pages.length);
        if (has === loaded) return;
        loaded = has;
        /* Going empty re-arms the retry, so the NEXT module to arrive in the
         * slot is picked up instead of waiting on a spent attempt budget. */
        if (!loaded) { attempts = 0; sinceRetry = 0; }
    }

    function reload(): void {
        ctl.load({ slot: port.track.index, component: componentKey });
        refreshLoaded();
        /*
         * A MODULE'S OWN WIDGET, REGISTERED WHEN ITS CONTRACT ARRIVES.
         *
         * Here rather than on a gesture: upstream registered widgets from the
         * canvas-open path, so an in-grid widget did not appear until the
         * fullscreen view had been opened once and never appeared at all for a
         * module with no canvas param. The contract is the only moment that is
         * always reached and always current — a module swap re-plans through
         * here too, so a new module's widget arrives with its pages.
         *
         * Nothing is read unless the contract declares a `custom:` kind, and a
         * failure is not one: an unregistered kind falls through to the
         * built-in widget by design.
         */
        try {
            const id = port.getParam(moduleReadKey(componentKey));
            if (id) registerModuleWidgets(String(id), ctl.state.chainParams || []);
        } catch (_e) { /* a widget is never worth failing a page plan for */ }
    }
    reload();

    /*
     * A CONTRACT READ THAT CAME BACK EMPTY IS NOT A VERDICT.
     *
     * The page is built while the module is still loading, so the first load
     * sees no hierarchy. Reported from the device as "I opened braids, I see
     * movy UI", with `not-ready pages=0` logged exactly once — the shape of a
     * latched answer rather than a repeated failure.
     *
     * Once loaded, `reloadIfChanged` is the controller's own cheap re-plan (it
     * rebuilds only when the contract fingerprint moves), so a module swap
     * re-plans for free and a steady page costs nothing.
     */
    const RETRY_TICKS = 12;
    const RETRY_LIMIT = 60;

    /*
     * `reloadIfChanged` IS POLLED ON A DIVIDER, NOT EVERY TICK.
     *
     * It is a full contract read — `load()` unconditionally, with the
     * fingerprint compare deciding only whether to re-PLAN — so on device it is
     * a synchronous round trip per call, for a question whose answer changes
     * once: has the module in this slot been swapped. Schwung's own host
     * (shadow_ui_param_pages.mjs) paces the same question on a divider of 8 and
     * says why: "every one of these is a synchronous round trip (~2.8ms) ... for
     * an edge that fires once".
     *
     * It was every tick here, and that was survivable only because the tick
     * itself was rare: the poll used to hang off movy's repaint, which in a
     * steady state never came. SP-12 made the poll per-tick — it had to, or the
     * page's read cursor never advances — and that turned this line into the
     * page's largest standing cost. Measured in `scripts/grid-call-cost.mjs`:
     * every tick, the `page` arm idles at 3.00 host calls/tick; on this divider,
     * 1.25, against movy's own refresh at the 1.13 it replaces.
     *
     * The delay it costs is at most RELOAD_POLL_TICKS before a departed module
     * hands the frame back — tens of milliseconds, against a module load.
     */
    const RELOAD_POLL_TICKS = 8;
    let sinceReload = 0;

    function tick(): void {
        if (!loaded) {
            sinceRetry++;
            if (attempts < RETRY_LIMIT && sinceRetry >= RETRY_TICKS) {
                sinceRetry = 0; attempts++; reload();
            }
            if (!loaded) return;
        }
        if (++sinceReload >= RELOAD_POLL_TICKS) {
            sinceReload = 0;
            ctl.reloadIfChanged();
            refreshLoaded();        /* the module may have just left the slot */
        }
        ctl.tick();                 /* exactly one get_param */
    }

    return { reload, tick, isReady: () => loaded };
}
