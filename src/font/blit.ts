/* Shared bitmap-font blitter. A glyph is [advance, yOff, w, h, ...rowBits]
 * with bit0 = leftmost pixel. The font modules (index, index5x3, big) differ
 * only in glyph table, char lookup, fallback advance, and inter-glyph gap, so
 * the measure/blit loop lives here once. Fallback chars advance by
 * `fallbackAdv` and (matching the original loops) carry no inter-glyph gap. */
export type Glyph = number[];
export type GlyphLookup = (cp: number) => Glyph | null;

export function glyphRunWidth(str: string, glyphFor: GlyphLookup, fallbackAdv: number, gap: number): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const g = glyphFor(str.charCodeAt(i));
        w += g ? g[0] : fallbackAdv;
        if (i < str.length - 1) w += gap;
    }
    return w;
}

export function drawGlyphRun(
    x: number, y: number, str: string, color: number,
    glyphFor: GlyphLookup, fallbackAdv: number, gap: number,
): void {
    let cx = x;
    for (let i = 0; i < str.length; i++) {
        const g = glyphFor(str.charCodeAt(i));
        if (!g) { cx += fallbackAdv; continue; }
        const yOff = g[1], w = g[2], h = g[3];
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
        cx += g[0];
        if (i < str.length - 1) cx += gap;
    }
}
