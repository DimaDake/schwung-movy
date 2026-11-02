/* The preview selector: `GEN  ORIG  1  2  3` in the bottom band, the option
 * showing boxed (design §5.2). Drawn on the Loop strip's schedule, in its
 * place, so it costs nothing on a tick where neither it nor the view moved. */

import { fontWidth } from '../font/index.js';
import { W } from '../renderer/layout.js';
import { drawBandLead, drawBandToken } from '../seq/render.js';
import { previewIndex, previewLabels, previewVisible } from './preview.js';

const GAP = 8;
/* A boxed entry reaches 1 px past its label on each side. */
const MIN_GAP = 3;
let drawn = '';

/** The options a strip of `vis` cells shows around option `index` (1-based)
 *  of `count`: [first, last, more past it]. At the picks it is the picks;
 *  past them it scrolls with the jog (design §2.2). */
export function stripWindow(index: number, count: number, vis: number): [number, number, boolean] {
    if (count <= vis) return [1, count, false];
    const first = index <= vis ? 1 : index - vis + 1;
    const last = first + vis - 1;
    return [first, last, last < count];
}

/** Pure: same index, labels and window, same pixels. Eight options do not
 *  fit at Smart Quantize's gap, so the gap shrinks to what fits; past `vis`
 *  options the strip windows them, `MORE` last while more lie past it. */
export function drawPreviewStrip(index: number, labels: string[], vis = labels.length): void {
    let x = drawBandLead('GEN');
    const [first, last, more] = stripWindow(Math.max(1, index), labels.length, vis);
    const all = ['ORIG', ...labels.slice(first - 1, last), ...(more ? ['MORE'] : [])];
    const boxed = index === 0 ? 0 : index - first + 1;
    const room = W - 1 - x - all.reduce((s, l) => s + fontWidth(l), 0);
    const gap = Math.max(MIN_GAP, Math.min(GAP, Math.floor(room / Math.max(1, all.length - 1))));
    all.forEach((l, i) => { if (x >= 0) x = drawBandToken(x, l, i === boxed, gap); });
}

export function previewStripTick(viewRepainted: boolean): void {
    const labels = previewLabels();
    const vis = previewVisible();
    const key = previewIndex() + '/' + vis + '/' + labels.join(',');
    if (!viewRepainted && key === drawn) return;
    drawn = key;
    drawPreviewStrip(previewIndex(), labels, vis);
}

export function resetPreviewStrip(): void { drawn = ''; }
