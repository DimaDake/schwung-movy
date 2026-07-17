import type { ParamVM, EnvelopeVM } from '../types/viewmodel.js';
import { drawLine, drawDot, drawDottedV } from './primitives.js';
import { W, CELL_W } from './layout.js';

/* An envelope graphic in place of its knob widgets. A full ADSR spans the whole
 * line; partial envelopes (AD/AR/ASR/ADS) span only their cells (env.startCol..
 * +cellCount-1) and keep the remaining cells as knobs. Each stage drives one
 * vertex; sustain is always a level, never a time. */
export function drawEnvelope(rowY: number, params: (ParamVM | null)[], env: EnvelopeVM): void {
    if (env.cellCount === 4 && env.startCol === 0) {
        drawFullAdsr(rowY, params);
        return;
    }
    drawPartialEnv(rowY, params, env);
}

/* Full ADSR across the full line width. adsr = [A,D,S,R] ParamVMs (column order
 * guaranteed by the layout planner). A→peak x, D→sustain-start x, S→plateau y
 * (level), R→end x. Gate-off is a fixed reference x so release is always
 * visible. Kept pixel-identical to the original single-envelope renderer. */
function drawFullAdsr(rowY: number, adsr: (ParamVM | null)[]): void {
    const a = adsr[0]?.normalizedValue ?? 0;
    const d = adsr[1]?.normalizedValue ?? 0;
    const s = adsr[2]?.normalizedValue ?? 0;
    const r = adsr[3]?.normalizedValue ?? 0;

    const baseY = rowY + 14, topY = rowY + 1;
    const usableH = baseY - topY;                 // 13px of vertical travel
    const gateX = 88;                             // fixed note-off reference

    const startX = 2;
    const peakX  = startX + Math.round(a * 26);                       // 2..28
    let sustStartX = peakX + 4 + Math.round(d * 24);
    if (sustStartX > gateX - 2) sustStartX = gateX - 2;
    const susY   = baseY - Math.round(s * usableH);                   // sustain level
    let relEndX  = gateX + 4 + Math.round(r * 33);
    if (relEndX > W - 2) relEndX = W - 2;                             // 92..126

    drawLine(startX, baseY, peakX, topY);          // attack rise
    drawLine(peakX, topY, sustStartX, susY);       // decay fall
    drawLine(sustStartX, susY, gateX, susY);       // sustain plateau
    drawLine(gateX, susY, relEndX, baseY);         // release fall

    // Dotted verticals highlight the plateau timing (the two middle corners).
    drawDottedV(sustStartX, susY, baseY);
    drawDottedV(gateX, susY, baseY);

    // Bold vertex dots, nudged so the 2×2 marker straddles the vertex.
    drawDot(Math.max(0, peakX - 1), topY);
    drawDot(sustStartX - 1, Math.max(rowY, susY - 1));
    drawDot(gateX - 1, Math.max(rowY, susY - 1));
    drawDot(Math.min(W - 2, relEndX - 1), baseY - 1);
}

/* Partial envelope (2 or 3 stages) confined to its span. Builds a polyline from
 * the present stages: attack always rises to a peak; decay/release fall; a
 * sustain stage holds a plateau at its level. Geometry is proportional to the
 * span so a 2-cell and a 3-cell envelope both read clearly at their width. */
function drawPartialEnv(rowY: number, params: (ParamVM | null)[], env: EnvelopeVM): void {
    const leftX  = env.startCol * CELL_W + 2;
    const rightX = (env.startCol + env.cellCount) * CELL_W - 2;
    const baseY = rowY + 14, topY = rowY + 1;
    const usableH = baseY - topY;
    const span = rightX - leftX;

    // Value per stage, read from the cell at its column position.
    const roles = env.roles;
    const val: Record<string, number> = {};
    for (let k = 0; k < roles.length; k++) val[roles[k]] = params[env.startCol + k]?.normalizedValue ?? 0;
    const has = (r: string) => roles.includes(r);
    const susY = has('s') ? baseY - Math.round(val['s'] * usableH) : baseY;

    const pts: [number, number][] = [[leftX, baseY]];
    const peakX = Math.min(rightX - 2, leftX + 4 + Math.round(val['a'] * span * 0.4));
    pts.push([peakX, topY]);                                       // attack peak
    let cur = peakX;
    if (has('d')) {                                               // decay to sustain (or base)
        cur = Math.min(rightX - 2, cur + 4 + Math.round(val['d'] * span * 0.35));
        pts.push([cur, susY]);
    } else if (has('s')) {                                        // ASR: instant drop to level
        pts.push([cur, susY]);
    }
    if (has('s')) {                                               // hold the plateau
        const plateauEnd = has('r') ? Math.round(leftX + span * 0.7) : rightX;
        if (plateauEnd > cur) { pts.push([plateauEnd, susY]); cur = plateauEnd; }
    }
    if (has('r')) {                                              // release to base
        const endX = Math.min(rightX, cur + 4 + Math.round(val['r'] * span * 0.4));
        pts.push([endX, baseY]);
    }

    for (let i = 0; i < pts.length - 1; i++) drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    for (const [px, py] of pts) drawDot(Math.min(W - 2, Math.max(0, px - 1)), Math.max(rowY, py - 1));
    if (has('s')) drawDottedV(Math.min(W - 2, cur), susY, baseY);  // mark the plateau end
}
