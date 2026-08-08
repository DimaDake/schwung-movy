import { fontPrint, fontWidth } from '../font/index.js';
import { BIG_FONT_HEIGHT } from '../font/big.js';
import { drawHeader } from './header.js';
import { W } from './layout.js';
import { drawValueRow } from './value-row.js';
import type { CaptureVM } from '../seq/capture-vm.js';

/* Post-capture overlay: the tempo candidates (or the fit that was forced on
 * us) in the same big font the Set page uses for TEMPO, so the number you are
 * choosing looks like the number you would have dialled.
 *
 * Full screen rather than a panel: the tempo decides how the take is heard, and
 * the values need the width — three three-digit tempos in the big font are
 * ~84 px before gutters. */

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

    drawValueRow(vm.values, vm.selIdx, VALUE_Y,
        vm.pair ? { width: ARROW_W, draw: drawArrow } : undefined);

    fontPrint(Math.max(0, Math.floor((W - fontWidth(vm.caption)) / 2)), 50, vm.caption, 1);
}
