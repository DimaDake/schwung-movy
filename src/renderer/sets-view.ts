/* The SETS list: movy's own Sets, newest first, under a [NEW] action row.
 *
 * Row metrics and the centred scroll window are the settings list's — the
 * same gesture under the same wheel must scroll the same way. The bottom rows
 * are the icon footer, so this view is excluded from the Loop strip (tick.ts)
 * exactly as the CPU meter is. */

import type { SetsPageVM } from '../seq/sets-page-vm.js';
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { drawIconFooter, FOOTER_Y } from './button-icons.js';
import { W, HEADER_H } from './layout.js';

const ROW_H = FONT_HEIGHT + 2;
const LIST_TOP = HEADER_H + 2;
export const SETS_ROWS = Math.floor((FOOTER_Y - 1 - LIST_TOP) / ROW_H);
const CONFIRM_TOP = FOOTER_Y - 2 * ROW_H - 1;
const DOT = 3;

/** The longest prefix of `text` that fits in `w` pixels. */
function fit(text: string, w: number): string {
    let out = text;
    while (out.length > 0 && fontWidth(out) > w) out = out.slice(0, -1);
    return out;
}

function centre(y: number, text: string, color: number): void {
    fontPrint(Math.max(0, Math.floor((W - fontWidth(text)) / 2)), y, text, color);
}

export function firstSetsRow(selected: number, count: number): number {
    const half = Math.floor(SETS_ROWS / 2);
    return Math.max(0, Math.min(selected - half, count - SETS_ROWS));
}

export function renderSetsView(vm: SetsPageVM): void {
    clear_screen();
    drawHeader('SETS', null, true);
    if (vm.mode === 'move') {
        centre(22, 'SETS FOLLOW MOVE', 1);
        centre(22 + ROW_H + 2, 'SETTINGS > MOVY SETS', 1);
        return;
    }
    if (vm.mode === 'loading') {
        centre(26, 'READING SETS...', 1);
        return;
    }
    const first = firstSetsRow(vm.selected, vm.rows.length);
    for (let i = 0; i < SETS_ROWS && first + i < vm.rows.length; i++) {
        const r = vm.rows[first + i];
        const y = LIST_TOP + i * ROW_H;
        const sel = first + i === vm.selected;
        if (sel) fill_rect(0, y - 1, W, ROW_H, 1);
        const c = sel ? 0 : 1;
        /* The open Set's mark sits at the very end, like Schwung's list. */
        let right = W - 2;
        if (r.current) {
            fill_rect(right - DOT, y + 1, DOT, DOT, c);
            right -= DOT + 3;
        }
        /* The clip count only when it fits beside the WHOLE name: a count that
         * costs the name its end trades the thing you read for the thing you
         * glance at. */
        const withCount = right - fontWidth(r.clips) - 4 - 2;
        if (r.clips && fontWidth(r.name) <= withCount) {
            fontPrint(right - fontWidth(r.clips), y, r.clips, c);
            fontPrint(2, y, r.name, c);
        } else {
            fontPrint(2, y, fit(r.name, right - 4), c);
        }
    }
    if (vm.confirm) {
        fill_rect(0, CONFIRM_TOP - 1, W, 2 * ROW_H + 1, 0);
        centre(CONFIRM_TOP, fit(vm.confirm, W - 4), 1);
        centre(CONFIRM_TOP + ROW_H, 'JOG=DELETE BACK=CANCEL', 1);
    }
    drawIconFooter([['capture', 'RENAME'], ['copy', 'DUP'], ['delete', 'DEL']]);
}
