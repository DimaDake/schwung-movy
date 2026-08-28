import type { FlagsPageVM } from '../seq/flags-page-vm.js';
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { wrapWords } from './wrap.js';
import { W, HEADER_H } from './layout.js';

const ROW_H    = FONT_HEIGHT + 2;

/* The band at the bottom that explains the selected row. A settings name has to
 * fit a row next to its value, which is never enough room to say what the
 * setting does — and this page is the only place a user meets these. */
export const HINT_LINES = 2;
export const HINT_W     = W - 4;
const HINT_TOP = 64 - HINT_LINES * ROW_H;

const LIST_TOP = HEADER_H + 2;
const LIST_BOT = HINT_TOP - 2;

/** Rows that fit — exported so the scroll window can be asserted without
 *  rendering. */
export const VISIBLE_ROWS = Math.floor((LIST_BOT - LIST_TOP) / ROW_H);

/** First row drawn, given the selection. Keeps the selection centred until the
 *  list runs out at either end, exactly as the file browser does — the two are
 *  the same gesture and must not scroll differently. */
export function firstVisibleRow(selected: number, count: number): number {
    const half = Math.floor(VISIBLE_ROWS / 2);
    return Math.max(0, Math.min(selected - half, count - VISIBLE_ROWS));
}

export function renderFlagsView(vm: FlagsPageVM): void {
    clear_screen();
    drawHeader('SETTINGS', null, true);

    if (vm.rows.length === 0) {
        fontPrint(2, LIST_TOP, 'No settings', 1);
        return;
    }

    drawHint(vm.hint);

    const start = firstVisibleRow(vm.selected, vm.rows.length);
    for (let i = 0; i < VISIBLE_ROWS; i++) {
        const idx = start + i;
        if (idx >= vm.rows.length) break;
        const row = vm.rows[idx];
        const y   = LIST_TOP + i * ROW_H;
        // Inverted band for the selection, so the name and the value are both
        // legible on it — a caret would have to sit in the name column and eat
        // the space the longer flag names need.
        const fg = row.selected ? 0 : 1;
        if (row.selected) fill_rect(0, y - 1, W, ROW_H, 1);
        fontPrint(2, y, row.name, fg);
        fontPrint(W - fontWidth(row.value) - 2, y, row.value, fg);
    }
}

/* Drawn before the rows, so a list long enough to reach the band is covered by
 * it rather than the other way round — the explanation is the part a reader
 * needs whole. */
function drawHint(hint: string): void {
    /* A rule, because the selection band is a filled rectangle and can sit
     * directly above this — without it the explanation reads as one more row,
     * inverted or not. */
    fill_rect(0, HINT_TOP - 2, W, 1, 1);
    const lines = wrapWords(hint, HINT_W);
    for (let i = 0; i < HINT_LINES && i < lines.length; i++) {
        fontPrint(2, HINT_TOP + i * ROW_H, lines[i], 1);
    }
}
