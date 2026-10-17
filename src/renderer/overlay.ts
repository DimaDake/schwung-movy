import { fontPrint, fontWidth } from '../font/index.js';
import { W, TOAST_Y, TOAST_H } from './layout.js';

// Centred toast bar at the bottom — inverted so it reads over any content below
export function drawJogToast(text: string): void {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);
    const tw = fontWidth(text);
    const tx = Math.max(1, Math.floor((W - tw) / 2));
    fontPrint(tx, TOAST_Y + 1, text, 0);
}

