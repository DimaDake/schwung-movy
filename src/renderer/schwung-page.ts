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
import { createPageContract } from './schwung-page-contract.js';
import { createPageRender } from './schwung-page-render.js';
import { createPageInput } from './schwung-page-input.js';

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
    render(title: string, auto?: AutomationView, touched?: number): void;
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

export function createSchwungPage(port: TrackPort, componentKey = 'synth'): SchwungPage {
    const qualify = (k: string) => (k.indexOf(':') >= 0 ? k : componentKey + ':' + k);

    const lib = schwungLib();
    const ctl = lib.createController(createPageIo(port, qualify));
    ctl.setLayout(lib.LAYOUT_MOVY);

    /* The controller's own view of the page it is showing. Both the binding's
     * key accessors and the render path read it, so it is defined once here and
     * handed to whichever module needs it. */
    function keysOf(): (string | null)[] {
        const p = ctl.page;
        return (p && Array.isArray(p.keys)) ? p.keys : [];
    }
    const keyAt = (slot: number) => (keysOf()[slot] as string) || null;

    const contract = createPageContract(ctl, port, componentKey);
    const page = createPageRender(ctl, { keyAt, keysOf, componentKey,
                                        normalizedOf: lib.normalizedOf });
    const input = createPageInput(ctl, lib, port, qualify);

    return {
        reload: contract.reload, tick: contract.tick,
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
        render: page.render,
        knobTurn: input.knobTurn,
        knobTouch: input.knobTouch,
        click: input.click,
        back: input.back,
        focusVoice: input.focusVoice,
    };
}
