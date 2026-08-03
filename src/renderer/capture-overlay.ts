import { fontPrint, fontWidth } from '../font/index.js';
import { fontPrintBig, fontWidthBig, BIG_FONT_HEIGHT } from '../font/big.js';
import { drawHeader } from './header.js';
import { W } from './layout.js';
import type { CaptureVM } from '../seq/capture-vm.js';

/* Post-capture overlay: the tempo candidates (or the fit that was forced on
 * us) in the same big font the Set page uses for TEMPO, so the number you are
 * choosing looks like the number you would have dialled.
 *
 * Full screen rather than a panel: the tempo decides how the take is heard, and
 * the values need the width — three three-digit tempos in the big font are
 * ~84 px before gutters. */

const GUTTER = 10;
const BOX_PAD = 2;
const VALUE_Y = 22;
/* The 5px font is ASCII-only, so the "played became this" arrow is drawn. */
const ARROW_W = 7;

function drawArrow(x: number, y: number): void {
    fill_rect(x, y + 2, ARROW_W, 1, 1);
    fill_rect(x + ARROW_W - 3, y + 1, 1, 3, 1);
    fill_rect(x + ARROW_W - 2, y, 1, 5, 1);
}

export function drawCaptureOverlay(vm: CaptureVM): void {
    clear_screen();
    drawHeader('CAPTURE', vm.header, true);

    const widths = vm.values.map(fontWidthBig);
    const arrowW = vm.pair ? ARROW_W + GUTTER : 0;
    const total = widths.reduce((a, b) => a + b, 0) + GUTTER * (widths.length - 1) + arrowW;
    let x = Math.max(0, Math.floor((W - total) / 2));

    for (let i = 0; i < vm.values.length; i++) {
        if (i > 0 && vm.pair) {
            drawArrow(x, VALUE_Y + Math.floor((BIG_FONT_HEIGHT - 5) / 2));
            x += ARROW_W + GUTTER;
        }
        if (i === vm.selIdx) {
            // Solid box, digits knocked out — the same inversion the header uses.
            fill_rect(x - BOX_PAD, VALUE_Y - BOX_PAD,
                      widths[i] + BOX_PAD * 2, BIG_FONT_HEIGHT + BOX_PAD * 2, 1);
            fontPrintBig(x, VALUE_Y, vm.values[i], 0);
        } else {
            fontPrintBig(x, VALUE_Y, vm.values[i], 1);
        }
        x += widths[i] + GUTTER;
    }

    fontPrint(Math.max(0, Math.floor((W - fontWidth(vm.caption)) / 2)), 50, vm.caption, 1);
}
