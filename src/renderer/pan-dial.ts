import { CELL_W } from './layout.js';

/* A pan control, for stereo placement params (see model/pan.ts).
 *
 * Three marks: a dotted rail showing the travel, a 1px tick above its middle,
 * and a 6px bar filling OUT FROM THE CENTRE toward the panned side. Pan is the
 * one common param whose default is the middle rather than an end, and a bar
 * with a centre origin is the only one of movy's widgets where that middle is
 * a distinct picture instead of just another position along a sweep.
 *
 * The rail spans cx±PAN_HALF, not the cell. At ±13 it very nearly fills the
 * 32px cell, and a row of pan knobs — which is exactly what a drum module's
 * per-pad page is — merged its rails into one unbroken dotted line running the
 * width of the screen. ±11 keeps a 10px gutter, so each cell reads as its own.
 *
 * Horizontal, where the fader is vertical: the two share a visual language
 * (dotted scale, solid fill) and orientation is what tells them apart. */
const PAN_HALF = 11;

export function drawPanDial(cellX: number, ky: number, normVal: number): void {
    const cx = cellX + Math.floor(CELL_W / 2), cy = ky + 8;

    for (let x = cx - PAN_HALF; x <= cx + PAN_HALF; x += 2) fill_rect(x, cy + 5, 1, 1, 1);
    fill_rect(cx, cy - 7, 1, 3, 1);                  // centre detent

    const off = Math.max(-1, Math.min(1, (normVal - 0.5) * 2));
    const w = Math.round(Math.abs(off) * PAN_HALF);
    /* Centred draws the bar's 1px seed rather than nothing: an empty rail would
     * read as a knob that has not loaded, and the tick alone does not say which
     * of the two rows it belongs to. */
    if (w === 0)      fill_rect(cx, cy - 2, 1, 6, 1);
    else if (off < 0) fill_rect(cx - w, cy - 2, w + 1, 6, 1);
    else              fill_rect(cx, cy - 2, w + 1, 6, 1);
}
