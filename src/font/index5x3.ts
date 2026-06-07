import { G5 } from './glyphs5x3.js';

const CHARS5 = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function glyphIndex(cp: number): number {
    return CHARS5.indexOf(String.fromCharCode(cp));
}

export const FONT5_HEIGHT = 5;

export function fontWidth5x3(str: string): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const idx = glyphIndex(str.charCodeAt(i));
        w += idx >= 0 ? G5[idx][0] : 4;
    }
    return w;
}

export function fontPrint5x3(x: number, y: number, str: string, color: number): void {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
        const idx = glyphIndex(str.charCodeAt(i));
        if (idx < 0) { cx += 4; continue; }
        const g = G5[idx];
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
