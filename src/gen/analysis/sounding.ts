/* What a scene sounds, per half-bar of master time: a duration-weighted
 * pitch-class profile and the lowest sounding pitch. Speed and transpose are
 * applied, only the loop window plays, and a short clip repeats to fill the
 * scene (the same reading ai/harmony.ts sceneChords does, weighted). */

import { type AiClip, HALF, TPS } from '../types.js';
import { pc } from '../theory/pc.js';

export interface Segment { w: number[]; bass: number; total: number }

export function clipMasterTicks(c: AiClip): number {
    return Math.round(c.len * TPS * c.scaleDen / c.scaleNum);
}

export function sceneTicks(clips: AiClip[]): number {
    return Math.max(HALF * 2, ...clips.filter((c) => c.len > 0).map(clipMasterTicks));
}

const empty = (): Segment => ({ w: Array(12).fill(0), bass: -1, total: 0 });

/** Half-bar segments over `span` master ticks (default: the scene's length). */
export function soundingSegments(clips: AiClip[], span = sceneTicks(clips), seg = HALF): Segment[] {
    const n = Math.max(1, Math.ceil(span / seg));
    const out = Array.from({ length: n }, empty);
    for (const c of clips) {
        if (c.len <= 0) continue;
        const loop = clipMasterTicks(c);
        const k = c.scaleDen / c.scaleNum;
        const w0 = c.loopStart * TPS;
        const heard = c.notes.filter((x) => x.tick >= w0 && x.tick < w0 + c.len * TPS);
        for (let off = 0; off < span; off += loop) {
            for (const x of heard) {
                const s = off + (x.tick - w0) * k;
                const e = Math.min(span, s + Math.max(1, x.gate * k));
                const p = x.pitch + c.transpose;
                for (let i = Math.floor(s / seg); i < n && i * seg < e; i++) {
                    const ov = Math.min(e, (i + 1) * seg) - Math.max(s, i * seg);
                    if (ov <= 0) continue;
                    /* An attack counts more than its tail: a chord struck in
                     * this half-bar says more about it than one ringing over. */
                    const wgt = ov + (s >= i * seg ? TPS * 2 : 0);
                    out[i].w[pc(p)] += wgt;
                    out[i].total += wgt;
                    if (out[i].bass < 0 || p < out[i].bass) out[i].bass = p;
                }
            }
        }
    }
    return out;
}

/** The whole profile, for key finding. */
export function profile(segs: Segment[]): number[] {
    const w = Array(12).fill(0);
    for (const s of segs) for (let i = 0; i < 12; i++) w[i] += s.w[i];
    return w;
}

/** Pitch classes that really sound in a segment (not a passing touch). */
export function heardPcs(s: Segment, share = 0.12): number[] {
    const max = Math.max(0, ...s.w);
    if (max <= 0) return [];
    return s.w.map((v, i) => [v, i]).filter(([v]) => v >= max * share).map(([, i]) => i);
}
