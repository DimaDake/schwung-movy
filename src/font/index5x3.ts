import { G5 } from './glyphs5x3.js';
import { drawGlyphRun, glyphRunWidth, type Glyph } from './blit.js';

const CHARS5 = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ%<>=?*';

const glyphFor = (cp: number): Glyph | null => {
    const idx = CHARS5.indexOf(String.fromCharCode(cp));
    return idx >= 0 ? G5[idx] : null;
};

export const FONT5_HEIGHT = 5;

export function fontWidth5x3(str: string): number {
    return glyphRunWidth(str, glyphFor, 4, 0);
}

export function fontPrint5x3(x: number, y: number, str: string, color: number): void {
    drawGlyphRun(x, y, str, color, glyphFor, 4, 0);
}
