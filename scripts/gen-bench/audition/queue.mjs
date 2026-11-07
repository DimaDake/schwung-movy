/* The listening queue (plans/2026-11-07-gen-audition-design.md): the case
 * kinds mixed by weight, and inside a kind every generator once before any
 * comes back, so a short session already hears all of them. */

export const WEIGHTS = { set: 0.5, flagged: 0.3, blind: 0.2 };

function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function shuffle(xs, rand) {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}

/** One kind's cases, round-robin over its generators (each shuffled). */
function rotate(cases, rand) {
    const groups = new Map();
    for (const c of cases) groups.set(c.generator, [...(groups.get(c.generator) ?? []), c]);
    const lanes = shuffle([...groups.values()], rand).map((g) => shuffle(g, rand));
    const out = [];
    for (let k = 0; out.length < cases.length; k++) for (const l of lanes) if (l[k]) out.push(l[k]);
    return out;
}

/** Every case once: at each place the kind furthest behind its weight. */
export function interleave(pools, weights = WEIGHTS, seed = 1) {
    const rand = rng(seed);
    const lanes = Object.fromEntries(Object.entries(pools).map(([k, cs]) => [k, rotate(cs, rand)]));
    const taken = Object.fromEntries(Object.keys(lanes).map((k) => [k, 0]));
    const total = Object.values(lanes).reduce((n, l) => n + l.length, 0), out = [];
    while (out.length < total) {
        const open = Object.keys(lanes).filter((k) => taken[k] < lanes[k].length);
        const k = open.reduce((a, b) => ((weights[b] ?? 0) * (out.length + 1) - taken[b] > (weights[a] ?? 0) * (out.length + 1) - taken[a] ? b : a));
        out.push(lanes[k][taken[k]++]);
    }
    return out;
}

const pack = (ns) => ns.map((n) => [Math.round(n[0] * 96), Math.round(n[1] * 96), n[2], n[3]]);

/** A case as the page loads it: notes in integer 96ths of a beat. */
export function packCase(c) {
    const tracks = Object.fromEntries(Object.entries(c.scene.tracks).map(([k, ns]) => [k, pack(ns)]));
    return { ...c, scene: { ...c.scene, tracks }, ...(c.options ? { options: c.options.map((o) => ({ ...o, notes: pack(o.notes) })) } : {}) };
}

/** Case files: a small first one so the first case plays at once, then 200 each. */
export function chunks(xs, first = 40, size = 200) {
    const out = [xs.slice(0, first)];
    for (let i = first; i < xs.length; i += size) out.push(xs.slice(i, i + size));
    return out.filter((c) => c.length);
}
