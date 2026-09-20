/* schwung-page.ts — Schwung's controller IS the page. movy keeps its chrome.
 *
 * This file used to plan and draw the grid itself: it called planPages,
 * buildMetaIndex and renderPageMovy directly. That was a SECOND
 * IMPLEMENTATION — the thing this whole exercise exists to remove — and it
 * broke the way second implementations do. renderPageMovy draws knob pages and
 * nothing else, so preset, items, menu and child pages rendered as BLANK.
 * Every one of them already had a renderer in Schwung's page_controller, which
 * this bypassed. Reported from the device as "the presets page doesn't render".
 *
 * Now it wraps `createController` and gets all of it: every page kind, divable
 * params, the section picker, the staggered read cursor, the write and announce
 * throttles, the contract tri-state, the placeholder retry, knob feel. What is
 * left here is what Schwung's own README calls "the whole binding": routing,
 * one tick, one render.
 *
 * movy supplies the HEADER and the FOOTER and nothing else, via `bands`. That
 * is the one place the two UIs deliberately differ — movy's header carries the
 * track, its footer carries movy's gestures, and Schwung knows about neither.
 *
 * THE SEQUENCER STILL TARGETS PARAMETERS, not slots. An automation lane stores
 * `targetParam` (componentKey + ':' + key) and is searched by that string, so
 * re-pagination moves no lane: it follows its parameter onto whatever page
 * Schwung puts it on. `keyAt` is how movy asks which parameter a knob drives.
 *
 * The five things this file used to hold inline have their own modules now: the
 * injected I/O (`schwung-page-io`), the contract lifecycle and its retry budget
 * (`schwung-page-contract`), the render path (`schwung-page-render`), the
 * gestures forwarded to the controller (`schwung-page-input`) and the per-tick
 * "is it still moving" question (`schwung-page-anim`). What is left here is the
 * binding and the surface it publishes.
 */

import type { TrackPort } from '../track/port.js';
import type { PageAutomation } from '../types/page-automation.js';
import type { AutomationView } from '../types/viewmodel.js';
import { schwungLib } from './schwung-lib.js';
import { createPageIo } from './schwung-page-io.js';
import { createPageReadCache } from './schwung-page-cache.js';
import { createPageHierarchy } from './schwung-page-hierarchy.js';
import { createPageContract, RELOAD_POLL_TICKS } from './schwung-page-contract.js';
// Re-exported so a test can assert against the REAL divider width (SP-49)
// instead of a copy of the number — `schwung-page-contract.js` is not its own
// entry point in the bundle, so nothing else surfaces it.
export { RELOAD_POLL_TICKS };
import { createPageRender } from './schwung-page-render.js';
import { createPageInput } from './schwung-page-input.js';
import { createPageAnimating } from './schwung-page-anim.js';
import { chromeFor, type PageChrome } from './schwung-page-chrome.js';

/** What Schwung asks the HOST to do. `open` wants an editor for `key`; `exit`
 *  means every layer is down and Back now belongs to movy. */
export interface SchwungIntent {
    action: 'open' | 'exit' | string;
    key?: string;
    fullKey?: string;
    meta?: any;
    options?: string[];
    index?: number;
}

export interface SchwungPage {
    reload(): void;
    tick(): void;
    readonly pageCount: number;
    readonly pageIndex: number;
    changePage(delta: number): void;
    goToPage(i: number): void;
    /** Which Schwung parameter knob `slot` drives right now, bare key or null. */
    keyAt(slot: number): string | null;
    /** Same, component-qualified — the form a lane's targetParam takes. */
    targetAt(slot: number): string | null;
    labelAt(slot: number): string | null;
    /** What movy's automation layer needs about the param at this knob. */
    knobParamInfo(slot: number): any | null;
    /** The drawn cells as normalised 0..1, `null` where nothing is bound or
     *  nothing has been read back. What lights the knob LEDs, and what movy
     *  watches to know the drawn page moved. */
    knobLevels(): (number | null)[];
    /** SP-38: is the drawn page still MOVING — a widget transition in flight,
     *  or a trigger bang still flashing — with no value and no page identity
     *  change to show for it? Asked by the repaint decision when both of those
     *  have held still, and the only thing that makes an animated widget draw
     *  more than the one frame its value change bought. */
    animating(nowMs: number): boolean;
    render(title: string, auto?: AutomationView, touched?: number): void;
    /** What movy's header and footer should say while this page is the body.
     *  `paging` is true only where the jog moves this page set. */
    chrome(paging: boolean): PageChrome;
    knobTurn(slot: number, delta: number): void;
    knobTouch(slot: number, down: boolean): void;
    /** Jog click. Returns a host intent ("open") when Schwung asks for one. */
    click(shift?: boolean): SchwungIntent | null;
    /** Back. Null once a layer has been taken down; {action:'exit'} when none was. */
    back(): SchwungIntent | null;
    /** Show the page for a 1-based drum pad. False when it cannot be resolved. */
    focusVoice(pad: number): boolean;
    readonly ready: boolean;
    /** The controller itself, for gestures this binding has not wired yet. */
    readonly ctl: any;
}

export function createSchwungPage(
    port: TrackPort, componentKey = 'synth',
    /* WHICH MODEL ANSWERS FOR THIS PAGE'S MODULATION. Injected, not imported:
     * the LFO routing lives on the model and the model is app state (R12), and
     * the page is created here from a (track, component) pair that no model owns
     * by itself. Bound to those two at creation — both are the page's own cache
     * key, so neither can go stale — and asked lazily, because the model behind
     * them can be swapped while the page lives on. Absent means "movy knows of
     * none", which is what a page built outside the app (a test, a probe) gets. */
    modulatedOf: ((track: number, componentKey: string) => ReadonlySet<string> | null) | null = null,
    automationOf: ((track: number) => PageAutomation) | null = null,
): SchwungPage {
    const qualify = (k: string) => (k.indexOf(':') >= 0 ? k : componentKey + ':' + k);

    const lib = schwungLib();
    /* The cache IS movy's half of the read contract (SP-26): Schwung asks one
     * key a tick, movy answers from a page-sized batch it refills on a divider.
     * It is created here, beside the controller it serves, because its lifetime
     * is the controller's — `schwungGridReload()` drops both together. */
    const cache = createPageReadCache(port);
    /* The one reader of the module's contract, for the two things that need it:
     * the planner (through the io below) and `focusVoice`. Built here for the
     * same reason as the cache — its lifetime is the controller's. */
    const hier = createPageHierarchy(port, qualify, cache, componentKey);
    /* Both are asked as FUNCTIONS for the same reason (see modulated-keys.ts):
     * a page is cached by (track, component) and outlives the module that built
     * it, so an answer captured now would be given about a module that has
     * since been swapped out. */
    const ctl = lib.createController(createPageIo(port, qualify, cache, hier, componentKey,
        modulatedOf ? () => modulatedOf(port.track.index, componentKey) : null,
        automationOf ? () => automationOf(port.track.index) : null));
    ctl.setLayout(lib.LAYOUT_MOVY);

    /* The controller's own view of the page it is showing. Both the binding's
     * key accessors and the render path read it, so it is defined once here and
     * handed to whichever module needs it. */
    function keysOf(): (string | null)[] {
        const p = ctl.page;
        return (p && Array.isArray(p.keys)) ? p.keys : [];
    }
    const keyAt = (slot: number) => (keysOf()[slot] as string) || null;

    const contract = createPageContract(ctl, port, componentKey, cache, hier);
    const page = createPageRender(ctl, { keyAt, keysOf, componentKey,
                                        normalizedOf: lib.normalizedOf });
    /* SP-39: `focusVoice` covers the page it is about to turn to before the
     * controller asks for its cells — see schwung-page-input.ts. */
    const input = createPageInput(ctl, lib, port, qualify, hier, cache.warm);

    /* SP-38's per-tick question, built once here and published below. It reads
     * the animation store rather than the controller, so it lives in its own
     * module — which is also what keeps this file inside its size cap. */
    const animating = createPageAnimating(ctl, lib);

    return {
        /* `contract.reload()` drops the cache itself — a re-plan reads live,
         * including the retry path this binding cannot see. */
        reload: contract.reload,
        /* The fill happens BEFORE the controller's tick, so the cursor's one
         * read this tick is served from the batch rather than arriving a tick
         * ahead of it. */
        tick() { cache.tick(); contract.tick(); },
        get ready() { return contract.isReady(); },
        get ctl() { return ctl; },
        get pageCount() { return ctl.pages ? ctl.pages.length : 0; },
        get pageIndex() { return ctl.pageIndex; },
        /* UNWARMED ON PURPOSE, and it is not the skip the pad jump looks like.
         * `changePage` is a JOG, and `onJog` never reaches `goToPage`: it sets
         * `s.pageIndex` through `page_nav`'s `step()` and calls
         * `warmCurrentPage()` itself (`page_controller.mjs`), which is the same
         * per-key walk the jump warms for. The difference is the target: a jump
         * lands on an ARBITRARY voice's page, a jog lands on the neighbour — the
         * one page the controller's own neighbour-prefetch lane exists to keep
         * warm, which is why its comment can say the call is "usually free". A
         * warm here would also have to name the landing index before `onJog`
         * computes it (its `step`/`stepLevel`/`restoreSection` choice, plus the
         * menu and picker branches that return without moving at all). Left as
         * it is, recorded rather than assumed — see SP-39's ledger entry. */
        changePage(delta: number) { ctl.onJog(delta > 0 ? 1 : -1); },
        goToPage(i: number) { ctl.goToPage(i); },
        keyAt,
        targetAt: (slot: number) => { const k = keyAt(slot); return k ? qualify(k) : null; },
        labelAt: (slot: number) => {
            const k = keyAt(slot);
            if (!k || !ctl.metaIndex) return null;
            const m = ctl.metaIndex.getOrGuess(k);
            return String((m && (m.label || m.key)) || k);
        },
        knobParamInfo: page.knobParamInfo,
        knobLevels: page.knobLevels,
        animating,
        render: page.render,
        chrome: (paging: boolean) => chromeFor(ctl, lib, paging),
        knobTurn: input.knobTurn,
        knobTouch: input.knobTouch,
        click: input.click,
        back: input.back,
        focusVoice: input.focusVoice,
    };
}
