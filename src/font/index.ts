import { G } from './glyphs.js';

export const FONT_HEIGHT = 5;

export function fontWidth(str: string): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp < 0x20 || cp > 0x7E) { w += 5; continue; }
        w += G[cp - 0x20][0];
    }
    return w;
}

export function fontPrint(x: number, y: number, str: string, color: number): void {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp < 0x20 || cp > 0x7E) { cx += 5; continue; }
        const g = G[cp - 0x20];
        const adv = g[0], yOff = g[1], w = g[2], h = g[3];
        for (let row = 0; row < h; row++) {
            const bits = g[4 + row];
            let col = 0;
            while (col < w) {
                if (bits & (1 << col)) {
                    const s = col;
                    while (col < w && (bits & (1 << col))) col++;
                    fill_rect(cx + s, y + yOff + row, col - s, 1, color);
                } else { col++; }
            }
        }
        cx += adv;
    }
}
