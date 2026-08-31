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
 */

import type { TrackPort } from '../track/port.js';
import type { AutomationView } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';

// @ts-ignore — absolute device path; external in the device build, aliased locally
import { createController, LAYOUT_MOVY } from '/data/UserData/schwung/shared/param_pages/page_controller.mjs';

/* movy draws its own header and footer, so Schwung is asked for everything
 * between them. The bank bar IS Schwung's: it indexes param pages, which is
 * what the jog moves through here, and movy has no equivalent of it. */
const BANDS = { header: false, bank: true, footer: false };

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
    render(title: string, auto?: AutomationView, touched?: number): void;
    knobTurn(slot: number, delta: number): void;
    knobTouch(slot: number, down: boolean): void;
    click(): void;
    readonly ready: boolean;
    /** The controller itself, for gestures this binding has not wired yet. */
    readonly ctl: any;
}

export function createSchwungPage(port: TrackPort, componentKey = 'synth'): SchwungPage {
    const qualify = (k: string) => (k.indexOf(':') >= 0 ? k : componentKey + ':' + k);

    /* Injected I/O — rule 1 of param_pages: the library does no param I/O, the
     * caller does every read and write. That is what keeps movy's port the one
     * thing talking to the track. */
    const ctl = createController({
        getParam: (k: string) => port.getParam(qualify(k)),
        setParam: (k: string, v: string) => { port.setParam(qualify(k), v); },
        /* movy has its own screen-reader path; nothing to say from here yet. */
        announce: () => {},
    });
    ctl.setLayout(LAYOUT_MOVY);

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

    function tick(): void {
        if (!loaded) {
            sinceRetry++;
            if (attempts < RETRY_LIMIT && sinceRetry >= RETRY_TICKS) {
                sinceRetry = 0; attempts++; reload();
            }
            if (!loaded) return;
        }
        ctl.reloadIfChanged();
        ctl.tick();                 /* exactly one get_param */
        refreshLoaded();            /* the module may have just left the slot */
    }

    function keysOf(): (string | null)[] {
        const p = ctl.page;
        return (p && Array.isArray(p.keys)) ? p.keys : [];
    }
    const keyAt = (slot: number) => (keysOf()[slot] as string) || null;

    return {
        reload, tick,
        get ready() { return loaded; },
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
        knobTurn: (slot: number, delta: number) => { ctl.onKnobTurn(slot, delta > 0 ? 1 : -1); },
        knobTouch: (slot: number, down: boolean) => { ctl.onKnobTouch(slot, down); },
        click: () => { ctl.onClick(); },

        render(title: string, auto?: AutomationView, _touched = -1) {
            /* A lane with locks marks its cell. Asked BY PARAMETER, which is
             * what makes re-pagination harmless. */
            if (auto) {
                const decs = keysOf().map((k) => {
                    if (!k) return null;
                    const lane = auto.laneForKey(k as string);
                    const on = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
                    return on ? { locked: true } : null;
                });
                ctl.setDecorations(decs.some(Boolean) ? decs : null);
            } else {
                ctl.setDecorations(null);
            }

            const ctx = {
                fillRect: (x: number, y: number, w: number, h: number, c: any) =>
                    fill_rect(x, y, w, h, c ? 1 : 0),
                print: (x: number, y: number, t: string, c: any) => fontPrint(x, y, t, c ? 1 : 0),
                textWidth: (t: string) => fontWidth(t),
            };
            /* No `footer` argument: movy draws its own. Every page kind honours
             * `bands` now that the controller's chrome is one definition. */
            ctl.render(ctx, { title, bands: BANDS });
        },
    };
}
