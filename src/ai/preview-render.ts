/* The preview selector: `GEN  ORIG  1  2  3` in the bottom band, the option
 * showing boxed (design §5.2). Drawn on the Loop strip's schedule, in its
 * place, so it costs nothing on a tick where neither it nor the view moved. */

import { fontWidth } from '../font/index.js';
import { W } from '../renderer/layout.js';
import { drawBandLead, drawBandToken } from '../seq/render.js';
import { previewIndex, previewLabels } from './preview.js';

const GAP = 8;
/* A boxed entry reaches 1 px past its label on each side. */
const MIN_GAP = 3;
let drawn = '';

/** Pure: same index and labels, same pixels. Eight Variation options do not
 *  fit at Smart Quantize's gap, so the gap shrinks to what fits. */
export function drawPreviewStrip(index: number, labels: string[]): void {
    let x = drawBandLead('GEN');
    const all = ['ORIG', ...labels];
    const room = W - 1 - x - all.reduce((s, l) => s + fontWidth(l), 0);
    const gap = Math.max(MIN_GAP, Math.min(GAP, Math.floor(room / Math.max(1, all.length - 1))));
    all.forEach((l, i) => { if (x >= 0) x = drawBandToken(x, l, i === index, gap); });
}

export function previewStripTick(viewRepainted: boolean): void {
    const labels = previewLabels();
    const key = previewIndex() + '/' + labels.join(',');
    if (!viewRepainted && key === drawn) return;
    drawn = key;
    drawPreviewStrip(previewIndex(), labels);
}

export function resetPreviewStrip(): void { drawn = ''; }
