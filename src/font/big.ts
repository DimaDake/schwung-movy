import { G as GB } from './glyphs-big.js';
import { drawGlyphRun, glyphRunWidth, type Glyph, type RunEmit } from './blit.js';

/* Nokia 13px bitmap font (cap-height 11). Used for the big preset value. */
export const BIG_FONT_HEIGHT = 11;
const BIG_GAP = 1;   // 1px between glyphs (the OTF advances leave no side bearing)

const glyphFor = (cp: number): Glyph | null =>
    cp < 0x20 || cp > 0x7E ? null : GB[cp - 0x20];

export function fontWidthBig(str: string): number {
    return glyphRunWidth(str, glyphFor, 7, BIG_GAP);
}

/* `emit` lets a Schwung custom widget draw this face into its own frame-local
 * context instead of the device globals — see `RunEmit`. */
export function fontPrintBig(x: number, y: number, str: string, color: number,
                             emit?: RunEmit): void {
    drawGlyphRun(x, y, str, color, glyphFor, 7, BIG_GAP, emit);
}
