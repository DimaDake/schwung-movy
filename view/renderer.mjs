/* view/renderer.mjs — pure display functions, no state
 * Calls fill_rect / clear_screen as Schwung globals (mocked in browser tests).
 * fontPrint / fontWidth are imported from ui_font.mjs.
 */
import { fontPrint, fontWidth, FONT_HEIGHT } from '../ui_font.mjs';

/* ── Layout constants (128 × 64 display) ───────────────────────────────── */
const W = 128;

/* y-coordinates for each display zone */
const HEADER_H = 8;    /* y=0..7   inverted header bar */
const BAR_Y    = 8;    /* y=8..10  bank indicator (3px) */
const BAR_H    = 3;
const ROW0_Y   = 11;   /* y=11..23 knob area row 1 (13px) */
const LBL0_Y   = 24;   /* y=24..30 label bar row 1 (7px) */
const ROW1_Y   = 31;   /* y=31..43 knob area row 2 (13px) */
const LBL1_Y   = 44;   /* y=44..50 label bar row 2 (7px) */
/* y=51..63  RESERVED (13px) */

const CELL_W   = 32;   /* 128 / 4 columns */
const LBL_H    = 7;    /* FONT_HEIGHT(5) + 2px padding */
const KW       = 10;   /* knob placeholder box size */

/* ── Shared helpers ─────────────────────────────────────────────────────── */

function drawInvertedHeader(left, right) {
    fill_rect(0, 0, W, HEADER_H, 1);
    fontPrint(2, 1, left, 0);
    if (right) fontPrint(W - fontWidth(right) - 2, 1, right, 0);
}

function drawBankBar(bankIndex, bankCount) {
    if (bankCount <= 1) return;
    const segW = Math.floor((W - (bankCount - 1)) / bankCount);
    for (let b = 0; b < bankCount; b++) {
        const sx = b * (segW + 1);
        const sw = b === bankCount - 1 ? W - sx : segW;
        /* active segment: 2px from top; inactive: 1px at bottom */
        const y = b === bankIndex ? BAR_Y     : BAR_Y + BAR_H - 1;
        const h = b === bankIndex ? 2         : 1;
        fill_rect(sx, y, sw, h, 1);
    }
}

/* Arc knob: 300° sweep from 7-o'clock (min) to 5-o'clock (max). */
function drawArcKnob(kx, ky, normVal) {
    const cx = kx + 4.5;
    const cy = ky + 4.5;
    const r  = 4.0;
    const START = 210;
    const RANGE = 300;
    for (let d = START; d <= START + RANGE; d += 22) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    const fillEnd = START + normVal * RANGE;
    for (let d = START; d <= fillEnd; d += 6) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    if (normVal > 0) {
        const rad = fillEnd * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
}

function drawEnumKnob(kx, ky) {
    fill_rect(kx + 1, ky + 1, KW - 2, KW - 2, 1);
}

function drawKnobWidget(col, rowY, pvm) {
    const kx = col * CELL_W + Math.floor((CELL_W - KW) / 2);
    const ky = rowY + 1;
    if (pvm.type === 'enum') {
        drawEnumKnob(kx, ky);
    } else {
        drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}

/* Draw one 32px-wide label cell. Shows shortName normally, displayValue on touch. */
function drawLabelCell(col, lblY, pvm) {
    fill_rect(col * CELL_W, lblY, CELL_W, LBL_H, 1);
    const text = pvm.touched ? pvm.displayValue : pvm.shortName;
    fontPrint(col * CELL_W + 1, lblY + 1, text, 0);
}

/* Draw a full row (4 knob cells + 4 label cells) */
function drawKnobRow(params, rowY, lblY) {
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        drawKnobWidget(col, rowY, pvm);
        drawLabelCell(col, lblY, pvm);
    }
}

/* ── Main views ─────────────────────────────────────────────────────────── */

function drawEnumOverlay(vm) {
    const ov  = vm.overlay;
    const row = Math.floor(ov.slot / 4);
    const col = ov.slot % 4;
    const pvm = vm.rows[row] && vm.rows[row][col];
    const fullName = pvm ? pvm.fullName : "";
    const valueStr = ov.options[ov.selected] || String(ov.selected);

    clear_screen();
    drawInvertedHeader(fullName, valueStr);

    const LIST_TOP = 8;
    const ROW_H    = 7;
    const VISIBLE  = Math.floor((64 - LIST_TOP) / ROW_H);
    const n        = ov.options.length;
    const half     = Math.floor(VISIBLE / 2);
    const start    = Math.max(0, Math.min(ov.selected - half, n - VISIBLE));

    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = LIST_TOP + i * ROW_H;
        if (idx === ov.selected) {
            fill_rect(0, y, W - 2, ROW_H, 1);
            fontPrint(2, y + 1, ov.options[idx], 0);
        } else {
            fontPrint(2, y + 1, ov.options[idx], 1);
        }
    }

    if (n > VISIBLE) {
        const trackH = 64 - LIST_TOP;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = LIST_TOP + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(W - 1, LIST_TOP, 1, trackH, 1);
        fill_rect(W - 1, thumbY,   1, thumbH, 0);
    }
}

export function renderKnobsView(vm) {
    if (vm.overlay) { drawEnumOverlay(vm); return; }
    clear_screen();

    if (vm.toast) {
        drawInvertedHeader(vm.toast.fullName, vm.toast.value);
    } else {
        const rightW    = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW  = W - rightW - 4;
        let dispName    = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        drawInvertedHeader(dispName, vm.bankName);
    }

    drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, "No params", 1);
        return;
    }

    drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
    drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
}

export function renderKeysView(moduleName, rootNote, midiNoteName) {
    clear_screen();

    /* Fit module name after "Movy " in header */
    let abbrev = moduleName;
    const prefixW = fontWidth("Movy ");
    while (abbrev.length > 1 && prefixW + fontWidth("[" + abbrev + "]") > W - 4) {
        abbrev = abbrev.slice(0, -1);
    }
    if (abbrev !== moduleName) abbrev += "~";

    drawInvertedHeader("Movy", "[" + abbrev + "]");

    const rootName = midiNoteName(rootNote);
    const topName  = midiNoteName(rootNote + 24);
    fontPrint(2,                       HEADER_H + 5, rootName, 1);
    fontPrint(W - fontWidth(topName) - 2, HEADER_H + 5, topName,  1);

    /* Footer */
    const FOOTER_Y = 57;
    fill_rect(0, FOOTER_Y, W, FONT_HEIGHT + 2, 1);
    fontPrint(2, FOOTER_Y + 1, "L/R:oct  U/D:semi  S+L:mod", 0);
}

export function renderBrowseView(modules, browseIndex) {
    clear_screen();
    drawInvertedHeader("Sound module", null);

    const FOOTER_Y = 57;
    const LIST_TOP = HEADER_H + 2;
    const LIST_BOT = FOOTER_Y - 2;
    const rowH     = FONT_HEIGHT + 2;

    if (modules.length === 0) {
        fontPrint(2, LIST_TOP, "No modules found", 1);
    } else {
        const visible = Math.floor((LIST_BOT - LIST_TOP) / rowH);
        const halfVis = Math.floor(visible / 2);
        const startIdx = Math.max(0, Math.min(browseIndex - halfVis, modules.length - visible));
        for (let i = 0; i < visible; i++) {
            const idx = startIdx + i;
            if (idx >= modules.length) break;
            const y = LIST_TOP + i * rowH;
            if (idx === browseIndex) {
                fill_rect(0, y - 1, W, rowH, 1);
                fontPrint(2, y, modules[idx].name, 0);
            } else {
                fontPrint(2, y, modules[idx].name, 1);
            }
        }
    }

    fill_rect(0, FOOTER_Y, W, FONT_HEIGHT + 2, 1);
    fontPrint(2, FOOTER_Y + 1, "Back:cancel  Click:load", 0);
}
