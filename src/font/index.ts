import { CHARS4, CHARS4_EXTRA, G4, G4_EXTRA } from './glyphs.js';
import { drawGlyphRun, glyphRunWidth, type Glyph } from './blit.js';

export const FONT_HEIGHT = 5;
const FALLBACK_ADV = 5;

/* Lowercase folds onto the capitals: the face has no lowercase, and a blank
 * glyph there would drop letters from every name the user typed. */
const glyphFor = (cp: number): Glyph | null => {
    const ch = String.fromCharCode(cp).toUpperCase();
    const i = CHARS4.indexOf(ch);
    if (i >= 0) return G4[i];
    const j = CHARS4_EXTRA.indexOf(ch);
    return j >= 0 ? G4_EXTRA[j] : null;
};

/* The advance already carries the 1px inter-glyph gap and the last glyph needs
 * none, so a measured string is one pixel narrower than the sum — the same
 * measure Schwung's own pages take through fontWidth4x5. */
export function fontWidth(str: string): number {
    const w = glyphRunWidth(str, glyphFor, FALLBACK_ADV, 0);
    return w > 0 ? w - 1 : 0;
}

export function fontPrint(x: number, y: number, str: string, color: number): void {
    drawGlyphRun(x, y, str, color, glyphFor, FALLBACK_ADV, 0);
}
