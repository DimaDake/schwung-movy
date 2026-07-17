/* Draws an LFO waveform across two knob cells (Shape+Phase) in place of the two
 * knob widgets — the LFO analogue of drawEnvelope. Reads shape/phase/mode/
 * retrigger from the LfoVizVM. Reusable by the track LFO and synth layouts. */

import type { LfoVizVM } from '../types/viewmodel.js';
import { drawLine, drawDottedH } from './primitives.js';
import { CELL_W } from './layout.js';

const CYCLES = 2;

/* Bipolar (−1..1) sample of an LFO shape at phase `t` (one cycle = 1). s&h and
 * swishy use fixed deterministic patterns so screenshots are stable. */
export function shapeSample(shape: number, t: number): number {
    const ph = t - Math.floor(t);
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

export function drawLfoWave(rowY: number, g: LfoVizVM): void {
    const x0 = g.startCol * CELL_W + 1;
    const spanW = 2 * CELL_W - 2;                          // 62px
    const topY = rowY + 1, botY = rowY + 14;
    const bipolar = g.mode === 1;
    const baseY = bipolar ? Math.round((topY + botY) / 2) : botY;
    const amp = bipolar ? (botY - topY) / 2 : (botY - topY);

    drawDottedH(x0, x0 + spanW, baseY);                    // baseline conveys mode

    const yAt = (px: number): number => {
        const u = (px - x0) / spanW;                        // 0..1 across span
        let t = u * CYCLES + g.phase;
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
