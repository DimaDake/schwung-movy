/* The preview selector: `GEN  ORIG  1  2  3` in the bottom band, the option
 * showing boxed (design §5.2), and above it, while the jog is held, the
 * generator behind that option. Drawn on the Loop strip's schedule, in its
 * place, so it costs nothing on a tick where neither it nor the view moved. */

import { fontPrint, fontWidth } from '../font/index.js';
import { W, TOAST_Y, TOAST_H } from '../renderer/layout.js';
import { jogHintVisible } from '../app/jog-hint.js';
import { drawBandLead, drawBandToken } from '../seq/render.js';
import { previewIndex, previewLabels, previewName } from './preview.js';

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

/* Filled down to the band, so the two read as one white block. */
const NAME_Y = TOAST_Y - TOAST_H - 1;
let nameDrawn = '';

export function drawPreviewName(name: string): void {
    const text = 'GENERATOR: ' + name;
    fill_rect(0, NAME_Y, W, TOAST_Y - NAME_Y, 1);
    fontPrint(Math.max(1, Math.floor((W - fontWidth(text)) / 2)), NAME_Y + 1, text, 0);
}

/** The jog held without turning (app/jog-hint.ts) shows it; turning while
 *  held keeps it up and renames it. Taken away by the release's repaint. */
export function previewNameTick(viewRepainted: boolean): void {
    if (!jogHintVisible()) { nameDrawn = ''; return; }
    const n = previewName();
    if (!viewRepainted && n === nameDrawn) return;
    nameDrawn = n;
    drawPreviewName(n);
}

export function resetPreviewStrip(): void { drawn = ''; nameDrawn = ''; }
