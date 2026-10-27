/* Notes ↔ events. A played chord is rarely struck at one tick (role.ts: the
 * device's dexed pad spread its notes over 8 ticks), so notes within half a
 * step of the first are one event; each keeps its own offset. */

import { type Ev, type Note, TPS } from '../types.js';

const SPREAD = TPS / 2;

export function toEvents(notes: Note[]): Ev[] {
    const sorted = [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
    const out: Ev[] = [];
    for (const n of sorted) {
        const last = out[out.length - 1];
        if (last && n.tick - last.tick <= SPREAD) {
            last.voices.push({ pitch: n.pitch, dt: n.tick - last.tick, gate: n.gate, vel: n.vel });
        } else {
            out.push({ tick: n.tick, voices: [{ pitch: n.pitch, dt: 0, gate: n.gate, vel: n.vel }] });
        }
    }
    for (const e of out) e.voices.sort((a, b) => a.pitch - b.pitch);
    return out;
}

/** Events back to notes, clamped into [0, end) ticks; one note per pitch per tick. */
export function fromEvents(evs: Ev[], end: number): Note[] {
    const out: Note[] = [];
    const seen = new Set<number>();
    for (const e of evs) {
        for (const v of e.voices) {
            const tick = Math.round(e.tick + v.dt);
            if (tick < 0 || tick >= end) continue;
            const pitch = Math.max(0, Math.min(127, Math.round(v.pitch)));
            const k = tick * 128 + pitch;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({ tick, pitch, gate: Math.max(1, Math.min(Math.round(v.gate), end - tick)),
                vel: Math.max(1, Math.min(127, Math.round(v.vel))) });
        }
    }
    return out.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

export const cloneEvs = (evs: Ev[]): Ev[] => evs.map((e) => ({ tick: e.tick, voices: e.voices.map((v) => ({ ...v })) }));

/** Metrical weight of a tick in 4/4 on the 16th grid: bar 1, beat 3, beats,
 *  8ths, 16ths; off the grid counts as its nearest 16th, less. */
export function strength(tick: number): number {
    const s = Math.round(tick / TPS);
    const off = Math.abs(tick - s * TPS) > 3 ? 0.5 : 1;
    const inBar = ((s % 16) + 16) % 16;
    const w = inBar === 0 ? 1 : inBar === 8 ? 0.85 : inBar % 4 === 0 ? 0.7 : inBar % 2 === 0 ? 0.45 : 0.25;
    return w * off;
}

export const isStrong = (tick: number): boolean => strength(tick) >= 0.7;

/** Ticks from this event to the next onset (or the clip end, looping). */
export function spanTo(evs: Ev[], i: number, end: number): number {
    const next = i + 1 < evs.length ? evs[i + 1].tick : evs.length ? evs[0].tick + end : end;
    return Math.max(1, next - evs[i].tick);
}
