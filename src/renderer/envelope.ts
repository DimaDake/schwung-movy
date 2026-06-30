import type { ParamVM } from '../types/viewmodel.js';
import { drawLine, drawDot, drawDottedV } from './primitives.js';
import { W } from './layout.js';

/* Single ADSR envelope across the full line width. adsr = [A,D,S,R] ParamVMs
 * (column order guaranteed by the layout planner). Each param drives one vertex
 * in one direction: A→peak x, D→sustain-start x, S→plateau y (level), R→end x.
 * Gate-off is a fixed reference x so release is always visible. */
export function drawEnvelope(rowY: number, adsr: (ParamVM | null)[]): void {
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
