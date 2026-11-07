/* Variety (plans/2026-11-07-generation-paths-bench.md, round 5): do the
 * measurements tell scenes apart, and do the generators give different
 * parts each time they are asked?
 *   metrics  per metric, generated against real: how many values, how much
 *            of it is one value, the P10-P90 width; a metric constant in the
 *            generated scenes where real ones vary is a generator that never
 *            goes there, one constant in both measures nothing;
 *   presses  New Clip asked again and again in one scene (the history of
 *            options offered lately on, as on the device): per generator, how
 *            far apart its takes are, how many rhythms, how often the
 *            commonest comes back, how many knob settings;
 *   scenes   the same generator across scenes: does its rhythm follow them;
 *   options  Variation's six: how far apart, and what SEED turns give. */
import { base } from './piece.mjs';
import { METRICS } from './relations.mjs';
import { ROLE } from './scene.mjs';

const q = (v, f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
const ok = (x) => x !== null && x !== undefined && !Number.isNaN(x);

/** A metric's spread over measured rows `ms`. */
export function spreadOf(ms, k) {
    const v = ms.map((m) => m[k]).filter(ok).sort((a, b) => a - b);
    if (v.length < 10) return null;
    const counts = new Map();
    for (const x of v) { const r = Math.round(x * 100) / 100; counts.set(r, (counts.get(r) ?? 0) + 1); }
    return { n: v.length, distinct: counts.size, mode: Math.max(...counts.values()) / v.length, width: q(v, 0.9) - q(v, 0.1), lo: q(v, 0.1), hi: q(v, 0.9) };
}

/** Per metric, generated against real: the flags that say a metric or a generator lacks range. */
export function metricSpread(gen, real) {
    return Object.keys(METRICS).map((k) => {
        const g = spreadOf(gen, k), r = spreadOf(real, k);
        if (!g || !r) return null;
        const flag = g.mode >= 0.9 && r.mode >= 0.9 ? 'measures nothing' : g.mode >= 0.9 && r.mode < 0.7 ? 'generators constant'
            : r.width > 0 && g.width < 0.35 * r.width ? 'generators narrow' : '';
        return { k, g, r, flag };
    }).filter(Boolean);
}

const sig = (ns) => [...new Set(ns.map((n) => Math.round(n.tick / 24)))].sort((a, b) => a - b).join();
const pairwise = (G, xs) => { let d = 0, n = 0; for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) { d += G.difference(xs[i], xs[j]); n++; } return n ? d / n : null; };

/** One generator's takes: how far apart, how many rhythms, the commonest's share, knob settings. */
export function takeVariety(G, takes) {
    const rh = new Map();
    for (const t of takes) rh.set(sig(t.notes), (rh.get(sig(t.notes)) ?? 0) + 1);
    return { n: takes.length, apart: pairwise(G, takes.map((t) => t.notes)), rhythms: rh.size, top: Math.max(...rh.values()) / takes.length,
        knobs: new Set(takes.map((t) => t.knobs.join())).size };
}

/** New Clip on track `i` of `set`'s slot 0, pressed `R` times with the history on. */
export function presses(G, set, i, len, R, seed) {
    G.forgetOptions();
    const by = new Map();
    for (let k = 0; k < R; k++) {
        const r = G.generateAll({ ...base(set, i === 0), task: 'create', target: { track: i, slot: 0 }, source: null, len, nonce: seed * 1000 + k });
        for (const p of r.picks) { if (!by.has(p.preset.id)) by.set(p.preset.id, []); by.get(p.preset.id).push(p); }
    }
    return by;
}

/** Variation, Double or Smart Quantize on track `i` of `set` (its clip in
 *  slot 0; a double or a quantize works on a copy in slot 2): the six
 *  apart, a second press, and SEED turns per option. A quantize starts from
 *  the part played loosely (gen-fixtures messy), what it is for. */
export function optionVariety(G, set, i, task, messy) {
    const src = set.tracks[i].clips.find((c) => c.slot === 0);
    const own = { ...set, tracks: set.tracks.map((t) => (t.index !== i || task === 'variation' ? t
        : { ...t, clips: [...t.clips, { ...src, slot: 2, notes: task === 'quantize' ? messy(src.notes) : src.notes.map((n) => ({ ...n })) }] })) };
    const input = { ...base(own, i === 0), task, len: task === 'double' ? src.len * 2 : src.len,
        ...(task === 'variation' ? { target: { track: i, slot: 1 }, source: { track: i, slot: 0 } } : { target: { track: i, slot: 2 }, source: null }) };
    if (input.len > 256) return null;
    /* Two presses as on the device (ai/job-algo.ts): each its own nonce, but a quantize. */
    const press = (k) => G.generateAll(task === 'quantize' ? input : { ...input, nonce: k }, 6);
    const r = press(1), again = press(2);
    const seeds = r.picks.map((p) => {
        const k = G.knobIndex(p.preset, 'SEED');
        if (k < 0) return null;
        const outs = Array.from({ length: Math.min(6, p.preset.knobs[k].steps(p.ctx ?? r.ctx)) }, (_, s) => {
            const v = [...p.knobs]; v[k] = s; return G.regenerate(p.ctx ?? r.ctx, p.preset, v) ?? [];
        }).filter((ns) => ns.length);
        return { id: p.preset.id, apart: pairwise(G, outs), distinct: new Set(outs.map((ns) => ns.map((n) => `${n.tick}.${n.pitch}`).join())).size, n: outs.length };
    }).filter(Boolean);
    return { task, role: ROLE[i], apart: pairwise(G, r.picks.map((p) => p.notes)), same: r.picks.every((p, k) => again.picks[k] && G.difference(p.notes, again.picks[k].notes) === 0), seeds };
}
