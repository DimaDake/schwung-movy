/* Shared 1-bit raster primitives (device fill_rect-backed). Pure: same args →
 * same pixels. Extracted so the knob and envelope renderers share one line
 * routine (no duplication). */

export function drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
        fill_rect(x0, y0, 1, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

/* Bold 2×2 vertex marker, top-left anchored at (x,y). */
export function drawDot(x: number, y: number): void {
    fill_rect(x, y, 2, 2, 1);
}

/* Dotted vertical from y0 to y1 (inclusive), lit on every other row. */
export function drawDottedV(x: number, y0: number, y1: number): void {
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    for (let y = lo; y <= hi; y += 2) fill_rect(x, y, 1, 1, 1);
}

/* Dotted horizontal from x0 to x1 (inclusive), lit on every other column. */
export function drawDottedH(x0: number, x1: number, y: number): void {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    for (let x = lo; x <= hi; x += 2) fill_rect(x, y, 1, 1, 1);
}
