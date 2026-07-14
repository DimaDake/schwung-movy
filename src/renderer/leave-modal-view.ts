import { fontPrint, fontWidth } from '../font/index.js';
import { W } from './layout.js';

/* Centered "Leave Movy?" modal. Selected option is drawn inverted; a footer
 * hint shows the cancel affordance. Drawn over whatever is on screen. */
export function drawLeaveModal(labels: string[], sel: number): void {
    const boxW = 96, boxH = 46;
    const x = Math.floor((W - boxW) / 2);      // 16
    const y = 9;

    // Frame: filled black panel with a 1px white border.
    fill_rect(x - 1, y - 1, boxW + 2, boxH + 2, 1);
    fill_rect(x, y, boxW, boxH, 0);

    const title = 'Leave Movy?';
    fontPrint(x + Math.floor((boxW - fontWidth(title)) / 2), y + 3, title, 1);

    const ROW_H  = 11;
    const listTop = y + 14;
    for (let i = 0; i < labels.length; i++) {
        const ry = listTop + i * ROW_H;
        const tw = fontWidth(labels[i]);
        const tx = x + Math.floor((boxW - tw) / 2);
        if (i === sel) {
            fill_rect(x + 6, ry - 1, boxW - 12, ROW_H - 1, 1);
            fontPrint(tx, ry + 2, labels[i], 0);
        } else {
            fontPrint(tx, ry + 2, labels[i], 1);
        }
    }

    const foot = 'Back: cancel';
    fontPrint(x + Math.floor((boxW - fontWidth(foot)) / 2), y + boxH - 7, foot, 1);
}
