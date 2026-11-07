/* The listening queue (design doc, "Pick, not grade"): the user stops when
 * they like, so the queue runs in laps. Each lap holds one case from every
 * cell (a request and role, or an A/B role and whose scene), most important
 * cell first: wherever the user stops, every generator has as many answers
 * as any other, and the ones that matter most have them first. */

/* The user's own scenes against real parts first: the most direct "would
 * you keep it" there is. Then New Clip and Variation, the presses used most. */
const TIERS = ['ab:user', 'create', 'variation', 'ab:public', 'double'];
const ROLES = ['lead', 'chords', 'bass', 'drums'];

export const cellOf = (c) => (c.kind === 'ab' ? `ab:${c.refKind}:${c.target}` : c.generator);
const rank = (cell) => { const p = cell.split(':'), t = TIERS.indexOf(p.length === 3 ? `${p[0]}:${p[1]}` : p[0]);
    return (t < 0 ? TIERS.length : t) * ROLES.length + ROLES.indexOf(p[p.length - 1]); };

function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function shuffle(xs, rand) {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}

/** Every case once, in laps over the cells (each cell's cases shuffled). */
export function prioritise(cases, seed = 1) {
    const rand = rng(seed), cells = new Map();
    for (const c of cases) cells.set(cellOf(c), [...(cells.get(cellOf(c)) ?? []), c]);
    const lanes = [...cells.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, cs]) => shuffle(cs, rand));
    const out = [];
    for (let k = 0; out.length < cases.length; k++) for (const l of lanes) if (l[k]) out.push(l[k]);
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
