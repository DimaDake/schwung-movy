/* Move's hardware buttons as 5x5 glyphs, and the hint pill that holds one.
 *
 * A footer that NAMES a button makes the user translate a word into a
 * position; one that shows the button's own mark does not. Schwung has no
 * such glyphs (its footers name keys in text), so movy draws its own — kept
 * here, in one table, so they can be swapped for Schwung's if it grows some.
 *
 * The pill is Schwung's `drawFooter` shape (render_page_movy.mjs): an inverted
 * block with all four corners notched holding the key, the action plain beside
 * it, on the absolute footer rows 57..63. */

import { fontPrint, fontWidth } from '../font/index.js';

export type ButtonIcon = 'capture' | 'copy' | 'delete';

const ICONS: Record<ButtonIcon, string[]> = {
    /* Shapes from the Move manual's button figures (Capture p.87, Copy p.45).
     * Capture: four corner brackets, a viewfinder. */
    capture: ['##.##', '#...#', '.....', '#...#', '##.##'],
    /* Copy: a small square, with the open corner of the one behind it. */
    copy:    ['..###', '....#', '###.#', '#.#..', '###..'],
    /* Delete: the cross. */
    delete:  ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
};

export const ICON_W = 5;
export const FOOTER_Y = 57;
export const FOOTER_H = 7;
const PAD = 2;        // inside the pill, either side of the icon
const GAP = 2;        // pill to its action word
const SPACING = 5;    // one pair to the next

export function drawButtonIcon(x: number, y: number, icon: ButtonIcon, color: number): void {
    const rows = ICONS[icon];
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            if (rows[r][c] === '#') fill_rect(x + c, y + r, 1, 1, color);
        }
    }
}

/** Width of one icon pill plus its action word. */
export function iconHintWidth(action: string): number {
    return ICON_W + PAD * 2 + GAP + fontWidth(action);
}

/** One footer row of icon pills, left to right; returns the x after the last. */
export function drawIconFooter(hints: [ButtonIcon, string][], x = 1): number {
    fill_rect(0, FOOTER_Y, 128, FOOTER_H, 0);
    for (const [icon, action] of hints) {
        const pw = ICON_W + PAD * 2;
        fill_rect(x, FOOTER_Y, pw, FOOTER_H, 1);
        for (const [cx, cy] of [[x, FOOTER_Y], [x + pw - 1, FOOTER_Y],
                                [x, FOOTER_Y + FOOTER_H - 1], [x + pw - 1, FOOTER_Y + FOOTER_H - 1]]) {
            fill_rect(cx, cy, 1, 1, 0);
        }
        drawButtonIcon(x + PAD, FOOTER_Y + 1, icon, 0);
        fontPrint(x + pw + GAP, FOOTER_Y + 1, action, 1);
        x += iconHintWidth(action) + SPACING;
    }
    return x;
}
