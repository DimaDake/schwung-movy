/* Variation for drums, close and rhythmic: the pads never change, only where
 * and how hard they play (design §1). */

import { strength } from '../analysis/events.js';
import { padFor } from '../analysis/kit.js';
import { count, custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { accent, dynamics } from '../shape/dynamics.js';
import { ghosts, HAT_RATES, hats } from '../shape/drums.js';
import { BAR, BEAT, type Note, TPS } from '../types.js';

const at = (notes: Note[], pad: number, tick: number) => notes.some((n) => n.pitch === pad && Math.abs(n.tick - tick) < TPS / 2);
const SYNC = [3, 6, 10, 11, 14, 7, 15];

export const KICK: Preset = {
    id: 'd-kick', name: 'KICK', task: 'variation', drum: true, cls: 'close',
    knobs: [count('AMOUNT', 6, 2), custom('STYLE', ['MOVE', 'ADD', 'SYNCOPATE', 'DROP'], 1), custom('BARS', ['EVERY', 'EVEN', 'LAST'], 1), K.seed()],
    fit: (c) => (c.kit && padFor(c.kit, 'kick', c.src) !== null ? 0.7 : 0),
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        const k = padFor(ctx.kit!, 'kick', ctx.src);
        if (k === null) return ctx.src;
        const nb = Math.max(1, Math.round(ctx.end / BAR));
        const bars = Array.from({ length: nb }, (_, b) => b).filter((b) => v[2] === 0 || (v[2] === 1 ? b % 2 === 1 : b === nb - 1));
        let notes = ctx.src.map((n) => ({ ...n }));
        const proto = notes.find((n) => n.pitch === k) ?? { tick: 0, gate: 12, pitch: k, vel: 110 };
        for (let i = 0; i < v[0]; i++) {
            const bar = bars[Math.floor(r() * bars.length)] ?? 0;
            const base = bar * BAR;
            const kicks = notes.filter((n) => n.pitch === k && n.tick >= base && n.tick < base + BAR && n.tick % BAR !== 0);
            const s = SYNC[Math.floor(r() * SYNC.length)];
            const t = base + s * TPS;
            if (v[1] === 3 && kicks.length) notes = notes.filter((n) => n !== kicks[Math.floor(r() * kicks.length)]);
            else if ((v[1] === 0 || v[1] === 2) && kicks.length) {
                const m = kicks[Math.floor(r() * kicks.length)];
                const to = v[1] === 2 ? m.tick + (r() < 0.5 ? -1 : 2) * TPS : t;
                if (to >= 0 && to < ctx.end && !at(notes, k, to)) m.tick = to;
            } else if (t < ctx.end && !at(notes, k, t)) notes.push({ ...proto, tick: t, vel: Math.round(proto.vel * 0.85) });
        }
        return notes;
    },
};

export const HATS: Preset = {
    id: 'd-hats', name: 'HATS', task: 'variation', drum: true, cls: 'close',
    knobs: [{ ...custom('RATE', HAT_RATES, 3), def: (c) => hatDefault(c.src, c.kit ? padFor(c.kit, 'hat', c.src) : null) },
        count('OPEN', 4, 1), K.dynamics(3), K.swing()],
    fit: (c) => (c.kit && padFor(c.kit, 'hat', c.src) !== null ? 0.7 : 0.1),
    generate: (ctx, v) => {
        let notes = hats(ctx, ctx.kit!, ctx.src, v[0]);
        const hat = padFor(ctx.kit!, 'hat', ctx.src);
        const open = padFor(ctx.kit!, 'open', ctx.src);
        if (open !== null && hat !== null && v[1] > 0) {
            const offs = notes.filter((n) => n.pitch === hat && Math.round(n.tick / TPS) % 4 === 2);
            const per = Math.max(1, Math.floor(offs.length / v[1]));
            offs.forEach((n, i) => { if (i % per === per - 1) n.pitch = open; });
        }
        notes = notes.map((n) => (n.pitch === hat && Math.round(n.tick / TPS) % 2 === 1 ? { ...n, tick: n.tick + Math.round(v[3] * 0.05 * TPS) } : n));
        return dynamics(notes, v[2]);
    },
};

/* A hat variation moves the hats to a rate they were NOT playing: 16ths
 * open up to offbeats (the house move), 8ths go to 16ths, sparse hats to 8ths. */
function hatDefault(src: Note[], hat: number | null): number {
    if (hat === null) return 2;
    const n = src.filter((x) => x.pitch === hat).length;
    const bars = Math.max(1, Math.ceil(Math.max(...src.map((x) => x.tick + 1), 1) / BAR));
    const per = n / bars;
    return per >= 12 ? 1 : per >= 6 ? 3 : 2;
}

export const GHOSTS: Preset = {
    id: 'd-ghosts', name: 'GHOSTS', task: 'variation', drum: true, cls: 'close', fit: () => 0.6,
    knobs: [count('COUNT', 12, 4), custom('LEVEL', ['20', '30', '40', '50', '60'], 1), custom('PAD', ['SNARE', 'HAT', 'PERC'], 0), K.seed()],
    generate: (ctx, v, seed) => ghosts(ctx, ctx.kit!, ctx.src.map((n) => ({ ...n })), v[0], (['snare', 'hat', 'perc'] as const)[v[2]],
        20 + v[1] * 10, rng(seed + v[3] * 7919)),
};

export const FILL: Preset = {
    id: 'd-fill', name: 'FILL', task: 'variation', drum: true, cls: 'close', fit: () => 0.65,
    knobs: [custom('SIZE', ['1 BEAT', '2 BEATS', '3 BEATS', '1 BAR'], 1), K.density(6), custom('PADS', ['SNARE', 'TOMS', 'MIXED'], 2), K.dynamics(4)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const kit = ctx.kit!;
        const steps = (v[0] + 1) * 4;
        const from = ctx.end - steps * TPS;
        const sn = padFor(kit, 'snare', ctx.src);
        const toms = kit.by.tom.length ? [...kit.by.tom].sort((a, b) => b - a) : sn !== null ? [sn] : [];
        const pads = v[2] === 0 && sn !== null ? [sn] : v[2] === 1 && toms.length ? toms : [sn, ...toms].filter((p): p is number => p !== null);
        if (!pads.length) return ctx.src;
        const kick = padFor(kit, 'kick', ctx.src);
        const keep = ctx.src.filter((n) => n.tick < from || (n.pitch === kick && n.tick % BEAT === 0));
        const add: Note[] = [];
        for (let s = 0; s < steps; s++) {
            if (s % 2 === 1 && r() * 10 > v[1]) continue;
            const pad = pads[Math.min(pads.length - 1, Math.floor((s / steps) * pads.length))];
            add.push({ tick: from + s * TPS, gate: TPS / 2, pitch: pad, vel: Math.round(110 - v[3] * 6 + v[3] * 6 * (s / Math.max(1, steps - 1))) });
        }
        return [...keep, ...add];
    },
};

const STEPS = [-2, -1, 1, 2];

export const SHIFT: Preset = {
    id: 'd-shift', name: 'SHIFT', task: 'variation', drum: true, cls: 'rhythm', fit: () => 0.55,
    knobs: [K.amount(4), custom('STEPS', STEPS.map((s) => (s > 0 ? '+' : '') + s + '/16'), 2), custom('PAD', ['SNARE', 'KICK', 'PERC', 'HAT'], 0), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        const pad = padFor(ctx.kit!, (['snare', 'kick', 'perc', 'hat'] as const)[v[2]], ctx.src) ?? padFor(ctx.kit!, 'snare', ctx.src);
        const notes = ctx.src.map((n) => ({ ...n }));
        const mine = notes.filter((n) => n.pitch === pad && n.tick % BAR !== 0);
        const k = Math.max(1, Math.round((mine.length * v[0]) / 10));
        const pickd = new Set(mine.map((n) => ({ n, w: r() })).sort((a, b) => a.w - b.w).slice(0, k).map((x) => x.n));
        for (const n of mine) {
            if (!pickd.has(n)) continue;
            const t = n.tick + STEPS[v[1]] * TPS;
            if (t >= 0 && t < ctx.end && !at(notes, n.pitch, t)) n.tick = t;
        }
        return notes;
    },
};

export const TURN: Preset = {
    id: 'd-turn', name: 'TURNAROUND', task: 'variation', drum: true, cls: 'rhythm', fit: () => 0.6,
    knobs: [custom('WHERE', ['END', 'EVERY BAR'], 0), custom('SIZE', ['1 BEAT', '2 BEATS'], 0), K.density(6), K.seed()],
    generate: (ctx, v, seed) => {
        const r = rng(seed + v[3] * 7919);
        const kit = ctx.kit!;
        const pads = [padFor(kit, 'snare', ctx.src), padFor(kit, 'kick', ctx.src), padFor(kit, 'hat', ctx.src)].filter((p): p is number => p !== null);
        if (!pads.length) return ctx.src;
        const len = (v[1] + 1) * BEAT;
        const ends = v[0] === 0 ? [ctx.end] : Array.from({ length: Math.round(ctx.end / BAR) }, (_, b) => (b + 1) * BAR);
        let notes = ctx.src.map((n) => ({ ...n }));
        for (const end of ends) {
            notes = notes.filter((n) => n.tick < end - len || n.tick >= end || strength(n.tick) >= 0.85);
            for (let t = end - len; t < end; t += TPS) {
                if (r() * 10 > v[2]) continue;
                const pad = pads[Math.floor(r() * pads.length)];
                if (!at(notes, pad, t)) notes.push({ tick: t, gate: TPS / 2, pitch: pad, vel: Math.round(70 + r() * 45) });
            }
        }
        return accent(notes, 6);
    },
};
