import { G5 } from './glyphs5x3.js';
import { drawGlyphRun, glyphRunWidth, type Glyph, type RunEmit } from './blit.js';

/* Exported so a test can enumerate the font's coverage without a second copy of
 * the string drifting from this one. */
export const CHARS5 = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ%<>=?*';

const glyphFor = (cp: number): Glyph | null => {
    const idx = CHARS5.indexOf(String.fromCharCode(cp));
    return idx >= 0 ? G5[idx] : null;
};

export const FONT5_HEIGHT = 5;

export function fontWidth5x3(str: string): number {
    return glyphRunWidth(str, glyphFor, 4, 0);
}

/* `emit` as in blit.ts: a Schwung drawing context's own fillRect, for a
 * caller drawing through one rather than to the screen. */
export function fontPrint5x3(x: number, y: number, str: string, color: number, emit?: RunEmit): void {
    drawGlyphRun(x, y, str, color, glyphFor, 4, 0, emit);
}
