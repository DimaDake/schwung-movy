/* schwung-page-render.ts — one render of the page Schwung planned.
 *
 * The drawing context movy hands the controller, the param description movy's
 * automation layer is built from, and the call that hands over the eight knob
 * LEDs. The decoration pass that marks a locked cell lives next door, in
 * `schwung-page-decorations.ts`; this file is the half SP-16 (Cause G2) edits
 * around it.
 */

import type { AutomationView } from '../types/viewmodel.js';
import { GRID_BODY_RECT } from './layout.js';
import { decorationsFor } from './schwung-page-decorations.js';
import { movyCtx } from './schwung-ctx.js';
import { isLfoComponent } from '../chain/config.js';
import { schwungLib, schwungLibAvailable } from './schwung-lib.js';
import { enumRawToIndex, enumUsesIndex } from '../model/enum-value.js';

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
    knobLevels(): (number | null)[];
    marks(): number;
    render(title: string, auto?: AutomationView, touched?: number): void;
}

/* An enum cell as an automation lane needs it: its options, the option the
 * cell shows now, and whether the module reads options BY NAME. Null for
 * anything that is not an enum of two or more options. The wire form is the
 * one Schwung has learned for this param when it has (`options_as_string`,
 * `wire_format`); before its first read it is inferred from the raw value the
 * same way (`enumUsesIndex` is that rule). */
function enumLane(m: any, raw: unknown): { options: string[]; index: number; wiresNames: boolean } | null {
    if (m.type !== 'enum' || !Array.isArray(m.options) || m.options.length < 2) return null;
    const options: string[] = m.options.map(String);
    const s = raw === undefined || raw === null ? null : String(raw);
    const wiresNames = !!m.options_as_string || m.wire_format === 'name'
        || (m.wire_format !== 'index' && s !== null && !enumUsesIndex(options, s));
    let index = 0;
    if (s !== null) {
        const lib = schwungLibAvailable() ? schwungLib() : null;
        const i = lib && lib.enumIndexOf ? lib.enumIndexOf(m, s) : enumRawToIndex(options, s);
        index = Math.max(0, Math.min(options.length - 1, typeof i === 'number' && i >= 0 ? i : 0));
    }
    return { options, index, wiresNames };
}

export function createPageRender(ctl: any, deps: {
    keyAt: (slot: number) => string | null;
    keysOf: () => (string | null)[];
    componentKey: string;
    normalizedOf: (meta: any, raw: any) => number | null;
}): PageRender {
    const { keyAt, keysOf, componentKey, normalizedOf } = deps;

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
            const raw = ctl.state && ctl.state.values ? ctl.state.values[k] : undefined;
            const enumOf = enumLane(m, raw);
            const min = enumOf ? 0 : (typeof m.min === 'number' ? m.min : 0);
            const max = enumOf ? enumOf.options.length - 1 : (typeof m.max === 'number' ? m.max : 1);
            const value = enumOf ? enumOf.index
                : (raw === undefined || raw === null ? min : parseFloat(String(raw)));
            return {
                gi: slot,
                key: k,
                ioKey: k,
                target: componentKey,
                value: isNaN(value) ? min : value,
                min, max,
                type: enumOf ? 'enum' : (m.type || (m.kind === 'enum' ? 'enum' : 'float')),
                ...(enumOf ? { options: enumOf.options, wiresNames: enumOf.wiresNames } : {}),
                /* Same rule movy applies: a numeric range or an enum with two
                 * or more options is automatable (D14), a door or a trigger is
                 * not — EXCEPT the LFO page (SP-55): its
                 * cells are real ranged params (so the generic rule below
                 * would say yes) but the movy model has always answered
                 * `automatable: false` for them (`lfo/inert.ts` — an LFO
                 * modulating another LFO's own knob has no engine support).
                 * `chain_params` carries no field schwung's own metaIndex
                 * would read as an override (checked: `param_meta.mjs` has
                 * no `automatable` key), so the component key is the one
                 * signal available here, same test `isMovyOwnComponent` uses.
                 * An inferred trigger is `writeOnly` in Schwung's meta, so a
                 * two-option ACTION never gets here as an enum lane. */
                automatable: !isLfoComponent(componentKey) && m.kind !== 'opaque'
                             && !m.writeOnly && !m.readOnly
                             && (enumOf !== null
                                 || (typeof m.min === 'number' && typeof m.max === 'number')),
            };
        },

        /*
         * THE EIGHT KNOB LEDS, AND THE REPAINT SIGNAL, FROM THE DRAWN CELLS.
         *
         * movy's LED row used to be lit from movy's own view model, which under
         * this page is a different set of parameters (design §3, symptom 5).
         * These are the values the page on screen is showing — and, because
         * movy's own per-tick refresh no longer dirties the model for a
         * delegated component, a change in them is now also the only thing that
         * asks for the frame back (app/page-poll.ts).
         *
         * `normalizedOf` is Schwung's, not a second copy: "how full is this
         * control, or unknown", which measures an enum across its OPTION LIST
         * and distinguishes unread from zero. A cell with nothing bound, or a
         * value not read back yet, is `null` — an unlit knob, which is the
         * honest reading of a cell that will do nothing if you turn it.
         *
         * A page with no knobs (a preset browser, an items list) has no keys,
         * so every entry is null and the row goes dark — the same answer
         * Schwung's own host gives it.
         */
        knobLevels() {
            const out: (number | null)[] = [null, null, null, null, null, null, null, null];
            if (!ctl.metaIndex) return out;
            const keys = keysOf();
            const live = ctl.state ? ctl.state.modValues : null;
            for (let slot = 0; slot < 8; slot++) {
                const k = keys[slot];
                if (!k) continue;
                /*
                 * THE DRIVEN VALUE WHERE THERE IS ONE, AND THAT IS WHAT MAKES
                 * THE MARK MOVE (SP-36).
                 *
                 * For a key movy reports as modulated — an LFO target, or now a
                 * parameter a lane is driving — `state.values` holds the BASE
                 * and stands still by design, while `state.modValues` carries
                 * the live one. Read only the base and this answer never
                 * changes while automation plays, so `app/page-poll.ts` sees
                 * nothing move and never asks for the frame back: the mark
                 * riding the arc would be drawn once and freeze. The same
                 * number lights the knob LED, where the live value is also the
                 * honest reading — the ring shows what the parameter IS doing,
                 * which is what it showed under movy's own renderer.
                 */
                const lv = live ? live[k] : undefined;
                const raw = lv !== undefined && lv !== null ? lv
                          : (ctl.state && ctl.state.values ? ctl.state.values[k] : null);
                out[slot] = normalizedOf(ctl.metaIndex.getOrGuess(k), raw) ?? null;
            }
            return out;
        },

        /*
         * WHICH CELLS WEAR A MODULATION OR LANE MARK, as one number: bit `slot`
         * for modulated, bit `8 + slot` for a lane.
         *
         * Read off the controller's CACHE, the thing the renderer draws from,
         * because that is what lags: a lane cleared under the hand is learnt on
         * the read rotation a few ticks after the gesture's own frame was drawn,
         * and none of the values move, so without this the dot stayed until
         * something else asked for a frame. `isAutomatedCached` is #541's —
         * absent, that half reads zero, as the mark itself does.
         */
        marks() {
            const keys = keysOf();
            let m = 0;
            for (let slot = 0; slot < 8; slot++) {
                const k = keys[slot];
                if (!k) continue;
                if (ctl.isModulatedCached && ctl.isModulatedCached(k)) m |= 1 << slot;
                if (ctl.isAutomatedCached && ctl.isAutomatedCached(k)) m |= 1 << (8 + slot);
            }
            return m;
        },

        render(title: string, auto?: AutomationView, _touched = -1) {
            ctl.setDecorations(decorationsFor(auto, keysOf()));

            const ctx = movyCtx();
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
