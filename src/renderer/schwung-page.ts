/* schwung-page.ts — Schwung plans the pages, Schwung draws them, movy targets
 * the PARAMETERS.
 *
 * The step past schwung-body.ts. That one fed Schwung movy's own view model, so
 * movy still decided what was on the page and where; this owns the whole grid:
 * the page set comes from Schwung's planner, the widgets from Schwung's
 * renderer, and movy's only question of it is "which parameter is knob N right
 * now" — `keyAt`.
 *
 * WHY THAT IS SAFE FOR THE SEQUENCER, which was the open worry.
 *
 * An automation lane stores `targetParam`, a component-qualified param key
 * (app/tick.ts builds `componentKey + ':' + concreteKey(...)` and the registry
 * is searched by that string). Lanes are NOT addressed by page and slot — slot
 * appears only as the transient input coordinate of the gesture that created
 * one. So re-paginating moves no lane: the lane follows its parameter onto
 * whatever page Schwung puts it on, and a lane whose parameter is not on the
 * current page simply matches nothing and shows no dot, which is the same rule
 * the drum-pad scoping already relies on.
 *
 * This matters because Schwung's page set is NOT movy's. Schwung paginates
 * overflow — `knobs[]` is the author's chosen eight, not their parameter set,
 * and rendering only those hides ~28% of the fleet's declared params — so a
 * module has more Schwung pages than movy pages, and a parameter can sit at a
 * different slot on a differently-numbered page. Measured on the shared mock
 * presets, 7 of 18 comparable pages already disagreed about their contents.
 *
 * NO DEVICE READ HAPPENS ON THE DRAW PATH. Values are read once per reload and
 * refreshed by `poll()` one key at a time — a param read is a full round trip
 * on a host track, and eight per frame is what movy measured at ~186 ms per
 * cycle.
 */

import { fontPrint, fontWidth } from '../font/index.js';
import type { TrackPort } from '../track/port.js';
import type { AutomationView } from '../types/viewmodel.js';

// @ts-ignore — absolute device path; external in the device build, aliased locally
import { planPages, PAGE_KNOBS } from '/data/UserData/schwung/shared/param_pages/page_plan.mjs';
// @ts-ignore
import { buildMetaIndex } from '/data/UserData/schwung/shared/param_pages/param_meta.mjs';
// @ts-ignore
import { renderPageMovy } from '/data/UserData/schwung/shared/param_pages/render_page_movy.mjs';
// @ts-ignore
import { resolveViz } from '/data/UserData/schwung/shared/param_pages/viz.mjs';

function parse(s: string | null): any {
    if (s === null || s === undefined || s === '') return null;
    try { return JSON.parse(s); } catch { return null; }
}

export interface SchwungPage {
    reload(): void;
    poll(): void;
    readonly pageCount: number;
    readonly pageIndex: number;
    changePage(delta: number): void;
    goToPage(i: number): void;
    /** Which Schwung parameter knob `slot` drives right now, bare key or null. */
    keyAt(slot: number): string | null;
    /** Same, component-qualified — the form a lane's targetParam takes. */
    targetAt(slot: number): string | null;
    /** The declared LABEL at that slot. movy names a cell by its label and
     *  Schwung addresses it by key, so comparing the two layouts needs this;
     *  key.toUpperCase() is not the label (`filter_cutoff` is "Cutoff"). */
    labelAt(slot: number): string | null;
    render(title: string, auto?: AutomationView, touched?: number): void;
    readonly ready: boolean;
}

export function createSchwungPage(port: TrackPort, componentKey = 'synth'): SchwungPage {
    let pages: any[] = [];
    let metaIndex: any = null;
    let index = 0;
    let values: Record<string, any> = {};
    let cursor = 0;
    /* A contract read that FAILED is not a module with no parameters. Schwung's
     * planner takes `unresolved` for exactly this and returns no pages rather
     * than inventing a plan from the fallback — collapsing the two is what put
     * granny's sample_path on knob 1. */
    let unresolved = false;

    const qualify = (k: string) => componentKey + ':' + k;

    function reload(): void {
        const rawHier = port.getParam(qualify('ui_hierarchy'));
        unresolved = (rawHier === null || rawHier === undefined);
        const hierarchy = unresolved ? null : parse(rawHier);
        const chainParams = unresolved ? null : parse(port.getParam(qualify('chain_params')));

        const planned = planPages({ hierarchy, chainParams, mode: null, visible: null, unresolved });
        pages = (planned && planned.pages) || [];
        metaIndex = buildMetaIndex({ hierarchy, chainParams });
        if (index >= pages.length) index = Math.max(0, pages.length - 1);
        values = {};
        cursor = 0;
        /* Warm the page that is about to be drawn, so it does not appear one
         * value per frame. Bounded to the visible eight. */
        for (const k of currentKeys()) if (k) readKey(k);
    }

    function currentKeys(): (string | null)[] {
        const p = pages[index];
        if (!p || p.kind !== PAGE_KNOBS || !Array.isArray(p.keys)) return [];
        return p.keys;
    }

    function readKey(k: string): void {
        const v = port.getParam(qualify(k));
        if (v !== null && v !== undefined) values[k] = v;
    }

    /* One read per call, round-robin over the visible cells. */
    function poll(): void {
        const keys = currentKeys().filter(Boolean) as string[];
        if (!keys.length) return;
        cursor = (cursor + 1) % keys.length;
        readKey(keys[cursor]);
    }

    function keyAt(slot: number): string | null {
        const keys = currentKeys();
        return (keys[slot] as string) || null;
    }

    function render(title: string, auto?: AutomationView, touched = -1): void {
        const p = pages[index];
        if (!p) return;

        const keys = currentKeys();
        const decorations: (null | { locked: boolean })[] = [];
        let anyLock = false;
        for (const k of keys) {
            if (!k || !auto) { decorations.push(null); continue; }
            /* Lanes are keyed by PARAMETER, so this asks the same question movy
             * asks of its own grid — it just asks it about Schwung's key. */
            const lane = auto.laneForKey(k);
            const on = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
            if (on) anyLock = true;
            decorations.push(on ? { locked: true } : null);
        }

        const ctx = {
            fillRect: (x: number, y: number, w: number, h: number, c: any) =>
                fill_rect(x, y, w, h, c ? 1 : 0),
            print: (x: number, y: number, t: string, c: any) => fontPrint(x, y, t, c ? 1 : 0),
            textWidth: (t: string) => fontWidth(t),
        };

        /* Graphics stand down while p-locks are live: one picture across four
         * cells cannot say which of them is locked. Schwung's own controller
         * applies this rule; there is no controller on this path. */
        const viz = (anyLock || p.kind !== PAGE_KNOBS)
            ? []
            : resolveViz({ keys: keys || [], metaIndex }).groups;

        renderPageMovy(ctx, {
            page: p, metaIndex, values,
            title,
            pageIndex: index,
            pageCount: Math.max(1, pages.length),
            touched,
            decorations: decorations.some(Boolean) ? decorations : null,
            viz,
        });
    }

    return {
        reload, poll,
        get pageCount() { return pages.length; },
        get pageIndex() { return index; },
        get ready() { return !unresolved && pages.length > 0; },
        changePage(delta: number) {
            if (!pages.length) return;
            index = (index + delta) % pages.length;
            if (index < 0) index += pages.length;
            for (const k of currentKeys()) if (k) readKey(k);
        },
        goToPage(i: number) {
            if (!pages.length) return;
            index = Math.max(0, Math.min(pages.length - 1, i));
            for (const k of currentKeys()) if (k) readKey(k);
        },
        keyAt,
        targetAt: (slot: number) => { const k = keyAt(slot); return k ? qualify(k) : null; },
        labelAt: (slot: number) => {
            const k = keyAt(slot);
            if (!k || !metaIndex) return null;
            const m = metaIndex.getOrGuess(k);
            return String((m && (m.label || m.key)) || k);
        },
        render,
    };
}
