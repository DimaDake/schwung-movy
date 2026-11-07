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
 *  accidental grazes, and slips onto a neighbouring pad. A graze is quieter
 *  than a share of its own pad's median (growing to 45 %) or, where that
 *  pad plays louder than twice it, than an absolute floor growing to 67: a
 *  share of the whole part's median left a graze on a loud kick in, and a
 *  hat's ghosts are quieter than a kick's accents. */
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
    const med = new Map<number, number>();
    for (const p of new Set(kept.map((n) => n.pitch))) med.set(p, median(kept.filter((n) => n.pitch === p).map((n) => n.vel)));
    const floor = (p: number) => Math.max(med.get(p)! * 0.045 * v, Math.min(6.7 * v, med.get(p)! * 0.5));
    return slips(kept.filter((n) => n.vel >= floor(n.pitch)), v);
}

/* A slip: a hit on a pad next to the one the loop plays there in most of its
 * other bars, alone (an odd hit within two 16ths makes a fill's run), in a bar that
 * otherwise plays the loop (a fill bar does not). Repaired from CLEAN 2 up. */
function slips(notes: Note[], v: number): Note[] {
    if (v < 2 || !notes.length) return notes;
    const at = (n: Note) => Math.round(n.tick / TPS);
    const barOf = (n: Note) => Math.floor(at(n) / 16);
    const bars = Math.max(...notes.map(barOf)) + 1;
    if (bars < 3) return notes;
    const has = new Set(notes.map((n) => `${barOf(n)}:${at(n) % 16}:${n.pitch}`));
    const usual = (b: number, s: number, p: number) => {
        let k = 0;
        for (let x = 0; x < bars; x++) if (x !== b && has.has(`${x}:${s}:${p}`)) k++;
        return k * 2 >= bars - 1;
    };
    const uses = new Map<number, number>();
    for (const n of notes) uses.set(n.pitch, (uses.get(n.pitch) ?? 0) + 1);
    const fix = new Map<Note, number>();
    for (const n of notes) {
        const b = barOf(n), s = at(n) % 16;
        if (usual(b, s, n.pitch)) continue;
        /* Onto a pad the part plays far more: a slip lands on a pad the loop
         * hardly uses, and slips repeating at one spot must not outvote it. */
        const q = [n.pitch - 1, n.pitch + 1, n.pitch - 2, n.pitch + 2]
            .find((p) => !has.has(`${b}:${s}:${p}`) && usual(b, s, p) && (uses.get(p) ?? 0) >= 2 * (uses.get(n.pitch) ?? 0));
        if (q !== undefined) fix.set(n, q);
    }
    /* Isolated: no other hit the loop does not play within two 16ths. */
    const run = (n: Note) => notes.some((m) => m !== n && barOf(m) === barOf(n) && Math.abs(at(m) - at(n)) <= 2 && !usual(barOf(m), at(m) % 16, m.pitch));
    const odd = (b: number) => notes.filter((n) => barOf(n) === b && !fix.has(n) && !usual(b, at(n) % 16, n.pitch)).length;
    const size = (b: number) => notes.filter((n) => barOf(n) === b).length;
    return notes.map((n) => (fix.has(n) && !run(n) && odd(barOf(n)) <= 0.25 * size(barOf(n)) ? { ...n, pitch: fix.get(n)! } : n));
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

/** A fill over the `steps` 16ths before `to` (the clip's end): snare and
 *  toms, rising in velocity, replacing what played there except the kick on
 *  the downbeat. */
export function fill(ctx: GenCtx, kit: Kit, notes: Note[], steps: number, density: number, r: Rng,
    to = ctx.end, use: 'both' | 'snare' | 'toms' = 'both'): Note[] {
    if (steps <= 0) return notes;
    const from = to - steps * TPS;
    const pads = [use === 'toms' ? null : padFor(kit, 'snare', notes), ...(use === 'snare' ? [] : kit.by.tom)]
        .filter((p): p is number => p !== null);
    if (!pads.length) return notes;
    const kick = padFor(kit, 'kick', notes);
    const keep = notes.filter((n) => n.tick < from || n.tick >= to || (n.pitch === kick && n.tick % (BAR / 4) === 0));
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
