/* schwung-footer.ts — movy's footer rows, drawn with Schwung's own widget.
 *
 * THE WIDGET IS SCHWUNG'S, THE ROWS ARE MOVY'S. `drawFooter` sits at the
 * absolute rows 57..63 (`FOOTER_Y` 57, `FOOTER_H` 7) and draws nothing above
 * them, which is exactly the band movy leaves free under the body at y=10,
 * h=47 — the same six rows `TOAST_Y` 58 and the Loop strip live in. That
 * overlap is why the caller draws this LAST and only when nothing else has
 * claimed the row (see knob-view.ts).
 *
 * A SECOND FOOTER WIDGET WOULD BE THE WHOLE PROBLEM. The pill — a notched
 * inverted block holding the key, with the action plain beside it — is one
 * shape with one set of paddings, and the four characters that fit matter:
 * Schwung's own notes record a footer whose pairs silently dropped one because
 * PUSH is one pixel wider than FIRE on the proportional face. Borrowing the
 * drawer is how movy gets that arithmetic rather than re-measuring it.
 */
import { schwungLib } from './schwung-lib.js';
import { movyCtx } from './schwung-ctx.js';

export function drawPageFooter(hints: [string, string][]): void {
    if (!hints || !hints.length) return;
    schwungLib().drawFooter(movyCtx(), hints);
}
