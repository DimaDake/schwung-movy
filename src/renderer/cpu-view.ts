/* The CPU meter page: a capacity bar for the whole chain render, and one column
 * per track for what that track's chain costs per audio block — plus, once any
 * send bus holds a module, a column per bus at the right-hand end.
 *
 * There is deliberately NO horizontal reference line across the columns. A line
 * spanning all sixteen reads as a limit, and there is no per-track limit — the
 * only ceiling on this page is the capacity bar, which is where it belongs. */

import type { CpuColumn, CpuPageVM } from '../seq/cpu-page-vm.js';
import { FULL_SCALE_US, scaleLabel } from '../seq/cpu-scale.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { drawHeader } from './header.js';
import { drawDottedH, drawDottedV, hatchRect } from './primitives.js';
import { W } from './layout.js';
import { SEND_BUSES } from '../chain/config.js';

/* Rows 60-63 belong to the Loop Overview strip, which repaints every tick
 * outside the dirty-frame block. VIEW_CPU is excluded from it (app/tick.ts), so
 * the label row can sit at 58 — but nothing may go below 62. */
const BAR_Y = 8, BAR_H = 6;
const TOP = 17, BOT = 56;
const HGT = BOT - TOP;
const LABEL_Y = 58;

/** A column's width and the pitch it repeats at — the gutter is the difference,
 *  and every column on the page has exactly one. */
type Geometry = { pitch: number; colW: number };

/** Sixteen tracks and nothing else: 16 * 8 == W, to the pixel. */
const WIDE: Geometry = { pitch: 8, colW: 7 };

/** What the tracks give up so the send buses can have columns of their own.
 *  Sixteen at pitch 6 is 96 px, leaving a 9 px break and 24 px of sends. A
 *  break that wide next to 1 px gutters is what separates the two groups —
 *  there is no divider line, because on this screen the gap is louder. */
const NARROW: Geometry = { pitch: 6, colW: 5 };
const TRACKS_END = 16 * NARROW.pitch;

/** The sends keep the full-width geometry: there are three of them at most, the
 *  room exists, and a send read at a different width than a track would be hard
 *  to compare with one — which is the whole point of putting them on this page. */
const SEND_X = 104;
const SEND: Geometry = { pitch: 8, colW: 7 };

/** Pixels for `us` at the current scale, clamped to the plot. Exported so the
 *  scaling — and the repaint gate that quantises to it — share one definition. */
export function barPixels(us: number, scaleUs: number): number {
    return Math.min(HGT, Math.max(0, Math.round((us / scaleUs) * HGT)));
}

export function renderCpuView(vm: CpuPageVM): void {
    clear_screen();
    drawHeader('CPU', Math.round(vm.load * 100) + '%');
    drawCapacity(vm.load, vm.peakLoad);
    /* Two layouts, and only two: no send module anywhere, or the send region.
     * Which BUSES are filled never moves anything, so a bus keeps its column as
     * its neighbours come and go — the page re-lays-out when sends start being
     * used, not every time one is loaded. */
    const sends = vm.sends.length > 0;
    const g = sends ? NARROW : WIDE;
    drawFloorDatum(vm.scaleUs, g, sends);
    for (let i = 0; i < vm.columns.length && i < 16; i++) {
        drawColumn(i * g.pitch, g.colW, vm.columns[i], vm.scaleUs);
    }
    for (let n = 0; n < vm.sends.length; n++) {
        drawColumn(SEND_X + n * SEND.pitch, SEND.colW, vm.sends[n], vm.scaleUs);
    }
    /* Every fourth track, because a column cannot hold a two-digit label and a
     * ruler nobody can read is worse than a sparse one. The narrow layout drops
     * the last tick: `13` and the scale cannot both fit left of the send
     * region, and the scale is what tells you a column's height is worth
     * anything at all. */
    for (const n of sends ? [1, 5, 9] : [1, 5, 9, 13]) {
        fontPrint5x3((n - 1) * g.pitch, LABEL_Y, String(n), 1);
    }
    /* Named once for the group rather than numbered per bus: three columns after
     * a 9 px break would otherwise read as tracks 17 to 19. */
    if (sends) fontPrint5x3(SEND_X, LABEL_Y, 'SND', 1);
    /* The scale is not a constant any more — it grows to fit the set — so the
     * label is the only thing telling you what a column's height is worth. */
    const scale = scaleLabel(vm.scaleUs);
    fontPrint5x3((sends ? TRACKS_END : W) - fontWidth5x3(scale), LABEL_Y, scale, 1);
}

/* Where 1 ms sits.
 *
 * At the floor scale that is the top of the plot, and it stays there for any
 * normal set. Once a column has forced the scale up it drops, and the gap above
 * it is how much the plot has been squashed to fit — the rescale becomes
 * something you SEE rather than something you read off the label.
 *
 * Ticks in the 1 px column gutters, never a line through the bars. A line
 * spanning all sixteen columns reads as a ceiling, and this is a datum: there is
 * no per-track limit on this page.
 */
function drawFloorDatum(scaleUs: number, g: Geometry, sends: boolean): void {
    const y = BOT - barPixels(FULL_SCALE_US, scaleUs);
    for (let i = 0; i < 16; i++) fill_rect(i * g.pitch + g.colW, y, 1, 1, 1);
    if (!sends) return;
    // The sends read against the same datum, or their columns are heights with
    // nothing to measure them by.
    for (let n = 0; n < SEND_BUSES; n++) fill_rect(SEND_X + n * SEND.pitch + SEND.colW, y, 1, 1, 1);
}

/* The block, as a bar. Fill is what movy consumed; the notch is the worst block
 * since the page opened, held for as long as it stays open. The bar clamps at
 * full — the header's percentage is what reports an overrun. */
function drawCapacity(load: number, peak: number): void {
    fill_rect(0, BAR_Y, W, 1, 1);
    fill_rect(0, BAR_Y + BAR_H - 1, W, 1, 1);
    fill_rect(0, BAR_Y, 1, BAR_H, 1);
    fill_rect(W - 1, BAR_Y, 1, BAR_H, 1);
    const inner = W - 2;
    const fw = Math.round(Math.min(1, Math.max(0, load)) * inner);
    if (fw > 0) fill_rect(1, BAR_Y + 1, fw, BAR_H - 2, 1);
    const px = Math.min(1 + Math.round(Math.min(1, Math.max(0, peak)) * inner), W - 2);
    // Inverted inside the fill, lit outside it — one mark that reads either way.
    fill_rect(px, BAR_Y + 1, 1, BAR_H - 2, px < 1 + fw ? 0 : 1);
    fill_rect(px - 1, BAR_Y - 1, 3, 1, 1);
}

function drawColumn(x: number, colW: number, col: CpuColumn, scaleUs: number): void {
    if (col.kind === 'na') {
        // Not ours to measure. Blank would say the track is free.
        drawDottedV(x + (colW >> 1), TOP + 2, BOT);
        fill_rect(x, BOT, colW, 1, 1);
        return;
    }
    fill_rect(x, BOT, colW, 1, 1);           // the column exists, even unused
    if (col.kind === 'empty') return;
    if (col.kind === 'asleep') {
        // Loaded, silent, skipped: costing nothing right now, which is not the
        // same as nothing being here. Its HELD PEAK is still drawn below —
        // a chain that spiked and then went quiet is the exact case someone
        // opens this page for, and the dash alone would hide the evidence.
        fill_rect(x + ((colW - 3) >> 1), BOT - 3, 3, 1, 1);
    }

    const sH = col.kind === 'asleep' ? 0 : barPixels(col.synthUs, scaleUs);
    const fH = col.kind === 'asleep'
        ? 0 : Math.min(HGT - sH, barPixels(col.totalUs - col.synthUs, scaleUs));
    /* A send has no synth stage, so `synthUs` is 0 and the whole of its column
     * comes out hatched — which is exactly what a bus is: an FX pass. */
    if (sH > 0) fill_rect(x, BOT - sH, colW, sH, 1);
    if (fH > 0) hatchRect(x, BOT - sH - fH, colW, fH, 1);
    /* Off the top of the plot. Only reachable past the top of the scale ladder
     * — `scaleFor` fits every column below that — but the PEAK has to be
     * checked too, not just the bar: a load spike lands in the held peak while
     * the mean stays low, and without this its line would clamp to the top row
     * and read as an ordinary peak sitting at full scale.
     *
     * Detached cap: a gap under a solid line, which reads over the solid synth
     * and the checkered FX alike. */
    if (col.totalUs > scaleUs || col.peakUs > scaleUs) {
        fill_rect(x, TOP + 1, colW, 1, 0);
        fill_rect(x, TOP, colW, 1, 1);
    }
    if (col.peakUs > 0) {
        drawDottedH(x, x + colW - 1, BOT - barPixels(col.peakUs, scaleUs));
    }
}
