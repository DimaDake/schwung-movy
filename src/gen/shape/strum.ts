/* STRUM on a held chord part (create/feel.ts), after the performance modes
 * of hardware chord instruments (Telepathic Instruments' Orchid, the
 * KeyStep's strum): the voices of a chord one after another instead of on
 * one tick. Down and up strums at a fixed pace; ROLL slows as it goes, as a
 * hand does; SLOP loosens each voice on its own; HARP runs the chord up
 * through an octave or two across the first half of the chord. Positions
 * 1..4 are the old 2..8 tick strums, so a take keeps its sound. */

import type { Rng } from '../rng.js';
import { type Ev, TPS } from '../types.js';

export const STRUMS = ['OFF', '2 TICKS', '4 TICKS', '6 TICKS', '8 TICKS', '12 TICKS',
    'UP 6', 'UP 12', 'ROLL', 'SLOP', 'HARP', 'HARP 2X'] as const;

/** Spreads one event's voices in time at STRUM position `v`; `room` is the
 *  span to the next event, so a harp never runs into the next chord. */
export function strumEvent(e: Ev, v: number, room: number, r: Rng): void {
    const vs = [...e.voices].sort((a, b) => a.pitch - b.pitch);
    const n = vs.length;
    const mode = STRUMS[v] ?? 'OFF';
    if (mode === 'OFF' || n < 2) return;
    if (v <= 5) { vs.forEach((x, i) => { x.dt = i * v * 2 + (v === 5 ? i * 2 : 0); }); return; }
    if (mode === 'UP 6' || mode === 'UP 12') { vs.forEach((x, i) => { x.dt = (n - 1 - i) * (mode === 'UP 6' ? 6 : 12); }); return; }
    if (mode === 'ROLL') { vs.forEach((x, i) => { x.dt = Math.round(TPS * 1.5 * Math.pow(i / (n - 1), 1.6)); }); return; }
    if (mode === 'SLOP') {
        vs.forEach((x) => { x.dt = Math.round(r() * 10); x.vel = Math.max(1, Math.min(127, Math.round(x.vel + (r() - 0.5) * 16))); });
        return;
    }
    /* HARP: the chord and its octaves above, up to the top of the keyboard's
     * useful range, spread over half the room the chord has. */
    const octs = mode === 'HARP 2X' ? 2 : 1;
    const up = Array.from({ length: octs }, (_, o) => vs.map((x) => ({ ...x, pitch: x.pitch + 12 * (o + 1) })))
        .flat().filter((x) => x.pitch <= 100);
    const all = [...vs, ...up];
    const pace = Math.max(3, Math.floor(room / 2 / all.length));
    all.forEach((x, i) => { x.dt = i * pace; x.vel = Math.max(1, Math.round(x.vel * (1 - 0.25 * i / all.length))); });
    e.voices = all;
}
