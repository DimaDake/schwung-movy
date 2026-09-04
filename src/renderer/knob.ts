import type { ParamVM } from '../types/viewmodel.js';
import { CELL_W, KW } from './layout.js';
import { fontPrint5x3, fontWidth5x3 } from '../font/index5x3.js';
import { fontPrint, fontWidth, FONT_HEIGHT } from '../font/index.js';
import { fontPrintBig, fontWidthBig, BIG_FONT_HEIGHT } from '../font/big.js';
import { enumSquareLines } from './shorten.js';
import { drawLine, hatchRect } from './primitives.js';
import { drawWave } from './lfo-wave.js';
import { drawCutCurve } from './cut-curve.js';
import { toggleIsOn } from '../model/toggle.js';

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

/* An on/off switch, for boolean params (see model/toggle.ts).
 *
 * A 26x11 capsule with a 9px knob that slides right when on. The ON state also
 * INVERTS — the capsule fills and the knob is knocked out of it. Position alone
 * is too weak a signal at this size: on a page of eight switches you would have
 * to inspect each one, where filled-vs-outline reads at a glance. That is the
 * whole reason a switch beats the two-item enum square it replaces.
 *
 * The three tables below are ONE circle at three radii. The capsule's end cap is
 * a circle of radius 5; eroding it by a pixel gives the interior (radius 4), and
 * the knob is that same radius-4 circle. So the knob nests in the cap
 * concentrically with a uniform 1px gap, instead of being a round dot rattling
 * inside a squarish box — which is what a hand-stepped 2px chamfer looked like.
 *
 * Tables rather than per-pixel math because this redraws every frame for every
 * knob, and movy's tick period is also its MIDI sampling interval. */
const SW_X = [4, 2, 1, 1, 0, 0, 0, 1, 1, 2, 4];          // capsule, r=5
const SW_W = [18, 22, 24, 24, 26, 26, 26, 24, 24, 22, 18];
const SW_IN_X = [3, 1, 1, 0, 0, 0, 1, 1, 3];             // eroded by 1px, r=4
const SW_IN_W = [18, 22, 22, 24, 24, 24, 22, 22, 18];
const SW_KN_X = [3, 1, 1, 0, 0, 0, 1, 1, 3];             // the same r=4 circle
const SW_KN_W = [3, 7, 7, 9, 9, 9, 7, 7, 3];

function drawSwitch(kx: number, ky: number, on: boolean): void {
    /* 26 wide in a 32px cell, so it straddles the 16px knob box — the same
     * liberty drawWaveCell takes. Width is set by the knob, not by taste: with a
     * real semicircular cap the knob is nearly as tall as the capsule, and at 20
     * wide it ate half the fill, leaving ON and OFF pixel-identical across the
     * centre rows. The extra width is what lets the inversion read. */
    const x = kx - 5, y = ky + 2;
    for (let i = 0; i < 11; i++) fill_rect(x + SW_X[i], y + i, SW_W[i], 1, 1);
    if (!on) for (let i = 0; i < 9; i++) fill_rect(x + 1 + SW_IN_X[i], y + 1 + i, SW_IN_W[i], 1, 0);
    const seat = on ? x + 16 : x + 1;                    // 1px clear of the cap
    const v: 0 | 1 = on ? 0 : 1;                         // knocked out when filled
    for (let i = 0; i < 9; i++) fill_rect(seat + SW_KN_X[i], y + 1 + i, SW_KN_W[i], 1, v);
}

/* A mixer fader, for loudness params (see model/fader.ts).
 *
 * Three elements only: two dotted rails marking the travel, a 3px column filled
 * from the bottom, and a 1px head across it. Earlier passes drew a track line, a
 * slot through the head and a ladder of metering ticks; at 13 pixels of travel
 * all of that collides with itself and the thing stops reading as a fader.
 *
 * The rails are dotted so they stay a scale rather than becoming a second bar
 * competing with the fill, and they sit a pixel clear of it on each side.
 *
 * Always fills from the bottom, including on bipolar gains. A −60..+30 range
 * would want its origin two thirds up, but a fader whose fill starts somewhere
 * different per param is a worse picture than a consistent one — the number
 * under it already says which side of unity you are on. */
function drawFader(kx: number, ky: number, normVal: number): void {
    const top = ky + 1, bot = ky + 14, h = bot - top;
    const cx = kx + 8;

    for (let y = top; y <= bot; y += 2) {
        fill_rect(cx - 4, y, 1, 1, 1);
        fill_rect(cx + 4, y, 1, 1, 1);
    }
    const y = Math.round(bot - Math.max(0, Math.min(1, normVal)) * h);
    if (y < bot) fill_rect(cx - 1, y, 3, bot - y + 1, 1);
    fill_rect(cx - 3, y, 7, 1, 1);                   // head
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

/* Waveform cell: the silhouette alone, spanning the WHOLE cell — no frame and
 * no 16px box. Resolution is the entire point of this drawing: a stepped shape
 * only reads as stepped when its levels are more than a pixel apart, and at
 * 30×16 Helm's "8 Step" is plainly not the same list's smooth "Saw Up", which
 * a framed 12×12 box left borderline. The label underneath already says which
 * parameter this is, so the frame was spending a third of the cell to repeat
 * that it is a list. */
function drawWaveCell(cellX: number, ky: number, shape: number, off = false): void {
    /* drawLfoWave's vertical geometry (rowY+1..rowY+14) so a single-knob
     * waveform and a two-cell LFO waveform on the same page share a baseline.
     * Horizontally it is inset 2px rather than the LFO's 1px: neighbouring
     * cells each end in a full-height closing edge, and at a 1px inset those
     * two edges sit 2px apart and read as one shape spanning both cells. */
    drawWave(cellX + 2, ky + 1, CELL_W - 4, KW - 2, shape, 1, 1, off);
}

/* A lone envelope stage, in the waveform cell's box. Decay: a dotted vertical
 * rise on the left, then a straight fall whose LENGTH is the value, then the
 * floor out to the right edge. Attack is the exact mirror — floor, rise, dotted
 * vertical on the right.
 *
 * The rise (decay) or fall (attack) is dotted because that edge is NOT this
 * knob: the module gives no control over it here. Same reading as the dotted
 * waveform toggle — an outline means "not yours".
 *
 * Straight, not exponential: a real decay curve collapses to a near-vertical
 * spike below about a fifth of the range, and at 28px those short values stop
 * being tellable apart. */
function drawEnvStage(cellX: number, ky: number, norm: number, stage: 'a' | 'd'): void {
    const x = cellX + 2, y = ky + 1, w = CELL_W - 4, h = KW - 2;
    const top = y, bot = y + h - 1;
    const len = Math.max(2, Math.round(Math.max(0, Math.min(1, norm)) * (w - 1)));
    const dottedV = (px: number): void => { hatchRect(px, top, 1, bot - top + 1, 1); };
    const ramp = (x0: number, fromY: number, toY: number): void => {
        let py = fromY;
        for (let i = 1; i <= len; i++) {
            const ny = Math.round(fromY + (toY - fromY) * (i / len));
            fill_rect(x0 + i, Math.min(py, ny), 1, Math.abs(ny - py) + 1, 1);
            py = ny;
        }
    };
    if (stage === 'd') {
        dottedV(x);
        ramp(x, top, bot);
        if (x + len < x + w - 1) fill_rect(x + len, bot, (x + w - 1) - (x + len) + 1, 1, 1);
    } else {
        const riseStart = x + w - 1 - len;
        if (riseStart > x) fill_rect(x, bot, riseStart - x + 1, 1, 1);
        ramp(riseStart, bot, top);
        dottedV(x + w - 1);
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

/* Dashed 16×16 frame — the cooling badge, so it reads as "not ready" at a glance. */
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

/* 8×8 circle, centred exactly in the 16×16 cell — 4px margin on every side.
 * Built from explicit row spans rather than a midpoint rasteriser: on an
 * even-sized box a rasterised circle lands a pixel off centre, and at this size
 * that asymmetry is obvious. Outline normally; solid for the fired moment. */
const CIRCLE_ROWS: [number, number][] = [
    [2, 5], [1, 6], [0, 7], [0, 7], [0, 7], [0, 7], [1, 6], [2, 5],
];

function drawCircle(kx: number, ky: number, solid: boolean): void {
    const ox = kx + 4, oy = ky + 4;
    for (let r = 0; r < 8; r++) {
        const [a, b] = CIRCLE_ROWS[r];
        if (solid || r === 0 || r === 7) {
            fill_rect(ox + a, oy + r, b - a + 1, 1, 1);   // full span
        } else {
            fill_rect(ox + a, oy + r, 1, 1, 1);           // left edge
            fill_rect(ox + b, oy + r, 1, 1, 1);           // right edge
        }
    }
}

/* A one-shot action, deliberately not shaped like a knob: an arc/bar/enum cell
 * would all read as a value you could set, which is the wrong mental model.
 *   armed   — solid frame, circle inside
 *   fired   — the CIRCLE blinks on/off; the frame and cell stay put, so the
 *             confirmation is local to the icon rather than a whole-cell flash
 *   cooling — dashed frame plus a drain bar showing when it re-arms by itself
 */
function drawTriggerBadge(kx: number, ky: number, pvm: ParamVM): void {
    if (pvm.trigger === 'fired') {
        drawSolidFrame(kx, ky);
        /* Blink: the circle goes solid for a moment, then back to its outline.
         * Only the circle changes — the frame and the cell stay put, so the
         * confirmation is local to the icon. */
        drawCircle(kx, ky, pvm.triggerBlink === true);
        return;
    }
    if (pvm.trigger === 'cooling') {
        drawDashedFrame(kx, ky);
        drawCircle(kx, ky, false);
        /* Drain: a bar just inside the top edge, shrinking as the re-arm window
         * elapses. 0 steps = a latch seeded from the DSP's value, no timer to show. */
        const steps = pvm.triggerCool ?? 0;
        if (steps > 0) {
            const inner = KW - 4;
            fill_rect(kx + 2, ky + 2, Math.max(1, Math.round(inner * steps / 8)), 1, 1);
        }
        return;
    }
    drawSolidFrame(kx, ky);
    drawCircle(kx, ky, false);
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
    } else if (pvm.type === 'file' || pvm.renderStyle === 'items') {
        /* A framed name, like the file cell — deliberately NOT the preset look,
         * since a selector sits right beside the preset and two identical cells
         * would be unreadable. */
        drawEnumSquare(kx, ky, [pvm.displayValue], 0);
    } else if (pvm.renderStyle === 'switch' || pvm.renderStyle === 'hbar') {
        /* Ahead of the enum branch below: a two-item off/on list is a boolean,
         * and printing its option name is exactly what the switch replaces.
         *
         * `hbar` was the old on/off bar. Nothing in movy emits it any more, but a
         * third-party movy_config.json can still ask for it by name, and what it
         * always meant was "this param is a boolean" - so it draws the switch. */
        drawSwitch(kx, ky, toggleIsOn(pvm.type, pvm.enumIndex, pvm.normalizedValue));
    } else if (pvm.renderStyle === 'steps') {
        /* One pre-formatted string, not an options array — sfz's voice count runs
         * to 128, and a label per value rebuilt every frame would be absurd. */
        drawEnumSquare(kx, ky, [pvm.displayValue], 0);
    } else if (pvm.renderStyle === 'wave') {
        drawWaveCell(col * CELL_W, ky, pvm.waveShape ?? 10, pvm.waveOff === true);
    } else if (pvm.renderStyle === 'cut') {
        /* One cell, same geometry as the paired graphic — a lone low cut shows
         * only its rising corner, a lone high cut only its falling one. */
        drawCutCurve(ky - 1, col, 1,
            pvm.cutKind === 'lowcut' ? pvm.normalizedValue : null,
            pvm.cutKind === 'highcut' ? pvm.normalizedValue : null);
    } else if (pvm.renderStyle === 'envstage') {
        drawEnvStage(col * CELL_W, ky, pvm.normalizedValue, pvm.envStage ?? 'd');
    } else if (pvm.type === 'enum') {
        drawEnumSquare(kx, ky, pvm.options, pvm.enumIndex);
    } else if (pvm.renderStyle === 'xbox') {
        drawXBox(kx, ky);
    } else if (pvm.renderStyle === 'vbar') {
        drawFader(kx, ky, pvm.normalizedValue);
    } else {
        drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}
