import { fontPrint, fontWidth } from '../font/index.js';

/* Volume slider, drawn over whatever view is on screen while a volume-knob
 * gesture runs: hold-track+volume (mixer/track-volume.ts, the full 0-400% slot
 * range with a tick at unity, since boost is worth seeing coming) and, where
 * movy owns the knob, the master (mixer/master-volume.ts, topped at unity).
 * The travel is the knob's dB ladder, not raw amplitude — `frac`/`unityFrac`
 * come from the gesture so the mapping lives in one place. */

const BOX_X = 4, BOX_Y = 14, BOX_W = 120, BOX_H = 36;
const BAR_X = BOX_X + 6, BAR_W = BOX_W - 12, BAR_Y = BOX_Y + 14, BAR_H = 8;

export interface VolumeOverlayVM {
    title: string;
    value: number;      // linear amplitude, for the readouts
    frac: number;       // 0..1 fill position
    unityFrac: number;  // 0..1 position of the 100% mark
}

/* Gain readout. The field report was in dB ("goes silent around -8.5 dB"), and
 * dB is what the ladder steps in, so it leads; the percentage stays because it
 * is what schwung's own chain settings show for this param. */
function dbLabel(value: number): string {
    if (value <= 0) return '-inf';
    const db = 20 * Math.log10(value);
    return (db > 0 ? '+' : '') + db.toFixed(1);
}

export function drawVolumeOverlay(vm: VolumeOverlayVM): void {
    const { title, value } = vm;
    fill_rect(BOX_X, BOX_Y, BOX_W, BOX_H, 0);
    fill_rect(BOX_X, BOX_Y, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y + BOX_H - 1, BOX_W, 1, 1);
    fill_rect(BOX_X, BOX_Y, 1, BOX_H, 1);
    fill_rect(BOX_X + BOX_W - 1, BOX_Y, 1, BOX_H, 1);

    fontPrint(BOX_X + Math.floor((BOX_W - fontWidth(title)) / 2), BOX_Y + 4, title, 1);

    fill_rect(BAR_X, BAR_Y, BAR_W, BAR_H, 1);
    fill_rect(BAR_X + 1, BAR_Y + 1, BAR_W - 2, BAR_H - 2, 0);
    const fillW = Math.round((BAR_W - 2) * Math.min(1, Math.max(0, vm.frac)));
    if (fillW > 0) fill_rect(BAR_X + 1, BAR_Y + 1, fillW, BAR_H - 2, 1);

    /* Unity mark below the bar, at 100% on the same ladder as the fill. */
    fill_rect(BAR_X + 1 + Math.round((BAR_W - 2) * vm.unityFrac), BAR_Y + BAR_H, 1, 2, 1);

    const pct = Math.round(value * 100) + '%';
    fontPrint(BAR_X, BOX_Y + BOX_H - 8, pct, 1);
    const db = dbLabel(value) + ' dB';
    fontPrint(BOX_X + BOX_W - 5 - fontWidth(db), BOX_Y + BOX_H - 8, db, 1);
}
