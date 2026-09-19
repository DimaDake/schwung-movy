/* schwung-page-contract.ts — is there a page set to draw, and if not, ask again.
 *
 * The tri-state verdict that decides it, the reload that re-plans when the module
 * in the slot changes, and the retry that covers a page built while its module was
 * still loading. Separated from the binding because the retry IS the lifecycle —
 * how long it keeps asking, and how often once the answer stops being news (SP-15).
 */

import type { TrackPort } from '../track/port.js';
import { perfPhase, perfPhaseEnd } from '../app/perf-probe.js';
import { MODULE_LOAD_TICKS } from '../model/constants.js';
import { createWidgetSync } from './schwung-page-widget-sync.js';
import type { PageReadCache } from './schwung-page-cache.js';
import type { PageHierarchy } from './schwung-page-hierarchy.js';

export function createPageContract(ctl: any, port: TrackPort, componentKey: string,
                                   cache: PageReadCache, hier: PageHierarchy) {
    let loaded = false;
    let attempts = 0;
    let sinceRetry = 0;

    /*
     * IS THERE A PAGE SET TO DRAW — asked every tick, not decided once.
     *
     * `loaded` used to be set inside reload() alone. Once true it stayed true, so
     * when the module was removed from the slot the controller re-planned to NO
     * PAGES and this still claimed ready: Schwung went on drawing the departed
     * module's page and movy never got the frame back, so the view that should
     * have ejected just sat there. Reported as "if I choose None I do not get
     * kicked out".
     *
     * The tri-state decides the middle case. `contractUnresolved` means the READ
     * failed, which is not news about the module — ejecting on it would throw the
     * user out of a live editor because one param request timed out. So an
     * unresolved read HOLDS the previous verdict, exactly as schwung's own host
     * holds its screen, and only a resolved, genuinely empty plan hands the frame
     * back.
     */
    function refreshLoaded(): void {
        if (ctl.contractUnresolved) return;          /* a failed read empties nothing */
        const has = !!(ctl.pages && ctl.pages.length);
        if (has === loaded) return;
        loaded = has;
        /* Going empty re-arms the retry — not to release a latch, because
         * nothing latches any more, but to put the page back on the URGENT
         * pace: a slot a module has just LEFT is one the user is about to
         * fill, and that is the case the delayed first load is made of. */
        if (!loaded) { attempts = 0; sinceRetry = 0; }
    }

    /* A MODULE'S OWN WIDGET — the trigger, the rules and the budget are in
     * schwung-page-widget-sync.ts; `sync` after a reload, `afterReplan` below. */
    const widgets = createWidgetSync(ctl, port, componentKey);

    function reload(): void {
        /*
         * A RE-PLAN READS LIVE. Everything on screen hangs off the plan, and a plan
         * is rare — construction, the retry, a module swap — so it is the one read
         * that must not be answered from a batch taken before it.
         *
         * It is also where a cached answer is arbitrarily old: the cache ages in
         * PAGE TICKS, and a page is ticked only while the module grid is on screen
         * (SP-12), so one that has been away comes back holding whatever it last
         * saw. Measured in app-loop: the module changed while the grid was off
         * screen, the re-plan read the previous module's absent hierarchy from the
         * cache and paginated `chain_params` into ONE page, and the jog then had
         * nowhere to go.
         */
        cache.invalidateAll();
        /* The translated contract is dropped with the cache it was built from:
         * the module in the slot is exactly what a re-plan may have changed, and
         * a memo keyed by the DEPARTED module's id would plan the new one from
         * the old one's banks. */
        hier.invalidate();
        ctl.load({ slot: port.track.index, component: componentKey });
        refreshLoaded();
        /* A MODULE'S OWN WIDGET, REGISTERED WHEN ITS CONTRACT ARRIVES. Here rather
         * than on a gesture: upstream registered widgets from the canvas-open path,
         * so an in-grid widget did not appear until the fullscreen view had been
         * opened once, and never appeared at all for a module with no canvas param.
         * A failure is not one either: an unregistered kind falls through to the
         * built-in widget by design, so this must never fail a page plan. */
        try { widgets.sync(); } catch (_e) { /* a widget is never worth a page plan */ }
    }
    reload();

    /*
     * A CONTRACT READ THAT CAME BACK EMPTY IS NOT A VERDICT.
     *
     * The page is built while the module is still loading, so the first load
     * sees no hierarchy — reported from the device as "I opened braids, I see
     * movy UI", where the only evidence was a single `not-ready pages=0` line.
     * A SINGLE LINE IS NOT A LATCHED ANSWER, and reading it as one is what let
     * the real latch live: the reason lines are written once per DISTINCT
     * reason (`app/tick.ts`), so a retry that keeps failing at an unchanged
     * reason is silent, and "once" is the dedup rather than the asking having
     * stopped. Nothing latches any more (SP-15) — the asking continues at a
     * slower pace — and either way the contract decides the page, never the log.
     * Once loaded a swap re-plans from the fingerprint, not from here.
     */
    const RETRY_TICKS = 12;
    const RETRY_LIMIT = 60;

    /*
     * THE ASKING NEVER STOPS; ONLY ITS PACE CHANGES (SP-15).
     *
     * `RETRY_LIMIT` is not the number of tries after which the page gives up — it
     * is the end of the URGENT window; past it a page with nothing to draw keeps
     * asking, at a module load's pace instead of a read's.
     *
     * It has to keep asking, and that is the whole of Cause D: while `loaded` is
     * false `tick()` returns before the divider below, so `reloadIfChanged` — the
     * only other place that could notice a module — never runs, and a discovery
     * path that stops is not slow, it is gone. The empty slot is the COMMON case
     * (a cold boot has no active chain slot at all), so a latching budget is spent
     * before the user has loaded anything and the module that lands afterwards is
     * never read again — "the first module I drop into an empty slot keeps movy's
     * page until I navigate away and back", that navigation building the fresh
     * contract which hid it.
     *
     * A load's pace is also what keeps the re-arm above honest: it fires on slots
     * that stay empty.
     */
    const IDLE_RETRY_TICKS = MODULE_LOAD_TICKS;

    /*
     * `reloadIfChanged` IS POLLED ON A DIVIDER, NOT EVERY TICK.
     *
     * It is a full contract read — `load()` unconditionally, with the fingerprint
     * compare deciding only whether to re-PLAN — so on device it is a synchronous
     * round trip per call, for a question whose answer changes once: has the module
     * in this slot been swapped. Schwung's own host (shadow_ui_param_pages.mjs)
     * paces the same question on a divider of 8 and says why: "every one of these
     * is a synchronous round trip (~2.8ms) ... for an edge that fires once".
     *
     * It was every tick here, and that was survivable only because the tick itself
     * was rare: the poll used to hang off movy's repaint, which in a steady state
     * never came. SP-12 made the poll per-tick — it had to, or the page's read
     * cursor never advances — and that turned this line into the page's largest
     * standing cost. Measured in `scripts/grid-call-cost.mjs`: every tick, the
     * `page` arm idles at 3.00 host calls/tick; on this divider, 1.25, against
     * movy's own refresh at the 1.13 it replaces.
     *
     * The delay it costs is at most RELOAD_POLL_TICKS before a departed module
     * hands the frame back — tens of milliseconds, against a module load.
     */
    const RELOAD_POLL_TICKS = 8;
    let sinceReload = 0;

    function tick(): void {
        if (!loaded) {
            sinceRetry++;
            const urgent = attempts < RETRY_LIMIT;
            /* The pace is chosen in ONE place, and `attempts` counts the urgent
             * asks only — it is a window that ends, not a budget that runs out. */
            if (sinceRetry >= (urgent ? RETRY_TICKS : IDLE_RETRY_TICKS)) {
                sinceRetry = 0;
                if (urgent) attempts++;
                reload();
            }
            if (!loaded) return;
        }
        /* PHASED SEPARATELY because they answer different questions and only one is
         * on the divider: `reloadIfChanged` asks "was the module swapped" every 8
         * ticks, `ctl.tick()` advances the page every tick. `perf_phase` put 68 of
         * minijv's 70 ms tick on this function and could not say which half. */
        if (++sinceReload >= RELOAD_POLL_TICKS) {
            sinceReload = 0;
            /* `finally` BECAUSE `perf_phase` IS AN OPEN/CLOSE PAIR WITH NO RESET:
             * `perfPhase`/`perfPhaseEnd` share one name and one start stamp, and
             * nothing clears them — `perfProbeTick` drops the phase TOTALS but not
             * the open one. A throw out of the three calls below would leave this
             * phase open and charge the next window the inter-window gap as its own
             * cost, attributed to `ctlreload`. Same repair as `midi/router.ts`'s
             * pad-press phase. */
            perfPhase('ctlreload');
            try {
                /* `load` answers whether it ADOPTED a new plan: the only cheap evidence
                 * that the module in the slot said something new — a swap, a preset, a
                 * module that finished loading. Phased separately so its cost is not
                 * read as the re-plan's. */
                const adopted = ctl.reloadIfChanged();
                perfPhase('refreshloaded');
                refreshLoaded();    /* the module may have just left the slot */
                perfPhase('reloadwidgets');
                /* A re-plan that MOVED is the swap, and the one moment a widget may
                 * belong to a different module — see schwung-page-widget-sync.ts. */
                widgets.afterReplan(adopted);
            } finally {
                perfPhaseEnd();
            }
        }
        perfPhase('ctltick');
        ctl.tick();                 /* exactly one get_param */
        perfPhaseEnd();
    }

    return { reload, tick, isReady: () => loaded };
}
