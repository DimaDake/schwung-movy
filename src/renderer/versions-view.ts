/* The BACKUPS list.
 *
 * Same row metrics and the same centred scroll window as the settings list —
 * they are the same gesture, and two lists that scroll differently under one
 * jog wheel is a bug the user feels before they can name it. */

import type { VersionsPageVM } from '../seq/versions-page-vm.js';
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { drawHeader } from './header.js';
import { firstVisibleRow } from './flags-view.js';
import { W, HEADER_H, TOAST_Y } from './layout.js';

const ROW_H = FONT_HEIGHT + 2;
const LIST_TOP = HEADER_H + 2;
/* Two lines above the toast band, for the confirm. Not the bottom of the
 * screen: tick.ts repaints the Loop Overview strip there every tick, outside
 * the dirty-frame block, and it would cut the second line in half. */
const FOOT_TOP = TOAST_Y - 2 * ROW_H;
/* This page's OWN row count. Borrowing the settings page's dropped a row that
 * fits: that list reserves a two-line hint band under itself, and this one
 * reserves those lines only while a confirm is up. */
export const VERSION_ROWS = Math.floor((TOAST_Y - 2 - LIST_TOP) / ROW_H);
/* Where the reason column starts. Fixed rather than measured so the three
 * columns line up down the list however long an individual label is. Set to
 * clear the widest age label — "YESTERDAY" (45px from x=2) ends at 47 — with a
 * two-pixel gap, otherwise a recent row reads "JUST NOWPRE-UNDO" as one word. */
const WHY_X = 49;

/** The longest prefix of `text` that fits in `w` pixels. */
function fit(text: string, w: number): string {
    let out = text;
    while (out.length > 0 && fontWidth(out) > w) out = out.slice(0, -1);
    return out;
}

function centre(y: number, text: string, color: number): void {
    fontPrint(Math.floor((W - fontWidth(text)) / 2), y, text, color);
}

export function renderVersionsView(vm: VersionsPageVM): void {
    clear_screen();
    drawHeader('BACKUPS', null, true);

    if (vm.empty) {
        centre(Math.floor(TOAST_Y / 2) - 3, 'NO BACKUPS YET', 1);
        return;
    }

    const first = firstVisibleRow(vm.selected, vm.rows.length);
    for (let i = 0; i < VERSION_ROWS && first + i < vm.rows.length; i++) {
        const r = vm.rows[first + i];
        const y = LIST_TOP + i * ROW_H;
        const sel = first + i === vm.selected;
        if (sel) fill_rect(0, y - 1, W, ROW_H, 1);
        const c = sel ? 0 : 1;
        fontPrint(2, y, r.age, c);
        /* Right-aligned, because the count is what the eye scans for when
         * hunting the version that still has the work in it. The asterisk is
         * SEQ ONLY — no room for the words, and the confirm spells it out. */
        const tail = r.seqOnly ? r.clips + '*' : r.clips;
        const tailX = W - 2 - fontWidth(tail);
        fontPrint(tailX, y, tail, c);
        /* Truncated to what is actually free, rather than trusted to fit. The
         * reason is the least load-bearing column — a longer label than the
         * screen has room for used to print straight THROUGH the clip count,
         * and a row that reads "BEFORE WIPE6 CLIPS" is worse than a clipped
         * word. */
        fontPrint(WHY_X, y, fit(r.why, tailX - 3 - WHY_X), c);
    }

    if (vm.confirming) {
        fill_rect(0, FOOT_TOP - 2, W, 2 * ROW_H + 3, 0);
        centre(FOOT_TOP, 'JOG=RESTORE BACK=CANCEL', 1);
        /* The honest half: Schwung's own four track slots live in Move's set
         * file, which movy cannot write. */
        centre(FOOT_TOP + ROW_H, 'SCHWUNG SLOTS NOT INCLUDED', 1);
    }
}
