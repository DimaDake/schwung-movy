/* schwung-page-widget-sync.ts — WHEN the page asks the registry about a
 * module's own widget.
 *
 * THE DEFECT THIS FILE EXISTS FOR: registration used to happen inside reload()
 * alone. reload() runs at construction and on the retry, and neither happens
 * again once a page is up — a module SWAP goes through the controller's own
 * cheap re-plan (`reloadIfChanged`, on the contract's divider), so the incoming
 * module's canvas.js was never read and the cell went on drawing the departed
 * module's art, or a built-in. Hence TWO triggers, which are this file's whole
 * surface: `sync()` after a reload, `afterReplan(adopted)` after a re-plan that
 * MOVED.
 *
 * AN EMPTY CONTRACT IS NOT A VERDICT — upstream's own rule, paid for twice on
 * its host. A chain component always declares something, so an empty
 * `chainParams` is a read that has not arrived; reading "this module declares no
 * custom kind" out of it, and latching that, is exactly how a widget never
 * appears. Nothing is even read in that state, which is what keeps the empty
 * slot — the common case — free.
 *
 * AN UNRESOLVED MODULE ID IS NOT "NO MODULE" either. It is an IPC round trip
 * that fails by answering empty, and a failed read must not become a verdict.
 *
 * A FALSE IS NOT TAKEN FOR AN ANSWER, BUT IT IS NOT ASKED FOREVER EITHER: the
 * ask is a module.json read in each of seven directories, and a module that is
 * genuinely absent would pay that on every divider tick for as long as the tool
 * is open. So the question is asked at most WIDGET_TRIES times per module id and
 * then PARKED — unanswered, not answered — and only a contract that MOVED
 * re-opens it, a move being the one cheap evidence a second look could differ.
 *
 * A SETTLED WIDGET COSTS NOTHING, AND THAT IS A READ, NOT A STYLE. The settled
 * test is FIRST, before the module key is fetched, because the fetch is a
 * blocking round trip. It used to sit after it — "ask which module this is, then
 * see if that is news" — and that is one host call per divider for the whole
 * session, which `grid-cost` caught as the delegated page's idle floor going
 * 146 -> 221 round trips over 600 ticks, 2 over the ceiling that exists to
 * notice exactly this doubling. The door holds the same line from its own side:
 * registerModuleWidgets takes the id as a READ, so the common case — a contract
 * declaring no custom kind — settles without asking for it at all.
 */
import type { TrackPort } from '../track/port.js';
import { moduleReadKey } from '../chain/config.js';
import { registerModuleWidgets } from './schwung-widgets.js';

const WIDGET_TRIES = 3;

export function createWidgetSync(ctl: any, port: TrackPort, componentKey: string) {
    let widgetDone = false;
    let widgetTries = 0;

    function moduleId(): string {
        try { return String(port.getParam(moduleReadKey(componentKey)) || ''); }
        catch (_e) { return ''; }
    }

    function sync(): void {
        if (widgetDone) return;
        const params = ctl.state && ctl.state.chainParams;
        if (!Array.isArray(params) || params.length === 0) return;   /* not an answer */
        if (registerModuleWidgets(moduleId, params)) { widgetTries = 0; widgetDone = true; return; }
        widgetDone = ++widgetTries >= WIDGET_TRIES;              /* parked, not answered */
    }

    /* A re-plan that ADOPTED a new plan is the swap. That is new evidence, so a
     * parked question is re-opened and a settled one is asked again — one round
     * trip per swap, and nothing at all on the dividers in between: a settled
     * widget is silent, and a parked one stays parked until the plan moves. */
    function afterReplan(adopted: boolean): void {
        if (adopted) { widgetTries = 0; widgetDone = false; }
        if (adopted || !widgetDone) sync();
    }

    return { sync, afterReplan };
}
