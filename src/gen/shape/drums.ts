/* Drum stages: CLEAN removes accidental doubles and flams; GHOSTS adds quiet
 * snare or hat hits where the groove leaves room; FILL writes a fill into the
 * end of the clip; HATS re-writes the hat line at a new rate. Every hit is on
 * a pad the kit has. */

import type { GenCtx } from '../analysis/context.js';
import { type Kit, padFor, type PadRole } from '../analysis/kit.js';
import { strength } from '../analysis/events.js';
import type { Rng } from '../rng.js';
import { BAR, type Note, TPS } from '../types.js';

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 90; };

/** 0..10: doubles and flams on one pad within a window that grows to a 16th,
 *  and accidental grazes quieter than a share of the part's median velocity
 *  that grows to 45 %. */
export function clean(notes: Note[], v: number): Note[] {
    if (v <= 0) return notes;
    const win = Math.round(v * 2.2);
    const sorted = [...notes].sort((a, b) => a.tick - b.tick || b.vel - a.vel);
    const kept: Note[] = [];
    for (const n of sorted) {
        const twin = kept.find((k) => k.pitch === n.pitch && Math.abs(k.tick - n.tick) <= win);
        if (twin) { if (n.vel > twin.vel) twin.vel = n.vel; continue; }
        kept.push({ ...n });
    }
    const floor = median(kept.map((n) => n.vel)) * 0.045 * v;
    return kept.filter((n) => n.vel >= floor);
}

const free = (notes: Note[], pad: number, tick: number) => !notes.some((n) => n.pitch === pad && Math.abs(n.tick - tick) < TPS / 2);

/** `count` ghost hits on the pad playing `role`, weakest 16ths first. */
export function ghosts(ctx: GenCtx, kit: Kit, notes: Note[], count: number, role: PadRole, vel: number, r: Rng): Note[] {
    if (count <= 0) return notes;
    const weak = (pad: number) => {
        const out: number[] = [];
        for (let t = 0; t < ctx.end; t += TPS) if (strength(t) <= 0.45 && free(notes, pad, t)) out.push(t);
        return out;
    };
    /* A busy pad (a snare already on every weak 16th) has no room: the
     * ghosts go to the next pad that does. */
    const pads = [role, 'snare', 'hat', 'perc', 'tom'].map((x) => padFor(kit, x as PadRole, notes)).filter((p): p is number => p !== null);
    const pad = pads.find((p) => weak(p).length >= Math.min(count, 4)) ?? pads[0];
    if (pad === undefined) return notes;
    const slots = weak(pad);
    const chosen = slots.map((t) => ({ t, w: strength(t) + r() * 0.3 })).sort((a, b) => a.w - b.w).slice(0, count);
    return [...notes, ...chosen.map(({ t }) => ({ tick: t, gate: TPS / 2, pitch: pad, vel: Math.round(vel + r() * 8) }))];
}

/** A fill over the last `steps` 16ths: snare and toms, rising in velocity,
 *  replacing what played there except the kick on the downbeat. */
export function fill(ctx: GenCtx, kit: Kit, notes: Note[], steps: number, density: number, r: Rng): Note[] {
    if (steps <= 0) return notes;
    const from = ctx.end - steps * TPS;
    const pads = [padFor(kit, 'snare', notes), ...kit.by.tom].filter((p): p is number => p !== null);
    if (!pads.length) return notes;
    const kick = padFor(kit, 'kick', notes);
    const keep = notes.filter((n) => n.tick < from || (n.pitch === kick && n.tick % (BAR / 4) === 0));
    const add: Note[] = [];
    for (let s = 0; s < steps; s++) {
        if (s % 2 === 1 && r() > density) continue;
        const pad = pads[Math.min(pads.length - 1, Math.floor((s / steps) * pads.length))];
        add.push({ tick: from + s * TPS, gate: TPS / 2, pitch: pad, vel: Math.round(70 + 50 * (s / Math.max(1, steps - 1))) });
    }
    return [...keep, ...add];
}

export const HAT_RATES = ['QUARTER', 'OFFBEAT', '8THS', '16THS', 'GALLOP'] as const;

/** The hat line at a rate (the closed hat; offbeat opens the open hat when the
 *  kit has one), velocity on the metre. */
export function hats(ctx: GenCtx, kit: Kit, notes: Note[], rate: number): Note[] {
    const hat = padFor(kit, 'hat', notes);
    if (hat === null) return notes;
    const open = padFor(kit, 'open', notes);
    const rest = notes.filter((n) => n.pitch !== hat && n.pitch !== open);
    const out: Note[] = [];
    for (let s = 0; s < ctx.end / TPS; s++) {
        const i = s % 16;
        const on = rate === 0 ? i % 4 === 0 : rate === 1 ? i % 4 === 2 : rate === 2 ? i % 2 === 0 : rate === 3 ? true : i % 4 !== 1;
        if (rate === 1 && open !== null && i % 2 === 1) {
            out.push({ tick: s * TPS, gate: TPS / 2, pitch: hat, vel: Math.round(50 + 20 * strength(s * TPS)) });
            continue;
        }
        if (!on) continue;
        /* OFFBEAT is the house hat: the open hat on the "and"s, the closed
         * one keeping the 16ths in between. */
        if (rate === 1 && open !== null) {
            out.push({ tick: s * TPS, gate: TPS / 2, pitch: open, vel: 90 });
            continue;
        }
        out.push({ tick: s * TPS, gate: TPS / 2, pitch: hat, vel: Math.round(55 + 45 * strength(s * TPS)) });
    }
    return [...rest, ...out];
}
