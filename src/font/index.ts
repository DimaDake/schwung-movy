import { G } from './glyphs.js';
import { drawGlyphRun, glyphRunWidth, type Glyph } from './blit.js';

export const FONT_HEIGHT = 5;

const glyphFor = (cp: number): Glyph | null =>
    cp < 0x20 || cp > 0x7E ? null : G[cp - 0x20];

export function fontWidth(str: string, letterGap = -1): number {
    return glyphRunWidth(str, glyphFor, 5, letterGap);
}

export function fontPrint(x: number, y: number, str: string, color: number, letterGap = -1): void {
    drawGlyphRun(x, y, str, color, glyphFor, 5, letterGap);
}
