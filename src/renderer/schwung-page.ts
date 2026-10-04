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

import type { PageParamSource, SourcePicker } from './schwung-page-source.js';
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
import { createPageFocus } from './schwung-page-focus.js';
import { createPageSeat } from './schwung-page-seat.js';
import { createPageAnimating, type AnimActivity } from './schwung-page-anim.js';
import { chromeFor, claimsBottomBand, regularKnob, type PageChrome } from './schwung-page-chrome.js';
import { openCanvasDive } from './schwung-canvas-dive.js';
import { markGatesDue } from './schwung-page-visible.js';
import { moduleReadKey } from '../chain/config.js';
/* movy's own big-font cell, for the three values Schwung's big-number widget
 * cannot reach (an enum, or a reading with a unit in it). */

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
    /** Which drawn cells wear a modulation / lane mark, as a bitmask — so a
     *  mark flipping with no value change still asks for the frame back. */
    marks(): number;
    /** SP-38: is the drawn page still MOVING — a widget transition in flight,
     *  or a trigger bang still flashing — with no value and no page identity
     *  change to show for it? Asked by the repaint decision when both of those
     *  have held still, and the only thing that makes an animated widget draw
     *  more than the one frame its value change bought. */
    animating(nowMs: number): AnimActivity;
    /** Is Schwung's enum peek — the option list a turn raises over the grid —
     *  up right now?
     *
     *  Asked by the repaint decision because it is invisible to everything
     *  else that decision compares: it appears on a turn that need not change
     *  any value (at a clamped end it cannot), and it EXPIRES on a clock with
     *  nothing moving at all. Neither edge would otherwise ask for a frame, so
     *  the list would be drawn late, or left on screen after it was gone. */
    peekOpen(): boolean;
    render(title: string, auto?: AutomationView, touched?: number): void;
    /** What movy's header and footer should say while this page is the body.
     *  `paging` is true only where the jog moves this page set. */
    chrome(paging: boolean): PageChrome;
    /** May hold-to-modulate arm on this cell? See `regularKnob`. */
    regularKnobAt(slot: number): boolean;
    knobTurn(slot: number, delta: number): void;
    knobTouch(slot: number, down: boolean): void;
    /** Jog click. Returns a host intent ("open") when Schwung asks for one. */
    click(shift?: boolean): SchwungIntent | null;
    /** Back. Null once a layer has been taken down; {action:'exit'} when none was. */
    back(): SchwungIntent | null;
    /** Show the page for a 1-based drum pad — the voice declaring `note`, the
     *  note the pad sounded, where given. False when it cannot be resolved. */
    focusVoice(pad: number, note?: number): boolean;
    /** movy wrote the module's focus param outside the page (a config rack's
     *  press) — the page's focus follows it, not the module (plan D8). */
    focusWritten(fullKey: string, value: string): void;
    /** The list a door cell opens, when its SOURCE supplies one (SP-60's LFO
     *  target) — see `PageParamSource.picker`. */
    picker(key: string): SourcePicker | null;
    /** Open the fullscreen screen a held canvas cell's click asks for (DR32's
     *  ENGN picker). False when the intent is not a canvas. */
    canvasDive?(intent: SchwungIntent): boolean;
    /** Schwung is drawing into the bottom band (a peek, picker, hint or a
     *  non-grid page) — movy's Loop strip must yield. See `claimsBottomBand`. */
    claimsBottomBand(): boolean;
    readonly ready: boolean;
    /** The controller itself, for gestures this binding has not wired yet. */
    readonly ctl: any;
}

export function createSchwungPage(
    port: PageParamSource, componentKey = 'synth',
    /* WHICH MODEL ANSWERS FOR THIS PAGE'S MODULATION. Injected, not imported:
     * the LFO routing lives on the model and the model is app state (R12), and
     * the page is created here from a (track, component) pair that no model owns
     * by itself. Bound to those two at creation — both are the page's own cache
     * key, so neither can go stale — and asked lazily, because the model behind
     * them can be swapped while the page lives on. Absent means "movy knows of
     * none", which is what a page built outside the app (a test, a probe) gets. */
    modulatedOf: ((track: number, componentKey: string) => ReadonlySet<string> | null) | null = null,
    automationOf: ((track: number) => PageAutomation) | null = null,
    /* The page's own carrier index. NOT `port.track.index`: a virtual source
     * (SP-53) makes no claim about a track, so this is threaded in explicitly
     * by the one caller that already knows it (`schwungPageFor`) rather than
     * re-derived from a field only a real module's port has. Defaults to 0 so
     * every existing direct caller (a test, a probe) that built a page from a
     * real port without ever reading this argument keeps working — those
     * always meant slot 0 anyway, since `port.track.index` was `trackIndex`
     * for a real `TrackPort` too. */
    trackIndex = 0,
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
    const automation = automationOf ? () => automationOf(trackIndex) : null;
    /* movy's drum focus (plan D8): the pad press writes it, the controller's
     * focus reads are answered from it — see schwung-page-focus.ts. */
    const focus = createPageFocus(hier, lib, qualify, automation);
    const ctl = lib.createController(createPageIo(port, qualify, cache, hier, componentKey,
        modulatedOf ? () => modulatedOf(trackIndex, componentKey) : null, automation, focus));
    ctl.setLayout(lib.LAYOUT_MOVY);

    /* The controller's own view of the page it is showing. Both the binding's
     * key accessors and the render path read it, so it is defined once here and
     * handed to whichever module needs it. */
    function keysOf(): (string | null)[] {
        const p = ctl.page;
        return (p && Array.isArray(p.keys)) ? p.keys : [];
    }
    const keyAt = (slot: number) => (keysOf()[slot] as string) || null;

    const contract = createPageContract(ctl, port, componentKey, cache, hier, lib, trackIndex);
    /* SP-39: `focusVoice` covers the page it is about to turn to before the
     * controller asks for its cells — see schwung-page-input.ts. */
    /* movy's jog order over the controller's pages (plan D5/D6/D7). */
    const seat = createPageSeat(ctl, lib, hier, qualify);
    const input = createPageInput(ctl, lib, port, qualify, hier, cache.warm, focus, seat);
    const page = createPageRender(ctl, { keyAt, keysOf, componentKey,
                                        normalizedOf: lib.normalizedOf, automation,
                                        focusedChild: input.focusedChild });

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
        tick() {
            cache.prefetch(seat.keys());
            cache.tick(); contract.tick();
            const land = seat.landing();
            if (land >= 0) ctl.goToPage(land, { remember: false });
        },
        get ready() { return contract.isReady(); },
        get ctl() { return ctl; },
        /* The SEAT's order, not the planner's: the bank bar and every caller
         * indexing pages count the jog movy actually runs. */
        get pageCount() { return seat.count(); },
        get pageIndex() { return seat.index(); },
        /* A jog without a seat is the controller's own `onJog`, unwarmed on
         * purpose (SP-39's ledger entry: its neighbour-prefetch lane keeps the
         * next page warm). A seat jog is a JUMP — the next page in movy's order
         * need not be the planner's neighbour — so it is warmed like a pad
         * jump. See `jog` in schwung-page-input.ts. */
        changePage(delta: number) { input.jog(delta > 0 ? 1 : -1); },
        goToPage(i: number) { ctl.goToPage(seat.realOf(i)); },
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
        marks: page.marks,
        animating,
        /* `enumPeek()` is also the reader that RETIRES an expired peek
         * (`page_controller.mjs` clears it past ENUM_PEEK_MS on the way out),
         * so asking the question is what keeps the answer honest as well as
         * what answers it. */
        peekOpen: () => (typeof ctl.enumPeek === 'function' ? !!ctl.enumPeek() : false),
        render: page.render,
        chrome: (paging: boolean) => chromeFor(ctl, lib, paging, seat.onBlock()),
        regularKnobAt: (slot: number) => regularKnob(ctl.metaAt ? ctl.metaAt(slot) : null, lib),
        knobTurn: input.knobTurn,
        knobTouch: input.knobTouch,
        click: input.click,
        back: input.back,
        focusVoice: input.focusVoice,
        focusWritten: focus.wrote,
        picker: (key: string) => (port.picker ? port.picker(qualify(key)) : null),
        canvasDive: (intent: SchwungIntent) => openCanvasDive(intent.fullKey || intent.key || '', intent.meta, {
            moduleId: () => String(cache.get(moduleReadKey(componentKey)) || ''),
            owner: `${trackIndex}:${componentKey}`,
            /* LIVE, as upstream's dive ctx is: a script vouches and reads back
             * in one hook (DR32's pad follow), which a cached read would miss. */
            read: (k: string) => port.getParam(qualify(k)),
            write: (k: string, v: string) => port.setParam(qualify(k), v),
            /* Upstream re-enters the grid on the way out (enterParamPages).
             * Here: re-read live, and re-ask the gates — a new engine changes
             * no contract byte, only which pages its gates admit. */
            closed: () => { contract.reload(); markGatesDue(ctl); },
        }),
        claimsBottomBand: () => claimsBottomBand(ctl, lib),
    };
}
