export const W        = 128;
export const HEADER_H = 7;
export const BAR_Y    = 8;
export const BAR_H    = 2;
export const ROW0_Y   = 11;
export const LBL0_Y   = 27;
export const ROW1_Y   = 35;
export const LBL1_Y   = 51;
export const CELL_W   = 32;
export const LBL_H    = 7;
export const KW       = 16;
export const TOAST_Y  = 58;

/* WHERE an embedded Schwung grid goes — shared by `page` mode and by the off
 * stand-in, which is why it lives here and not beside either of them: three
 * copies of two numbers is how they came to disagree by 2 px.
 *
 * `bands` says WHAT to draw; this says WHERE, and they are not the same
 * question. movyBandLayout reflows ONLY when a rect is supplied
 * (`const reflow = !!o.rect`, render_page_movy.mjs), so passing none is not a
 * default — it leaves every band on Schwung's own vertical rhythm, which puts
 * widget row 0 at y=9, straight over movy's bank bar (BAR_Y 8 + BAR_H 2), and
 * leaves three dead rows under the last label.
 *
 * y=10 lands both widget rows exactly on ROW0_Y and ROW1_Y above, and ends the
 * body at 57 — one row above TOAST_Y. h=47 is not a choice: it is
 * gutter0+widget+label+gutter1+widget+label, the room a body needs.
 *
 * The LABEL rows still sit one row above movy's own (26/50 against LBL0_Y 27 /
 * LBL1_Y 51), because Schwung's widget band is 15 tall and movy's is 16. That
 * is not reachable from the rect and is deliberately not chased here. */
export const GRID_BODY_RECT = { x: 0, y: 10, w: W, h: 47 };
export const TOAST_H  = 6;

/* Horizontal extent for a graphic spanning `cellCount` cells from `startCol`.
 *
 * A graphic is inset one pixel wherever it meets ANOTHER cell, so two drawings
 * on the same line are separated by two pixels and never read as one shape —
 * but NOT at the screen edges, where there is nothing to separate from and the
 * inset only throws away resolution. Returns [x0, xEnd) — xEnd exclusive. */
export function spanX(startCol: number, cellCount: number): [number, number] {
    const first = startCol === 0;
    const last  = startCol + cellCount >= 4;
    return [
        first ? 0 : startCol * CELL_W + 1,
        last ? W : (startCol + cellCount) * CELL_W - 1,
    ];
}
