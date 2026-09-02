/* The CPU meter page: a capacity bar for the whole chain render, and one column
 * per track for what that track's chain costs per audio block.
 *
 * There is deliberately NO horizontal reference line across the columns. A line
 * spanning all sixteen reads as a limit, and there is no per-track limit — the
 * only ceiling on this page is the capacity bar, which is where it belongs. */

import type { CpuColumn, CpuPageVM } from '../seq/cpu-page-vm.js';
import { scaleLabel } from '../seq/cpu-page-vm.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { drawHeader } from './header.js';
import { drawDottedH, drawDottedV, hatchRect } from './primitives.js';
import { W } from './layout.js';

/* Rows 60-63 belong to the Loop Overview strip, which repaints every tick
 * outside the dirty-frame block. VIEW_CPU is excluded from it (app/tick.ts), so
 * the label row can sit at 58 — but nothing may go below 62. */
const BAR_Y = 8, BAR_H = 6;
const TOP = 17, BOT = 56;
const HGT = BOT - TOP;
const LABEL_Y = 58;
const COL_W = 7;     // plus a 1 px gutter: 16 * 8 == W

/** Pixels for `us` at the current scale, clamped to the plot. Exported so the
 *  scaling — and the repaint gate that quantises to it — share one definition. */
export function barPixels(us: number, scaleUs: number): number {
    return Math.min(HGT, Math.max(0, Math.round((us / scaleUs) * HGT)));
}

export function renderCpuView(vm: CpuPageVM): void {
    clear_screen();
    drawHeader(vm.optimized ? 'CPU' : 'CPU OPT OFF', Math.round(vm.load * 100) + '%');
    drawCapacity(vm.load, vm.peakLoad);
    for (let i = 0; i < vm.columns.length && i < 16; i++) {
        drawColumn(i * 8, vm.columns[i], vm.scaleUs);
    }
    /* Every fourth track, because a 7 px column cannot hold a two-digit label
     * and a ruler nobody can read is worse than a sparse one. */
    for (const n of [1, 5, 9, 13]) fontPrint5x3((n - 1) * 8, LABEL_Y, String(n), 1);
    /* The scale is not a constant any more — it grows to fit the set — so the
     * label is the only thing telling you what a column's height is worth. */
    const scale = scaleLabel(vm.scaleUs);
    fontPrint5x3(W - fontWidth5x3(scale), LABEL_Y, scale, 1);
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

function drawColumn(x: number, col: CpuColumn, scaleUs: number): void {
    if (col.kind === 'na') {
        // Not ours to measure. Blank would say the track is free.
        drawDottedV(x + 3, TOP + 2, BOT);
        fill_rect(x, BOT, COL_W, 1, 1);
        return;
    }
    fill_rect(x, BOT, COL_W, 1, 1);          // the column exists, even unused
    if (col.kind === 'asleep') {
        // Loaded, silent, skipped: costing nothing right now, which is not the
        // same as nothing being here.
        fill_rect(x + 2, BOT - 3, 3, 1, 1);
        return;
    }
    if (col.kind === 'empty') return;

    const sH = barPixels(col.synthUs, scaleUs);
    const fH = Math.min(HGT - sH, barPixels(col.totalUs - col.synthUs, scaleUs));
    if (sH > 0) fill_rect(x, BOT - sH, COL_W, sH, 1);
    if (fH > 0) hatchRect(x, BOT - sH - fH, COL_W, fH, 1);
    /* Off the top of the plot. Only reachable past the top of the scale ladder
     * — `scaleFor` fits every column below that — but the PEAK has to be
     * checked too, not just the bar: a load spike lands in the held peak while
     * the mean stays low, and without this its line would clamp to the top row
     * and read as an ordinary peak sitting at full scale.
     *
     * Detached cap: a gap under a solid line, which reads over the solid synth
     * and the checkered FX alike. */
    if (col.totalUs > scaleUs || col.peakUs > scaleUs) {
        fill_rect(x, TOP + 1, COL_W, 1, 0);
        fill_rect(x, TOP, COL_W, 1, 1);
    }
    if (col.peakUs > 0) {
        drawDottedH(x, x + COL_W - 1, BOT - barPixels(col.peakUs, scaleUs));
    }
}
