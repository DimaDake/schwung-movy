import { fontPrint, fontWidth } from '../font/index.js';

/* Track-volume slider, drawn over whatever view is on screen while the gesture
 * runs. Spans the full schwung slot range (0-400%) with a tick at unity, since
 * anything above 100% is boost and worth seeing coming. */

const BOX_X = 4, BOX_Y = 14, BOX_W = 120, BOX_H = 36;
const BAR_X = BOX_X + 6, BAR_W = BOX_W - 12, BAR_Y = BOX_Y + 14, BAR_H = 8;
const VOL_MAX = 4;

export function drawVolumeOverlay(track: number, value: number): void {
    fill_rect(BOX_X, BOX_Y, BOX_W, BOX_H, 0);
    fill_rect(BOX_X, BOX_Y, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y + BOX_H - 1, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y, 1, BOX_H, 1);
    fill_rect(BOX_X + BOX_W - 1, BOX_Y, 1, BOX_H, 1);

    const title = 'T' + (track + 1) + ' VOLUME';
    fontPrint(BOX_X + Math.floor((BOX_W - fontWidth(title)) / 2), BOX_Y + 4, title, 1);

    fill_rect(BAR_X, BAR_Y, BAR_W, BAR_H, 1);
    fill_rect(BAR_X + 1, BAR_Y + 1, BAR_W - 2, BAR_H - 2, 0);
    const frac  = Math.min(1, Math.max(0, value / VOL_MAX));
    const fillW = Math.round((BAR_W - 2) * frac);
    if (fillW > 0) fill_rect(BAR_X + 1, BAR_Y + 1, fillW, BAR_H - 2, 1);

    /* Unity mark below the bar — 1.0 of 4.0 sits at a quarter of the span. */
    fill_rect(BAR_X + 1 + Math.round((BAR_W - 2) * 0.25), BAR_Y + BAR_H, 1, 2, 1);

    const pct = Math.round(value * 100) + '%';
    fontPrint(BOX_X + BOX_W - 5 - fontWidth(pct), BOX_Y + BOX_H - 8, pct, 1);
}
