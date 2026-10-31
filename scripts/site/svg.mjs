/* SVG primitives and LED colours shared by every site diagram. */
import { readFileSync } from 'fs';

/* Move LED palette entries movy lights (hex from schwung's palette table,
 * constants.mjs / the web mirror). The hardware drives an LED at full
 * brightness whatever the table's lightness, so a figure brightens a colour
 * to its full value — a "dim" table entry still reads as that hue on the pad. */
const PALETTE = {
    2: '800400', 3: 'C93C00', 6: '491804', 7: 'FADC3B', 9: 'B6FF0E', 11: '34C216',
    23: '972BFF', 65: '661914', 69: '5D1700', 71: '470C00', 77: '645817', 81: '486605',
    95: '134566', 103: '0A1C4C', 109: '3C1166', 118: '595959', 120: 'FFFFFF',
    122: 'CCCCCC', 124: '141414', 127: 'FF0000',
};

export const UNLIT = '#262626';
export const BODY = '#1b1b1b';
export const CAP = '#2b2b2b';
export const EDGE = '#3a3a3a';
export const ACCENT = '#ffb000';
export const GREY_LIT = '#8c8c8c';
export const GREY_DIM = '#3d3d3d';

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');

export function led(index) {
    if (index === 118) return GREY_LIT;
    if (index === 124) return GREY_DIM;
    const h = PALETTE[index];
    if (!h) throw new Error(`palette index ${index} not in svg.mjs PALETTE`);
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const k = 255 / Math.max(1, ...c);
    return '#' + c.map((v) => hex2(v * k)).join('');
}

/** The same hue at the brightness Move uses for "dim" (muted, waiting). */
export function dim(color, f = 0.32) {
    const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const b = [0x26, 0x26, 0x26];
    return '#' + c.map((v, i) => hex2(b[i] + (v - b[i]) * f)).join('');
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const FONT = "font-family=\"Inter, 'Helvetica Neue', Arial, sans-serif\"";

export function text(x, y, s, { size = 12, fill = '#ddd', anchor = 'middle', weight = 400, extra = '' } = {}) {
    return `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle" ${extra}>${esc(s)}</text>`;
}

export function rrect(x, y, w, h, r, attrs = '') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" ${attrs}/>`;
}

export function svgDoc(w, h, body, title) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">\n<title>${esc(title)}</title>\n${body}\n</svg>\n`;
}

/** A baseline screenshot as an inline image, pixel-exact at any zoom. */
export function screenImage(pngPath, x, y, w, h) {
    const b64 = readFileSync(pngPath).toString('base64');
    return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:image/png;base64,${b64}"/>`;
}

/** A numbered callout badge with a leader line from (x0,y0) to the badge. */
export function badge(n, x, y, x0 = null, y0 = null) {
    let s = '';
    if (x0 !== null) s += `<line x1="${x0}" y1="${y0}" x2="${x}" y2="${y}" stroke="${ACCENT}" stroke-width="1.5"/>`;
    s += `<circle cx="${x}" cy="${y}" r="10" fill="${ACCENT}"/>`;
    s += text(x, y + 0.5, n, { size: 11, fill: '#111', weight: 700 });
    return s;
}
