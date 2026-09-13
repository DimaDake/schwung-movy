/* schwung-page-render.ts — one render of the page Schwung planned.
 *
 * The decoration pass that marks a locked cell, the drawing context movy hands
 * the controller, and the param description movy's automation layer is built
 * from. Kept out of the binding because this is the half SP-16 (Cause G2) edits.
 */

import type { AutomationView } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { GRID_BODY_RECT } from './layout.js';

/* movy draws its own header, bank bar and footer; Schwung is asked for the
 * widgets between them.
 *
 * The bank bar used to be Schwung's, on the reasoning that it indexes param
 * pages and movy has no equivalent. Both halves were wrong. movy draws a bank
 * bar on these views unconditionally, so asking for one too STACKED TWO
 * full-width rules — the double bar seen on the device. And movy does have an
 * equivalent: `drawBankBar` just needs the numbers, which `pageCount` and
 * `pageIndex` already publish. So Schwung reports and movy draws, which keeps
 * one visual language for the bar and leaves movy composing it — on the chain
 * view it counts CHAIN SLOTS, which is what that view's jog moves and is not
 * Schwung's to overwrite. */
const BANDS = { header: false, bank: false, footer: false };

export interface PageRender {
    knobParamInfo(slot: number): any | null;
    render(title: string, auto?: AutomationView, touched?: number): void;
}

export function createPageRender(ctl: any, deps: {
    keyAt: (slot: number) => string | null;
    keysOf: () => (string | null)[];
    componentKey: string;
}): PageRender {
    const { keyAt, keysOf, componentKey } = deps;

    return {
        /*
         * THE LANE MUST TARGET SCHWUNG'S PARAMETER, not movy's.
         *
         * movy builds an automation lane from `model.getKnobParamInfo(k)` —
         * its OWN idea of which param knob k drives. Under Schwung pagination
         * that is a different parameter: the two planners put different keys in
         * the same cell (9 of them across the mock presets). Left alone, moving
         * a knob to create a lane would have bound the lane to whatever movy
         * thought was there, which is a silent mis-target rather than a visible
         * failure — the lane would work perfectly, on the wrong param.
         *
         * Shaped as movy's KnobParamInfo (store.ts) so the automation layer
         * needs no special case for where it came from.
         */
        knobParamInfo(slot: number) {
            const k = keyAt(slot);
            if (!k || !ctl.metaIndex) return null;
            const m = ctl.metaIndex.getOrGuess(k);
            if (!m) return null;
            const min = typeof m.min === 'number' ? m.min : 0;
            const max = typeof m.max === 'number' ? m.max : 1;
            const raw = ctl.state && ctl.state.values ? ctl.state.values[k] : undefined;
            const value = raw === undefined || raw === null ? min : parseFloat(String(raw));
            return {
                gi: slot,
                key: k,
                ioKey: k,
                target: componentKey,
                value: isNaN(value) ? min : value,
                min, max,
                type: m.type || (m.kind === 'enum' ? 'enum' : 'float'),
                /* Same rule movy applies: a numeric range is automatable, a
                 * door or a trigger is not. */
                automatable: m.kind !== 'opaque' && !m.writeOnly && !m.readOnly
                             && typeof m.min === 'number' && typeof m.max === 'number',
            };
        },

        render(title: string, auto?: AutomationView, _touched = -1) {
            /* A lane with locks marks its cell. Asked BY PARAMETER, which is
             * what makes re-pagination harmless. */
            if (auto) {
                const decs = keysOf().map((k) => {
                    if (!k) return null;
                    const lane = auto.laneForKey(k as string);
                    const on = lane >= 0 && (auto.activeLanes & (1 << lane)) !== 0;
                    if (!on) return null;
                    /*
                     * ON A HELD STEP YOU LOOK AT WHAT THE STEP WILL PLAY, not
                     * at where the knob happens to be. movy has already
                     * resolved the held value per lane; passing only `locked`
                     * marked the cell and then drew the LIVE value underneath
                     * it, which is the one reading a parameter lock must not
                     * show. `decoration.value` is exactly this, and Schwung
                     * already prefers it over the live value.
                     */
                    const held = auto.held ? auto.heldValues.get(lane) : undefined;
                    return held === undefined ? { locked: true }
                                              : { locked: true, value: held };
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
            ctl.render(ctx, { title, bands: BANDS, rect: GRID_BODY_RECT });
            /*
             * THE OVERLAYS ARE THE CONTROLLER'S AND IT DRAWS THEM ITSELF — the
             * enum peek that shows a divable enum's whole list while you turn
             * it, and the section picker. It REFUSES to draw without a
             * clearScreen (an overlay interleaved with the grid beneath is two
             * screens at once), so omitting this argument is the same as having
             * no overlays at all — which is what movy had.
             */
            ctl.renderOverlays(ctx, { clearScreen: () => clear_screen() });
        },
    };
}
