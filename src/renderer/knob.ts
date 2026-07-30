import type { ParamVM } from '../types/viewmodel.js';
import { CELL_W, KW } from './layout.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { fontPrintBig, fontWidthBig, BIG_FONT_HEIGHT } from '../font/big.js';
import { enumSquareLines } from './shorten.js';
import { drawLine } from './primitives.js';

function drawCircleBorder(cx: number, cy: number, r: number): void {
    let x = r, y = 0, err = 0;
    while (x >= y) {
        fill_rect(cx + x, cy + y, 1, 1, 1); fill_rect(cx + y, cy + x, 1, 1, 1);
        fill_rect(cx - y, cy + x, 1, 1, 1); fill_rect(cx - x, cy + y, 1, 1, 1);
        fill_rect(cx - x, cy - y, 1, 1, 1); fill_rect(cx - y, cy - x, 1, 1, 1);
        fill_rect(cx + y, cy - x, 1, 1, 1); fill_rect(cx + x, cy - y, 1, 1, 1);
        y++;
        if (err <= 0) { err += 2 * y + 1; }
        if (err > 0)  { x--; err -= 2 * x + 1; }
    }
}

function drawArcKnob(kx: number, ky: number, normVal: number): void {
    const cx = kx + 7, cy = ky + 7, r = 7;
    drawCircleBorder(cx, cy, r);
    const angleDeg = 210 + normVal * 300;
    const rad = angleDeg * Math.PI / 180;
    const ex = Math.round(cx + r * Math.sin(rad));
    const ey = Math.round(cy - r * Math.cos(rad));
    drawLine(cx, cy, ex, ey);
}

/* Horizontal bar: fills left→right — used for binary (on/off) params */
function drawHorzBar(kx: number, ky: number, normVal: number): void {
    fill_rect(kx + 1, ky + 5, 14, 1, 1);
    fill_rect(kx + 1, ky + 10, 14, 1, 1);
    fill_rect(kx + 1, ky + 5, 1, 6, 1);
    fill_rect(kx + 14, ky + 5, 1, 6, 1);
    const fillW = Math.round(normVal * 12);
    if (fillW > 0) fill_rect(kx + 2, ky + 6, fillW, 4, 1);
}

/* Vertical bar: fills bottom→up — used for mix/volume params in module configs */
function drawVertBar(kx: number, ky: number, normVal: number): void {
    fill_rect(kx + 5, ky + 1, 6, 1, 1);
    fill_rect(kx + 5, ky + 14, 6, 1, 1);
    fill_rect(kx + 5, ky + 1, 1, 14, 1);
    fill_rect(kx + 10, ky + 1, 1, 14, 1);
    const fillH = Math.round(normVal * 12);
    if (fillH > 0) fill_rect(kx + 6, ky + 2 + (12 - fillH), 4, fillH, 1);
}

function drawEnumSquare(kx: number, ky: number, options: string[] | null, enumIndex: number): void {
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
    const raw = options ? (options[enumIndex] ?? String(enumIndex)) : String(enumIndex);
    const [line1, line2] = enumSquareLines(raw);
    const inner  = KW - 2;
    const totalH = line2.length > 0 ? 11 : 5;
    const startY = ky + 1 + Math.floor((inner - totalH) / 2);
    const l1w = fontWidth5x3(line1);
    fontPrint5x3(kx + 1 + Math.floor((inner - l1w) / 2), startY, line1, 1);
    if (line2.length > 0) {
        const l2w = fontWidth5x3(line2);
        fontPrint5x3(kx + 1 + Math.floor((inner - l2w) / 2), startY + 6, line2, 1);
    }
}

/* Framed X: an empty box with a big diagonal cross — the LFO target when it is
 * None (drawn, not a font glyph). Same frame as the enum square. */
function drawXBox(kx: number, ky: number): void {
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
    const a = 3, b = KW - 1 - 3;   // inset the cross from the frame
    drawLine(kx + a, ky + a, kx + b, ky + b);
    drawLine(kx + b, ky + a, kx + a, ky + b);
}

/* Length square: a stacked fraction (numerator / 1px divider / denominator) for
 * values like "1/4"; a single centered value otherwise (whole-bar counts, "..."). */
function drawLengthSquare(kx: number, ky: number, text: string): void {
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
    const inner = KW - 2;
    const slash = text.indexOf('/');
    if (slash > 0) {
        const num = text.slice(0, slash), den = text.slice(slash + 1);
        const nw = fontWidth5x3(num), dw = fontWidth5x3(den);
        const lineW = Math.max(nw, dw);
        fontPrint5x3(kx + 1 + Math.floor((inner - nw) / 2), ky + 2, num, 1);
        fill_rect(kx + 1 + Math.floor((inner - lineW) / 2), ky + 7, lineW, 1, 1);
        fontPrint5x3(kx + 1 + Math.floor((inner - dw) / 2), ky + 8, den, 1);
    } else {
        const w = fontWidth5x3(text);
        fontPrint5x3(kx + 1 + Math.floor((inner - w) / 2), ky + 1 + Math.floor((inner - 5) / 2), text, 1);
    }
}

/* Preset knob: the 1-based preset number rendered big in the Nokia font, no
 * frame, centered across the full cell (using the side margins beyond the
 * 16px box). Falls back to the small font if the number is too wide (>=4
 * digits) so it always fits. */
function drawPresetValue(cellX: number, ky: number, pvm: ParamVM): void {
    const num = pvm.type === 'enum'
        ? pvm.enumIndex + 1
        : Number(pvm.displayValue);
    // Numeric → render the number; non-numeric (e.g. condition "2:3") → the text.
    const text = Number.isFinite(num) ? String(Math.round(num)) : (pvm.displayValue || '—');
    const bw = fontWidthBig(text);
    if (bw <= CELL_W) {
        fontPrintBig(cellX + Math.floor((CELL_W - bw) / 2),
                     ky + Math.floor((KW - BIG_FONT_HEIGHT) / 2), text, 1);
    } else {
        const sw = fontWidth(text);
        fontPrint(cellX + Math.floor((CELL_W - sw) / 2),
                  ky + Math.floor((KW - FONT_HEIGHT) / 2), text, 1);
    }
}

/* Clockwise circular arrow, ~10px across, centred in the cell. Mirrored for the
 * counter-clockwise (cooling) variant. Drawn rather than a glyph: at this size a
 * font arrow is unreadable, and the direction has to be unmistakable — it is the
 * instruction for what to do next. */
function drawTurnArrow(kx: number, ky: number, ccw: boolean, on: number): void {
    const cx = kx + 8, cy = ky + 8, r = 4;
    /* Open ring: a gap at the top leaves room for the arrowhead. */
    for (let a = 40; a <= 320; a += 12) {
        const rad = a * Math.PI / 180;
        const sx = Math.round(cx + r * Math.sin(rad));
        const sy = Math.round(cy - r * Math.cos(rad));
        fill_rect(ccw ? 2 * cx - sx : sx, sy, 1, 1, on);
    }
    /* Arrowhead at the ring's leading end (top-right, or top-left mirrored). */
    const hx = ccw ? cx - 3 : cx + 3;
    const dir = ccw ? -1 : 1;
    fill_rect(hx, cy - r, 1, 1, on);
    fill_rect(hx - dir, cy - r - 1, 1, 1, on);
    fill_rect(hx - dir, cy - r + 1, 1, 1, on);
}

/* Dashed 16×16 frame — the cooling badge, so it reads as "not ready" at a
 * glance without needing the arrow to be legible. */
function drawDashedFrame(kx: number, ky: number): void {
    for (let i = 0; i < KW; i += 2) {
        fill_rect(kx + i, ky, 1, 1, 1);
        fill_rect(kx + i, ky + KW - 1, 1, 1, 1);
        fill_rect(kx, ky + i, 1, 1, 1);
        fill_rect(kx + KW - 1, ky + i, 1, 1, 1);
    }
}

function drawSolidFrame(kx: number, ky: number): void {
    fill_rect(kx, ky, KW, 1, 1);
    fill_rect(kx, ky + KW - 1, KW, 1, 1);
    fill_rect(kx, ky, 1, KW, 1);
    fill_rect(kx + KW - 1, ky, 1, KW, 1);
}

/* A one-shot action, deliberately not shaped like a knob: an arc/bar/enum cell
 * would all read as a value you could set, which is the wrong mental model.
 *   armed   — solid frame + CW arrow ("turn this way to fire")
 *   fired   — filled cell, arrow knocked out (a negative of armed)
 *   cooling — dashed frame + CCW arrow, plus a drain along the top edge showing
 *             how long until it re-arms on its own
 */
function drawTriggerBadge(kx: number, ky: number, pvm: ParamVM): void {
    const phase = pvm.trigger;
    if (phase === 'fired') {
        fill_rect(kx, ky, KW, KW, 1);
        drawTurnArrow(kx, ky, false, 0);
        return;
    }
    if (phase === 'cooling') {
        drawDashedFrame(kx, ky);
        drawTurnArrow(kx, ky, true, 1);
        /* Drain: a bar just inside the top edge, shrinking as the re-arm window
         * elapses. Drawn inside rather than on the frame — on the frame it just
         * reads as a slightly solider border, not an indicator. 0 steps = a latch
         * seeded from the DSP's value, with no timer running to show. */
        const steps = pvm.triggerCool ?? 0;
        if (steps > 0) {
            const inner = KW - 4;
            fill_rect(kx + 2, ky + 2, Math.max(1, Math.round(inner * steps / 8)), 1, 1);
        }
        return;
    }
    drawSolidFrame(kx, ky);
    drawTurnArrow(kx, ky, false, 1);
}

export function drawKnobWidget(col: number, rowY: number, pvm: ParamVM): void {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY;
    if (pvm.trigger) {
        drawTriggerBadge(kx, ky, pvm);
    } else if (pvm.renderStyle === 'preset') {
        drawPresetValue(col * CELL_W, ky, pvm);
    } else if (pvm.type === 'len') {
        drawLengthSquare(kx, ky, pvm.displayValue);
    } else if (pvm.type === 'file') {
        drawEnumSquare(kx, ky, [pvm.displayValue], 0);
    } else if (pvm.type === 'enum') {
        drawEnumSquare(kx, ky, pvm.options, pvm.enumIndex);
    } else if (pvm.renderStyle === 'xbox') {
        drawXBox(kx, ky);
    } else if (pvm.renderStyle === 'hbar') {
        drawHorzBar(kx, ky, pvm.normalizedValue);
    } else if (pvm.renderStyle === 'vbar') {
        drawVertBar(kx, ky, pvm.normalizedValue);
    } else {
        drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}
