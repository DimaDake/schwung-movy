/* Pad-grid and step-row figures: the 8x4 pads or the 16 steps on their own,
 * labelled, for layouts and maps where the rest of the panel is noise. */
import { UNLIT, BODY, GREY_LIT, GREY_DIM, led, dim, text, rrect, svgDoc } from './svg.mjs';
import movy from './model.mjs';

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const T1 = led(movy.TRACK_COLOR[0]);
const ink = (fill) => (fill === UNLIT || fill === GREY_DIM ? '#777' : '#111');

/** cells[row][col], row 0 = TOP; each { fill, label }. */
export function padGrid(cells, title, legend = [], { rowLabels = null, colLabels = null } = {}) {
    const cw = 62, ch = 42, g = 6, m = 14, lx0 = rowLabels ? 34 : 0, ty0 = colLabels ? 22 : 0;
    const w = m * 2 + lx0 + 8 * cw + 7 * g, gh = 4 * ch + 3 * g;
    const h = m * 2 + ty0 + gh + (legend.length ? 30 : 0);
    let s = rrect(0, 0, w, h, 10, `fill="${BODY}"`);
    (rowLabels || []).forEach((t, r) => { s += text(m + 12, m + ty0 + r * (ch + g) + ch / 2, t, { size: 12, weight: 700, fill: '#bbb' }); });
    (colLabels || []).forEach((t, k) => { s += text(m + lx0 + k * (cw + g) + cw / 2, m + 8, t, { size: 11, fill: '#999' }); });
    cells.forEach((row, r) => row.forEach((c, k) => {
        const x = m + lx0 + k * (cw + g), y = m + ty0 + r * (ch + g);
        s += rrect(x, y, cw, ch, 4, `fill="${c.fill}"`);
        if (c.label) s += text(x + cw / 2, y + ch / 2, c.label, { size: 14, weight: 700, fill: c.ink || ink(c.fill) });
    }));
    let lx = m + lx0;
    for (const [fill, label] of legend) {
        const y = m + ty0 + gh + 16;
        s += rrect(lx, y - 7, 14, 14, 3, `fill="${fill}" stroke="#555"`);
        s += text(lx + 20, y, label, { size: 12, anchor: 'start', fill: '#ccc' });
        lx += 34 + label.length * 6.6;
    }
    return svgDoc(w, h, s, title);
}

/** A melodic layout from movy's own pad map: C major, track 1. */
export function melodicLayout(mode, layout, title) {
    const root = 0, scale = 0, base = 48;
    const map = movy.buildPadMap(mode, layout, scale, base);
    const piano = mode === movy.MODE_CHROMATIC && layout === movy.LAYOUT_PIANO;
    const cells = [0, 1, 2, 3].map((r) => [...Array(8)].map((_, c) => {
        const p = map[(3 - r) * 8 + c];
        if (p < 0) return { fill: UNLIT, label: '' };
        const isRoot = (p - root) % 12 === 0, inKey = movy.inScaleFor(p, root, scale);
        const fill = isRoot ? T1 : inKey ? GREY_LIT : piano ? GREY_DIM : UNLIT;
        return { fill, label: NOTE[p % 12] };
    }));
    const legend = [[T1, 'Root (track colour)'], [GREY_LIT, 'In key']];
    if (mode === movy.MODE_CHROMATIC) legend.push([piano ? GREY_DIM : UNLIT, piano ? 'Out of key (dim)' : 'Out of key (dark)']);
    if (piano) legend.push([UNLIT, 'No key']);
    return padGrid(cells, title, legend);
}

/** The drum rack: 16 voices on the left 4x4, or 32 across both halves. */
export function drumLayout(padCount, title) {
    const cfg = { rawMidi: false, padCount, padNoteStart: 36 };
    const cells = [0, 1, 2, 3].map((r) => [...Array(8)].map((_, c) => {
        const pad = movy.drumPadOfPhys(68 + (3 - r) * 8 + c, 68, cfg);
        return pad < 0 ? { fill: UNLIT, label: '' } : { fill: pad === 1 ? '#ffffff' : T1, label: String(pad) };
    }));
    return padGrid(cells, title, [[T1, 'Voice'], ['#ffffff', 'Selected voice'], [led(movy.C_GREEN), 'Sounding'], [GREY_LIT, 'Muted voice']]);
}

/** 16 steps with an optional caption above (top) and below (bottom) each. */
export function stepRow(cells, title, { caption = null, groups = false } = {}) {
    const sw = 50, m = 16, top = caption ? 92 : 70, w = m * 2 + 16 * sw;
    const h = top + 92;
    let s = rrect(0, 0, w, h, 10, `fill="${BODY}"`);
    if (caption) s += text(w / 2, 20, caption, { size: 13, fill: '#bbb' });
    cells.forEach((c, i) => {
        const cx = m + sw * (i + 0.5), cy = top + 24;
        if (c.top) c.top.split('\n').forEach((t, k, a) => {
            s += text(cx, cy - 26 - (a.length - 1 - k) * 13, t, { size: 11, weight: 600, fill: c.topFill || '#eee' });
        });
        s += `<circle cx="${cx}" cy="${cy}" r="15" fill="#2b2b2b" stroke="${c.ring || '#3a3a3a'}" stroke-width="${c.ring ? 2.5 : 1}"/>`;
        if (c.fill) s += `<circle cx="${cx}" cy="${cy}" r="12" fill="${c.fill}"/>`;
        s += text(cx, cy + 30, String(i + 1), { size: 11, fill: '#888' });
        if (c.bottom) s += text(cx, cy + 46, c.bottom, { size: 11, weight: 600, fill: c.bottomFill || '#ddd' });
    });
    if (groups) for (let g = 0; g < 4; g++) {
        const x0 = m + sw * g * 4 + 6, x1 = m + sw * (g * 4 + 4) - 6, y = top + 80;
        s += `<path d="M${x0},${y - 6} L${x0},${y} L${x1},${y} L${x1},${y - 6}" fill="none" stroke="#666"/>`;
    }
    return svgDoc(w, h, s, title);
}

export const trackLed = (t) => led(movy.TRACK_COLOR[t]);
export const trackDim = (t) => dim(led(movy.TRACK_COLOR[t]));
export { movy, T1 };
