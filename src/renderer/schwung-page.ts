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
 * The four things this file used to hold inline have their own modules now: the
 * injected I/O (`schwung-page-io`), the contract lifecycle and its retry budget
 * (`schwung-page-contract`), the render path (`schwung-page-render`) and the
 * gestures forwarded to the controller (`schwung-page-input`). What is left
 * here is the binding and the surface it publishes.
 */

import type { TrackPort } from '../track/port.js';
import type { AutomationView } from '../types/viewmodel.js';
import { schwungLib } from './schwung-lib.js';
import { createPageIo } from './schwung-page-io.js';
import { createPageReadCache } from './schwung-page-cache.js';
import { createPageHierarchy } from './schwung-page-hierarchy.js';
import { createPageContract } from './schwung-page-contract.js';
import { createPageRender } from './schwung-page-render.js';
import { createPageInput } from './schwung-page-input.js';
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
    const ctl = lib.createController(createPageIo(port, qualify, cache, hier, componentKey,
        modulatedOf ? () => modulatedOf(port.track.index, componentKey) : null));
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
    const input = createPageInput(ctl, lib, port, qualify, hier);

    /* RESOLVED ONCE, at binding time, and guarded — see `SchwungLib.settled`.
     * An older Schwung without either answers `animating` false, which is
     * precisely how the page behaved before SP-38, so the missing predicate
     * costs the feature rather than the tool. */
    const animSettled = typeof lib.settled === 'function' ? lib.settled : null;
    const bangPhase = typeof lib.buttonPhase === 'function' ? lib.buttonPhase : null;

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
        animating(nowMs: number) {
            /* 1. A WIDGET TRANSITION. `ctl.state.anim` is the store the
             * renderer feeds (`page_controller.mjs` passes `anim: s.anim` and
             * `nowMs: now()` into every draw), so `settled` here and the
             * renderer's own observation are the same map read by the same
             * rule — movy never needs to build the store, only to ask it.
             *
             * A STILL PAGE COSTS NOTHING HERE: `observe` stamps a FIRST sighting
             * as already past, so once a page has been drawn its map holds only
             * transitions that have started since, and an idle page iterates an
             * empty map. */
            if (animSettled && !animSettled(ctl.state && ctl.state.anim, nowMs)) return true;
            /* 2. THE TRIGGER BANG, which is time-driven the same way and has no
             * value change to announce it. The list is passed to `buttonPhase`
             * exactly as the renderer passes it (`render_page_movy.mjs:2617`),
             * so the flash duration is asked of its one definition rather than
             * restated — and `BTN_FLASH_MS` moving upstream moves both.
             *
             * The map only holds keys that have FIRED, so a page that has never
             * fired a trigger allocates nothing and loops zero times. */
            const fired = bangPhase && ctl.triggerFiredAt;
            if (!fired) return false;
            for (const k in fired) {
                const stamps = fired[k];
                if (stamps && stamps.length && bangPhase(stamps, nowMs, false).bursts.length) return true;
            }
            return false;
        },
        render: page.render,
        chrome: (paging: boolean) => chromeFor(ctl, lib, paging),
        knobTurn: input.knobTurn,
        knobTouch: input.knobTouch,
        click: input.click,
        back: input.back,
        focusVoice: input.focusVoice,
    };
}
