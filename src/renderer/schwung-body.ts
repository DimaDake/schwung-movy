/* schwung-body.ts — draw movy's knob body with SCHWUNG's widgets.
 *
 * The substitution is exactly one call: renderKnobsView draws movy's header and
 * bank bar, then hands the body band to this instead of drawKnobParams. Schwung
 * exposes that as a band selection — `bands: { header: false, bank: false,
 * footer: false }` plus a rect — so movy keeps its own chrome and inherits only
 * the widgets.
 *
 * WHAT CROSSES THE SEAM IS MOVY'S VIEW MODEL, NOT MOVY'S PORT.
 *
 * This adapter reads nothing from the device and re-plans nothing. It takes the
 * ViewModel movy's own model already built — the rows, the values, the enum
 * options, the automation flags — and expresses it in the shape Schwung's
 * renderer consumes. movy stays the source of truth for WHAT is on the page and
 * WHICH page it is; Schwung decides only how a cell looks.
 *
 * That is deliberate. Schwung paginates overflow (its `knobs[]` is not the
 * author's chosen eight) so letting IT plan would move parameters between pages
 * and cells — and movy addresses parameter locks by page and slot, so that is a
 * data change, not a restyle. Feeding it movy's page sidesteps the question
 * entirely for now; see docs/plans/2026-08-28-param-pages-embeddable.md in the
 * schwung repo.
 *
 * The sequencer reaches the grid through `decorations`, Schwung's per-slot
 * { value, locked }: a lane with locks marks its cell, and on a held step the
 * locked value is what the widget shows.
 */

import type { ViewModel, ParamVM } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';

/* Schwung's shared library, by absolute device path — the same way movy already
 * imports constants.mjs and input_filter.mjs, and already marked external in
 * build/device.mjs. */
// @ts-ignore — resolved on device / aliased in the local build
import { renderPageMovy, BAND_H } from '/data/UserData/schwung/shared/param_pages/render_page_movy.mjs';

/* The body band movy hands over: below its header + bank bar, above its footer
 * row. Schwung's body is a fixed 48 rows (two gutters, two 15-row widget bands,
 * two 7-row label bands) and none of it scales, so this is not a free choice —
 * it is the only rect that fits. */
export const BODY_Y = 8;
export const BODY_H = 48;

const KIND_NUMBER = 'number';
const KIND_ENUM   = 'enum';
const KIND_OPAQUE = 'opaque';

/* movy's renderStyle -> the classification Schwung's widget rule reads.
 *
 * Schwung decides its widget from meta.kind + writeOnly (widgetKindFor), so the
 * mapping is onto those, not onto Schwung's widget names — the point is that
 * Schwung's own rule runs, not that we pick its widget for it. */
function metaFor(p: ParamVM, key: string): any {
    const style = p.renderStyle;
    const isEnum = p.type === 'enum' || style === 'switch' || style === 'hbar'
                || style === 'items' || (Array.isArray(p.options) && p.options.length > 0);
    const opaque = style === 'preset' || style === 'xbox';

    const meta: any = {
        key,
        label: p.fullName || p.shortName || key,
        kind: opaque ? KIND_OPAQUE : (isEnum ? KIND_ENUM : KIND_NUMBER),
        readOnly: false,
        /* A movy trigger is a one-shot badge, which is Schwung's write-only
         * bang. `trigger` is present only on those. */
        writeOnly: p.trigger !== undefined,
    };
    if (meta.kind === KIND_ENUM) {
        meta.options = p.options || [];
        meta.min = 0;
        meta.max = Math.max(0, (p.options?.length || 1) - 1);
        meta.step = 1;
        meta.type = 'enum';
    } else {
        /* Normalised, because that is the only numeric reading the VM carries;
         * the DISPLAYED text comes from movy verbatim through displayFor, so
         * the range never has to round-trip a unit. */
        meta.min = 0;
        meta.max = 1;
        meta.step = 0.001;
        meta.type = 'float';
    }
    return meta;
}

/**
 * @param vm      movy's view model for the current page
 * @param touched physical knob under a finger, or -1
 */
export function drawKnobParamsSchwung(vm: ViewModel, touched = -1): void {
    const cells: (ParamVM | null)[] = [];
    for (const row of (vm.rows || [])) {
        for (let i = 0; i < 4; i++) cells.push(row?.[i] ?? null);
    }

    /* Keys are synthetic: the VM carries no param key, and none is needed —
     * nothing here reads or writes a param, so a key is only an identity for
     * the metadata lookup and the value map. Slot-derived keeps them unique
     * even when two cells share a name. */
    const keys = cells.map((c, i) => (c ? `s${i}` : null));
    const metas: Record<string, any> = {};
    const values: Record<string, any> = {};
    const display: Record<string, string> = {};
    const decorations: (null | { value?: any; locked: boolean })[] = [];

    cells.forEach((c, i) => {
        if (!c) { decorations.push(null); return; }
        const key = `s${i}`;
        const meta = metaFor(c, key);
        metas[key] = meta;
        values[key] = meta.kind === KIND_ENUM
            ? (typeof c.enumIndex === 'number' && c.enumIndex >= 0 ? c.enumIndex : 0)
            : c.normalizedValue;
        display[key] = c.displayValue;

        /* THE SEQUENCER. A lane with locks marks the cell; movy has already
         * resolved a held step's value into the VM, so the value the widget
         * shows on a held step is the locked one without this adapter knowing
         * anything about lanes. */
        decorations.push((c.automated || c.assigned) ? { locked: true } : null);
    });

    const metaIndex = {
        get: (k: string) => metas[k] || null,
        getOrGuess: (k: string) => metas[k] || { key: k, label: k, kind: KIND_NUMBER,
                                                 min: 0, max: 1, step: 0.001, type: 'float' },
        keys: Object.keys(metas),
    };

    const ctx = {
        fillRect: (x: number, y: number, w: number, h: number, c: any) =>
            fill_rect(x, y, w, h, c ? 1 : 0),
        print: (x: number, y: number, t: string, c: any) => fontPrint(x, y, t, c ? 1 : 0),
        textWidth: (t: string) => fontWidth(t),
    };

    renderPageMovy(ctx, {
        page: { kind: 'knobs', name: vm.bankName || '', keys },
        metaIndex,
        values,
        /* movy's own reading of every value, verbatim — Schwung asks the host
         * for a formatted value and falls back to its own only when this
         * returns null. So units, enum spellings and "--" stay movy's. */
        displayFor: (k: string) => (k in display ? display[k] : null),
        title: '',
        pageIndex: vm.bankIndex | 0,
        pageCount: Math.max(1, vm.bankCount | 0),
        touched,
        decorations: decorations.some(Boolean) ? decorations : null,
        /* movy draws its own header, bank bar and footer; it is handing over
         * the widgets only. */
        bands: { header: false, bank: false, footer: false },
        rect: { x: 0, y: BODY_Y, w: 128, h: BODY_H },
        /* Graphics stand down while p-locks are live — one picture spanning
         * four cells cannot say which of them is locked. Schwung's controller
         * applies the same rule; this path has no controller, so it is applied
         * here. */
        viz: [],
    });
}

export { BAND_H };
