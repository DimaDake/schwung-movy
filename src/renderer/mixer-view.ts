/* mixer-view.ts — the mixer page's body: sixteen strips, drawn into the band
 * Schwung's custom page hands over (header, bank bar and the held-knob toast
 * stay Schwung's).
 *
 * Every strip is 7 px on an 8 px pitch — 16 × 8 is the screen — so the gap is
 * exactly one pixel and each fader is as wide as the panel allows. 7 is odd,
 * so the stereo pair splits 3 + 4 rather than leaving a seam between them.
 *
 * The fader is a 1 px line XOR-ed over the strip: dark where it crosses the
 * meter, lit above it, so it reads against either without a frame or a cap.
 * No tick marks and nothing marks which eight the knobs drive — the bank bar
 * in the header already says that, and the mock showed everything more read
 * as clutter at this size. */

import { fontPrint5x3 } from '../font/index5x3.js';
import type { DrawCtx } from './schwung-ctx.js';
import { METER_STRIDE, METER_TRACKS } from '../mixer/meter.js';

const SCREEN_H = 64;
const PITCH = 8;
const STRIP_W = 7;
const LEFT_W = 3;
/** Rows under the meters: a clear row, 5 rows of digits, a clear row. The
 *  held box fills all seven, so the digits sit centred in it. */
const LABEL_H = 7;
const DIGIT_Y = 1;

/* `ctx` has no read-back, so the XOR is computed from what this strip drew:
 * each channel's run of the line is lit unless its meter is lit beneath it.
 * Two runs, not seven pixels — this is drawn sixteen times a frame. */
function faderLine(ctx: DrawCtx, x: number, y: number, topL: number, topR: number): void {
    ctx.fillRect(x, y, LEFT_W, 1, y >= topL ? 0 : 1);
    ctx.fillRect(x + LEFT_W, y, STRIP_W - LEFT_W, 1, y >= topR ? 0 : 1);
}

/** `levels`: METER_STRIDE positions per track (fader, left, right), 0..1.
 *  `held`: the track whose knob is held, or -1. */
export function drawMixerBody(ctx: DrawCtx, band: { x: number; y: number; w: number; h: number },
                              levels: ArrayLike<number>, held: number): void {
    /* The band Schwung hands a custom page is the two knob rows' extent with
     * no footer below them, which runs past the panel (measured: y 11, h 96).
     * The panel's edge is the real floor. */
    const bottom = Math.min(band.y + band.h, SCREEN_H);
    const floor = bottom - LABEL_H - 1;         // last meter row
    const travel = floor - band.y;
    const rowOf = (f: number): number => floor - Math.round(Math.max(0, Math.min(1, f)) * travel);
    const emit = (x: number, y: number, w: number, h: number, c: number) => ctx.fillRect(x, y, w, h, c);
    ctx.fillRect(band.x, band.y, band.w, bottom - band.y, 0);
    for (let t = 0; t < METER_TRACKS; t++) {
        const x = band.x + t * PITCH;
        const fader = levels[t * METER_STRIDE];
        const l = levels[t * METER_STRIDE + 1], r = levels[t * METER_STRIDE + 2];
        /* A silent channel draws nothing, not a 1 px floor: the floor row is
         * where a fader at -inf sits, and it has to be visible there. */
        const topL = l > 0 ? rowOf(l) : floor + 1;
        const topR = r > 0 ? rowOf(r) : floor + 1;
        if (topL <= floor) ctx.fillRect(x, topL, LEFT_W, floor - topL + 1, 1);
        if (topR <= floor) ctx.fillRect(x + LEFT_W, topR, STRIP_W - LEFT_W, floor - topR + 1, 1);
        faderLine(ctx, x, rowOf(fader), topL, topR);

        const isHeld = t === held, c = isHeld ? 0 : 1, ly = floor + 1 + DIGIT_Y;
        if (isHeld) ctx.fillRect(x, floor + 1, STRIP_W, LABEL_H, 1);
        const n = t + 1;
        /* 10-16: two 3 px digits plus a gap overrun 7 px, and the tens digit
         * is always a 1 — drawn as a bare stem it costs one column. */
        if (n < 10) fontPrint5x3(x + 2, ly, String(n), c, emit);
        else { ctx.fillRect(x + 1, ly, 1, 5, c); fontPrint5x3(x + 3, ly, String(n % 10), c, emit); }
    }
}
