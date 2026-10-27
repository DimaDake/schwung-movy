/* The preview selector: `AI  ORIG  1  2  3` in the bottom band, the option
 * showing boxed (design §5.2). Drawn on the Loop strip's schedule, in its
 * place, so it costs nothing on a tick where neither it nor the view moved. */

import { drawBandLead, drawBandToken } from '../seq/render.js';
import { previewCount, previewIndex } from './preview.js';

const GAP = 8;
let drawn = '';

/** Pure: same index and count, same pixels. */
export function drawPreviewStrip(index: number, count: number): void {
    let x = drawBandLead('AI');
    const labels = ['ORIG', ...Array.from({ length: count }, (_, i) => String(i + 1))];
    labels.forEach((l, i) => { if (x >= 0) x = drawBandToken(x, l, i === index, GAP); });
}

export function previewStripTick(viewRepainted: boolean): void {
    const key = previewIndex() + '/' + previewCount();
    if (!viewRepainted && key === drawn) return;
    drawn = key;
    drawPreviewStrip(previewIndex(), previewCount());
}

export function resetPreviewStrip(): void { drawn = ''; }
