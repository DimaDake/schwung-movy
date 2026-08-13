/* Draws an LFO waveform across two knob cells (Shape+Phase) in place of the two
 * knob widgets — the LFO analogue of drawEnvelope. Reads shape/phase/mode/
 * retrigger from the LfoVizVM. Reusable by the track LFO and synth layouts. */

import type { LfoVizVM } from '../types/viewmodel.js';
import { drawLine, drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';
import { STEP_BASE, PYR_BASE } from '../model/lfo-shapes.js';


/* Bipolar (−1..1) sample of an LFO shape at phase `t` (one cycle = 1). s&h and
 * swishy use fixed deterministic patterns so screenshots are stable. */
/* N-level staircase / N-level pyramid. Split out because the level count rides
 * in the shape id (STEP_BASE + n, PYR_BASE + n) rather than being fixed. */
function steppedRamp(n: number, ph: number): number {
    return (Math.floor(ph * n) / (n - 1)) * 2 - 1;
}
function steppedPyramid(n: number, ph: number): number {
    const up = ph < 0.5;
    const k = Math.floor((up ? ph : 1 - ph) * 2 * n);
    return (Math.min(k, n - 1) / (n - 1)) * 2 - 1;
}

export function shapeSample(shape: number, t: number): number {
    const ph = t - Math.floor(t);
    if (shape >= PYR_BASE)  return steppedPyramid(shape - PYR_BASE, ph);
    if (shape >= STEP_BASE) return steppedRamp(shape - STEP_BASE, ph);
    switch (shape) {
        case 0: return Math.sin(ph * 2 * Math.PI);                 // sine
        case 1:                                                     // tri
            if (ph < 0.25) return ph * 4;
            if (ph < 0.75) return 1 - (ph - 0.25) * 4;
            return -1 + (ph - 0.75) * 4;
        case 2: return ph * 2 - 1;                                 // saw
        case 3: return ph < 0.5 ? 1 : -1;                          // square
        case 4: {                                                  // s&h (stepped)
            const steps = [0.3, -0.7, 0.85, -0.35];
            return steps[Math.floor(ph * steps.length) % steps.length];
        }
        case 5: {                                                  // swishy (smooth walk)
            const pts = [0, 0.7, -0.4, 0.55, -0.8, 0.2, 0];
            const x = ph * (pts.length - 1);
            const i = Math.floor(x), f = x - i;
            return pts[i] + (pts[Math.min(i + 1, pts.length - 1)] - pts[i]) * f;
        }
        case 6: return 1 - ph * 2;                                 // saw down
        case 7: {                                                  // noise (dense jitter)
            const k = Math.floor(ph * 37);
            return ((((k * 2654435761) >>> 0) % 2000) / 1000) - 1;
        }
        case 8:                                                    // envelope glyph (fast AD spike)
            return ph < 0.12 ? -1 + (ph / 0.12) * 2 : 1 - ((ph - 0.12) / 0.88) * 2;
        case 9: {                                                  // staircase glyph (step seq)
            const steps = [-1, -0.3, 0.4, -0.6, 0.85, 0, 0.55, -0.85];
            return steps[Math.floor(ph * steps.length) % steps.length];
        }
        case 10:                                                   // generic squiggle (mseg/wavetable)
            return Math.sin(ph * 2 * Math.PI) * 0.5 + Math.sin(ph * 6 * Math.PI) * 0.3
                 + Math.sin(ph * 10 * Math.PI) * 0.2;
        /* Countless fallbacks, kept for any caller holding a legacy id. Named
         * counts now arrive as STEP_BASE/PYR_BASE + n. */
        case 11: return steppedRamp(4, ph);                        // stepped ramp
        case 12: return steppedPyramid(3, ph);                     // stepped triangle
        case 13: return ph < 0.25 ? 1 : -1;                        // pulse (25% duty)
        case 14: return ph < 0.15 ? 1 : -1;                        // pw-square (narrow)
        /* Ring mod: a carrier gated by a much faster modulator, so the
         * silhouette reads as a dense burst rather than a smooth tone. */
        case 15: return Math.sin(ph * 2 * Math.PI) * Math.sin(ph * 10 * Math.PI);
        case 16: return Math.sin(ph * 2 * Math.PI) * 0.6           // wavetable
                      + Math.sin(ph * 8 * Math.PI) * 0.4;
        /* Warp/Sink are Sine bent toward a square and toward a spike. They exist
         * only so ambiotica's Sine|Warp|Sink list gets three distinct glyphs. */
        case 17: { const s = Math.sin(ph * 2 * Math.PI); return Math.sign(s) * Math.pow(Math.abs(s), 0.35); }
        case 18: { const s = Math.sin(ph * 2 * Math.PI); return Math.sign(s) * Math.pow(Math.abs(s), 3); }
        case 19: return 0;                                         // off — flat line
        default: return Math.sin(ph * 2 * Math.PI);
    }
}

/* Deform (−1..1) skews the within-cycle phase so the specimen shows the warped
 * output shape (peak shifts earlier/later). 0 = identity. */
function skewPhase(ph: number, d: number): number {
    if (!d) return ph;
    const k = d > 0 ? 1 / (1 + d * 0.9) : 1 + (-d) * 0.9;
    return Math.pow(ph, k);
}

/* Plain waveform silhouette in a w×h box — the single-knob enum cell and the
 * enum-overlay row, which differ only in size. Each column is one pixel plus a
 * VERTICAL connector spanning the gap to the previous column: square and pulse
 * edges must be straight risers. drawLfoWave's Bresenham diagonals read as
 * slanted steps once the box is only 5px tall. */
export function drawWave(
    x: number, y: number, w: number, h: number,
    shape: number, cycles: number, colour: 0 | 1,
    dotted = false,
): void {
    const mid = y + (h - 1) / 2, amp = (h - 1) / 2;
    const yAt = (px: number): number =>
        Math.round(mid - shapeSample(shape, ((px - x) / w) * cycles) * amp);
    /* Dotted marks "not sounding". Broken on a diagonal parity (x+y) rather than
     * per-column, so a vertical edge and a flat run both come out dashed — a
     * per-column rule would leave whole edges either solid or missing. */
    const vline = (px: number, a: number, b: number): void => {
        if (!dotted) {
            fill_rect(px, Math.min(a, b), 1, Math.abs(a - b) + 1, colour);
            return;
        }
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let yy = lo; yy <= hi; yy++) if (((yy + px) & 1) === 0) fill_rect(px, yy, 1, 1, colour);
    };

    const firstY = yAt(x);
    let py = firstY;
    vline(x, py, py);
    for (let px = x + 1; px < x + w; px++) {
        const ny = yAt(px);
        vline(px, py, ny);
        py = ny;
    }
    /* Close the cycle at BOTH ends. A periodic wave jumps from its last sample
     * back to its first, and that jump is a real edge of the shape — it lands
     * on the right boundary and, coming from the previous cycle, on the left
     * one too. Without them a saw is a bare ramp that just stops and a square
     * never shows the rising edge that makes it a square. Only drawn when the
     * endpoints actually differ, so a flat "Off" or a pyramid that returns to
     * its start gets no spurious line. */
    if (py !== firstY) {
        vline(x, py, firstY);
        vline(x + w - 1, py, firstY);
    }
}

export function drawLfoWave(rowY: number, g: LfoVizVM): void {
    const x0 = g.startCol * CELL_W + 1;
    const spanW = 2 * CELL_W - 2;                          // 62px
    const topY = rowY + 1, botY = rowY + 14;
    const bipolar = g.mode === 1;
    const baseY = bipolar ? Math.round((topY + botY) / 2) : botY;
    // Rate → cycle density (1..2), depth → amplitude; both default to the fixed
    // specimen (2 cycles, full amplitude) when their param isn't under the graphic.
    const cycles = g.cycles ?? 2;
    const amp = (g.ampScale ?? 1) * (bipolar ? (botY - topY) / 2 : (botY - topY));

    drawDottedH(x0, x0 + spanW, baseY);                    // baseline conveys mode

    const yAt = (px: number): number => {
        const u = (px - x0) / spanW;                        // 0..1 across span
        let t = u * cycles + g.phase;
        if (g.deform) { const c = Math.floor(t); t = c + skewPhase(t - c, g.deform); }
        const v = shapeSample(g.shape, t);
        return bipolar
            ? Math.round(baseY - v * amp)
            : Math.round(botY - ((v + 1) / 2) * amp);
    };

    let prevX = x0, prevY = yAt(x0);
    for (let px = x0 + 1; px <= x0 + spanW; px++) {
        const y = yAt(px);
        drawLine(prevX, prevY, px, y);
        prevX = px; prevY = y;
    }

    // Retrigger: bold 3×3 dot at the start of the LFO line.
    if (g.retrigger) {
        const dy = Math.max(topY, Math.min(botY - 2, yAt(x0) - 1));
        fill_rect(x0, dy, 3, 3, 1);
    }
}
