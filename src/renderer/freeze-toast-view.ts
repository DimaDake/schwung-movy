/* The big centred freeze toast (seq/freeze-toast.ts). Drawn over whatever is
 * on screen, like the leave dialog. Pure: same inputs, same pixels. */

import { fontPrint, fontWidth } from '../font/index.js';
import { W } from './layout.js';

export function drawFreezeToast(trackLabel: string): void {
    const lines = [`${trackLabel} IS FROZEN`, 'SHIFT + TRACK', 'TO UNFREEZE'];
    const boxW = 100, boxH = 31;
    const x = Math.floor((W - boxW) / 2);
    const y = 17;
    fill_rect(x - 1, y - 1, boxW + 2, boxH + 2, 1);
    fill_rect(x, y, boxW, boxH, 0);
    // The headline inverted, the way out under it.
    fill_rect(x + 2, y + 2, boxW - 4, 9, 1);
    fontPrint(x + Math.floor((boxW - fontWidth(lines[0])) / 2), y + 4, lines[0], 0);
    fontPrint(x + Math.floor((boxW - fontWidth(lines[1])) / 2), y + 15, lines[1], 1);
    fontPrint(x + Math.floor((boxW - fontWidth(lines[2])) / 2), y + 23, lines[2], 1);
}
