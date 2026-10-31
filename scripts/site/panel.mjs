/* The Move's control surface as SVG: the web mirror's arrangement (screen,
 * encoders and volume across the top; wheel, Back and Note/Session left; track
 * buttons; 4x8 pads; the 2x4 function buttons; Play, Rec, 16 steps; arrows),
 * with caller-supplied LED states, held controls and numbered callouts. */
import { BODY, CAP, EDGE, UNLIT, ACCENT, rrect, text, svgDoc, screenImage, badge } from './svg.mjs';

export const W = 920, P = 18, GAP = 12;
const COL_L = 150, COL_T = 30, COL_F = 112;
const PAD_X = P + COL_L + GAP + COL_T + GAP;
const PAD_W = W - PAD_X - GAP - COL_F - P;
const PAD_GAP = 7, PAD_CW = (PAD_W - 7 * PAD_GAP) / 8, PAD_CH = Math.round(PAD_CW * 2 / 3);
const TOP_H = 84, TOP_Y = P;
const PADS_Y = TOP_Y + TOP_H + GAP;
const STEP_Y = PADS_Y + 4 * PAD_CH + 3 * PAD_GAP + GAP + 22;
export const H = STEP_Y + 24 + 10 + P;
const FUNC_X = W - P - COL_F;
const padCx = (c) => PAD_X + c * (PAD_CW + PAD_GAP) + PAD_CW / 2;
const rowCy = (r) => PADS_Y + r * (PAD_CH + PAD_GAP) + PAD_CH / 2;   // r = 0 top
const stepCx = (i) => PAD_X + (PAD_W / 16) * (i + 0.5);
const WX = P + COL_L / 2, WY = (rowCy(0) + rowCy(1)) / 2;

const GLYPH = {
    back: 'M10,4 L6,8 L10,12', session: 'M2,3.5 L14,3.5 M2,8 L14,8 M2,12.5 L14,12.5',
    play: 'M3,1 L14,8 L3,15 Z', rec: 'M15,8 A7,7 0 1,1 1,8 A7,7 0 1,1 15,8',
    capture: 'M1,4 L1,1 L4,1 M12,1 L15,1 L15,4 M15,12 L15,15 L12,15 M4,15 L1,15 L1,12',
    loop: 'M4,3 L12,3 A3.5,3.5 0 0,1 12,13 L4,13 A3.5,3.5 0 0,1 4,3 M9,15.5 L6,13 L9,10.5',
    mute: 'M3,13 L3,3 L8,10 L13,3 L13,13', delete: 'M2.3,2.3 L13.7,13.7 M13.7,2.3 L2.3,13.7',
    copy: 'M2,5 h7 v7 h-7 Z M6,1.5 h7 v7 h-7', undo: 'M5,4.5 L3,7 L5,9.5 M3,7 L11,7 A3.5,3.5 0 0,1 11,13 L9,13',
    up: 'M8,3 L8,13 M3,8 L13,8', down: 'M3,8 L13,8', left: 'M10,4 L6,8 L10,12', right: 'M6,4 L10,8 L6,12',
};
const FUNCS = ['capture', 'sample', 'loop', 'mute', 'delete', 'copy', 'undo', 'shift'];
const NAV = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];

/** Centre of every named control: knob1..8, volume, jog, back, session,
 *  track1..4, pad<row>_<col> (row 0 = top), step1..16, play, rec, the
 *  function buttons, up/down/left/right, screen. */
export const SPOT = (() => {
    const s = { screen: [P + COL_L / 2, TOP_Y + TOP_H / 2], jog: [WX, WY],
        back: [WX - 22, rowCy(2)], session: [WX + 22, rowCy(2)],
        play: [WX - 22, STEP_Y], rec: [WX + 22, STEP_Y],
        volume: [FUNC_X + COL_F * 0.75, TOP_Y + TOP_H / 2] };
    for (let i = 0; i < 8; i++) s['knob' + (i + 1)] = [padCx(i), TOP_Y + TOP_H / 2];
    for (let r = 0; r < 4; r++) s['track' + (r + 1)] = [P + COL_L + GAP + COL_T / 2, rowCy(r)];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) s[`pad${r}_${c}`] = [padCx(c), rowCy(r)];
    for (let i = 0; i < 16; i++) s['step' + (i + 1)] = [stepCx(i), STEP_Y];
    FUNCS.forEach((n, i) => { s[n] = [FUNC_X + COL_F * (i % 2 ? 0.75 : 0.25), rowCy(Math.floor(i / 2))]; });
    for (const [n, dx, dy] of NAV) s[n] = [FUNC_X + COL_F / 2 + dx * 26, STEP_Y + 4 + dy * 14];
    return s;
})();
export const PAD_SIZE = [PAD_CW, PAD_CH];

function glyph(name, cx, cy, size, color) {
    const k = size / 16, t = `translate(${cx - size / 2},${cy - size / 2}) scale(${k})`;
    if (name === 'sample') return `<circle cx="${cx}" cy="${cy}" r="${5 * k}" fill="${color}"/>`;
    if (name === 'shift') return [3, 8, 13].map((x) => `<circle cx="${cx - size / 2 + x * k}" cy="${cy}" r="${1.4 * k}" fill="${color}"/>`).join('');
    return `<path d="${GLYPH[name]}" transform="${t}" fill="${name === 'play' ? color : 'none'}" stroke="${color}" stroke-width="${1.4}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}

const ring = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="2.5"/>`;

function button(cx, cy, r, led, held, name) {
    let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${held ? '#555' : CAP}" stroke="${led || EDGE}" stroke-width="${led ? 2.5 : 1}"/>`;
    if (held) s += ring(cx, cy, r + 4);
    if (name) s += glyph(name, cx, cy, r * 0.95, led || '#888');
    return s;
}

function encoder(cx, cy, r, led, held) {
    const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI, R = r + 5;
    const arc = `M${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)} A${R},${R} 0 1,1 ${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)}`;
    let s = `<path d="${arc}" fill="none" stroke="${led || '#262626'}" stroke-width="3"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${held ? '#3a4a55' : '#2e2e2e'}" stroke="${held ? '#5588bb' : EDGE}" stroke-width="${held ? 2 : 1}"/>`;
    s += `<line x1="${cx}" y1="${cy - r * 0.35}" x2="${cx}" y2="${cy - r * 0.85}" stroke="#aaa" stroke-width="2"/>`;
    if (held) s += ring(cx, cy, r + 9);
    return s;
}

/**
 * opts.screen   path to a 128x64 PNG for the display
 * opts.pads     { 'r_c': color }    (row 0 = top)
 * opts.steps    { 1..16: color }
 * opts.leds     { name: color }     buttons, track1..4, knob1..8, volume
 * opts.held     [names]             drawn pressed, with a white ring
 * opts.callouts [{ n, at, dx, dy }] numbered badges offset from a control
 * opts.labels   [{ at, text, dx, dy }] small captions
 * opts.crop     [x, y, w, h]        viewBox crop
 */
export function panel(opts = {}) {
    const leds = opts.leds || {}, held = new Set(opts.held || []);
    const L = (n) => leds[n] || null, Hd = (n) => held.has(n);
    let s = rrect(2, 2, W - 4, H - 4, 10, `fill="${BODY}" stroke="#2c2c2c" stroke-width="2"`);
    const sw = 128 * 1.05, sh = 64 * 1.05, sx = P + (COL_L - sw) / 2, sy = TOP_Y + (TOP_H - sh) / 2;
    s += `<rect x="${sx - 4}" y="${sy - 4}" width="${sw + 8}" height="${sh + 8}" fill="#000"/>`;
    if (opts.screen) s += screenImage(opts.screen, sx, sy, sw, sh);
    for (let i = 0; i < 8; i++) s += encoder(...SPOT['knob' + (i + 1)], 15, L('knob' + (i + 1)), Hd('knob' + (i + 1)));
    s += encoder(...SPOT.volume, 19, L('volume'), Hd('volume'));
    s += encoder(WX, WY, 32, null, Hd('jog'));
    s += button(...SPOT.back, 16, L('back'), Hd('back'), 'back');
    s += button(...SPOT.session, 16, L('session'), Hd('session'), 'session');
    for (let r = 0; r < 4; r++) {
        const n = 'track' + (r + 1), x = P + COL_L + GAP + (COL_T - 16) / 2, y = rowCy(r) - PAD_CH / 2;
        s += rrect(x, y, 16, PAD_CH, 8, `fill="${Hd(n) ? '#555' : CAP}" stroke="${Hd(n) ? '#fff' : EDGE}" stroke-width="${Hd(n) ? 2.5 : 1}"`);
        s += rrect(x + 6, y + PAD_CH * 0.18, 4, PAD_CH * 0.64, 2, `fill="${L(n) || '#444'}"`);
    }
    const pads = opts.pads || {};
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
        const x = PAD_X + c * (PAD_CW + PAD_GAP), y = PADS_Y + r * (PAD_CH + PAD_GAP), k = `${r}_${c}`;
        s += rrect(x, y, PAD_CW, PAD_CH, 3, `fill="${pads[k] || UNLIT}"`);
        if (Hd('pad' + k)) s += rrect(x + 1.5, y + 1.5, PAD_CW - 3, PAD_CH - 3, 3, 'fill="none" stroke="#fff" stroke-width="3"');
    }
    FUNCS.forEach((n) => { s += button(...SPOT[n], 18, L(n), Hd(n), n); });
    s += button(...SPOT.play, 16, L('play'), Hd('play'), 'play');
    s += button(...SPOT.rec, 16, L('rec'), Hd('rec'), 'rec');
    const steps = opts.steps || {};
    for (let i = 0; i < 16; i++) {
        const [cx, cy] = SPOT['step' + (i + 1)];
        s += button(cx, cy, 11, null, Hd('step' + (i + 1)), null);
        if (steps[i + 1]) s += `<circle cx="${cx}" cy="${cy}" r="9" fill="${steps[i + 1]}"/>`;
        if (i % 4 === 0) s += `<rect x="${cx - 5}" y="${cy + 15}" width="10" height="2" fill="#444"/>`;
    }
    for (const [n] of NAV) s += button(...SPOT[n], 11, L(n), Hd(n), n);
    for (const l of opts.labels || []) {
        const [x, y] = SPOT[l.at];
        s += text(x + (l.dx || 0), y + (l.dy || 0), l.text, { size: l.size || 11, fill: l.fill || '#eee', weight: 600 });
    }
    for (const c of opts.callouts || []) {
        const [x, y] = SPOT[c.at];
        s += badge(c.n, x + (c.dx || 0), y + (c.dy || 0), (c.dx || c.dy) ? x : null, y);
    }
    const [vx, vy, vw, vh] = opts.crop || [0, 0, W, H];
    return svgDoc(vw, vh, `<g transform="translate(${-vx},${-vy})">${s}</g>`, opts.title || 'Ableton Move control surface')
        .replace(`viewBox="0 0 ${vw} ${vh}"`, `viewBox="0 0 ${vw} ${vh}"`);
}

export const GEOM = { PAD_X, PAD_W, PADS_Y, STEP_Y, TOP_Y, TOP_H, FUNC_X, COL_F, P, rowCy, padCx, stepCx, ACCENT };
