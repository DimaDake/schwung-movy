/* schwung-big-value.ts — movy's big-font cell, as a Schwung custom widget.
 *
 * A DELIBERATE EXCEPTION TO "NATIVE FIRST" (SP-57's ruling 1), and it is worth
 * saying why rather than leaving it to look like drift.
 *
 * Schwung HAS a big-number cell (`drawBigNumber`), and everywhere it can be
 * reached movy uses it — set TEMPO draws through it today, unchanged, because
 * `isCountedQuantity` recognises the name. It cannot be reached for the three
 * cells below, for two reasons that are both in upstream's code and neither of
 * which a host can argue with:
 *
 *   - `shouldDrawBigNumber` refuses `KIND_ENUM` outright, so a trig condition
 *     ("3:4") or a root note ("C#") can never draw big however it is declared;
 *   - the face is TWELVE GLYPHS, `0123456789+-` (`font_big_num.mjs`), so it
 *     cannot spell "54%" at all — `missingGlyphs` would refuse it.
 *
 * SU-18 is the general fix (a `display: "big"` declaration, the enum lift, and
 * the `% : / .` glyphs taken from the very atlas this file draws with) and it
 * is written up in `plans/su-16-19-upstream-page-bundle.md`. But it reaches a
 * device only when Schwung releases, and these cells read wrong TODAY against
 * the pages they replaced. So this draws them in movy's own face meanwhile.
 *
 * IT IS MEANT TO BE DELETED. When SU-18 ships, the three `viz` declarations
 * become `display: "big"`, this file goes, and the cells draw through Schwung's
 * own widget like every other cell on the page.
 *
 * THE TEXT IS THE CONTRACT'S, NOT A SECOND OPINION. An enum draws its option,
 * an int draws its number plus whatever unit the cell declared — the same
 * readings `formatValue` prints elsewhere, so the big cell and the held-knob
 * header cannot disagree about the same value.
 */

import { BIG_FONT_HEIGHT, fontPrintBig, fontWidthBig } from '../font/big.js';
import { registerWidget } from './schwung-widgets.js';

/** The kind a cell declares to draw this way. `custom:` is Schwung's reserved
 *  prefix for host widgets; an unregistered one degrades to the built-in
 *  rather than leaving a hole (`widget_registry.mjs`). */
export const BIG_VALUE_KIND = 'custom:movy_big_value';

/** What the cell shows: an enum's option text, else the number, plus the unit
 *  the contract declared (`viz.suffix`). Reads `meta.viz` because `normalize`
 *  spreads the chain entry whole — the declaration survives onto the meta,
 *  which is the only channel a single-cell group carries per-cell data on. */
function textFor(meta: any, raw: string | null): string {
    if (raw === null || raw === undefined || raw === '') return '--';
    const suffix = (meta && meta.viz && typeof meta.viz.suffix === 'string') ? meta.viz.suffix : '';
    const opts = meta && Array.isArray(meta.options) ? meta.options : null;
    if (opts) {
        const i = Math.round(Number(raw));
        return (isFinite(i) && i >= 0 && i < opts.length) ? String(opts[i]) : String(raw);
    }
    const n = Math.round(Number(raw));
    return (isFinite(n) ? String(n) : String(raw)) + suffix;
}

export function registerBigValueWidget(): void {
    registerWidget(BIG_VALUE_KIND, {
        draw(fctx: any, payload: any): void {
            const group = payload && payload.group;
            const key = group && (group.roles?.value ?? (group.keys && group.keys[0]));
            if (!key) return;
            const meta = payload.metaIndex ? payload.metaIndex.getOrGuess(key) : null;
            const raw = payload.values ? payload.values[key] : null;
            const text = textFor(meta, raw ?? null);

            /* Centred in the frame Schwung gave us, and drawn through the
             * frame's own fillRect — the global blitter would land in absolute
             * screen coordinates and escape this widget's clip. */
            const x = Math.max(0, Math.round((fctx.width - fontWidthBig(text)) / 2));
            const y = Math.max(0, Math.round((fctx.height - BIG_FONT_HEIGHT) / 2));
            fontPrintBig(x, y, text, 1,
                         (rx, ry, rw, rh, c) => fctx.fillRect(rx, ry, rw, rh, c));
        },
        nominal: { w: 28, h: BIG_FONT_HEIGHT },
    });
}
