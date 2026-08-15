/* The annealer's best matrix was sound except for two cells that collided with
 * reserved colours (Light Yellow ~ playhead green, Teal Green ~ light grey).
 * Everything else in it is good, so replace exactly those two by exhaustive
 * search rather than re-rolling the whole matrix. */
import { readFileSync } from 'fs';
const src = readFileSync('/Users/dake/git/cld/schwung/src/shared/constants.mjs', 'utf8');
const PAL = new Map();
for (const m of src.matchAll(/^\s*(\d+)\s*:\s*#([0-9A-Fa-f]{6})\s+(.+)$/gm))
    if (!PAL.has(+m[1])) PAL.set(+m[1], { hex: m[2], name: m[3].trim() });
const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function toLab([r, g, b]) {
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const RGB2LMS = [[0.31399, 0.63951, 0.04649], [0.15537, 0.75789, 0.08670], [0.01775, 0.10945, 0.87259]];
const LMS2RGB = [[5.47221, -4.64196, 0.16963], [-1.12524, 2.29317, -0.16789], [0.02980, -0.19318, 1.16364]];
const mul = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function cvd([r, g, b], k) {
    if (k === 'normal') return [r, g, b];
    const l = mul(RGB2LMS, [lin(r), lin(g), lin(b)]);
    const o = k === 'protan' ? [1.05118294 * l[1] - 0.05116099 * l[2], l[1], l[2]]
                             : [l[0], 0.9513092 * l[0] + 0.04264406 * l[2], l[2]];
    const g2 = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return mul(LMS2RGB, o).map(v => g2(Math.max(0, Math.min(1, v))));
}
const V = ['normal', 'protan', 'deutan'], lab = new Map();
for (const [i, { hex }] of PAL) { const o = {}; for (const v of V) o[v] = toLab(cvd(srgb(hex), v)); lab.set(i, o); }
const dE = (a, b, v) => { const A = lab.get(a)[v], B = lab.get(b)[v]; return Math.hypot((A[0] - B[0]) * 0.35, A[1] - B[1], A[2] - B[2]); };
const dist = (a, b) => Math.min(...V.map(v => dE(a, b, v)));
const RESERVED = [11, 120, 124, 118];

const BASE = [
    [127, 7, 25, 125],
    [15, 3, 44, 21],
    [14, 23, 6, 9],
    [12, 47, 27, 5],     // cells [3][0] and [3][3] are the ones to replace
];
const FIXED = BASE.flat().filter((_, k) => k !== 12 && k !== 15);
const CAND = [1, 2, 3, 5, 6, 8, 9, 12, 16, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31, 32,
              33, 34, 43, 44, 45, 46, 47, 48, 49, 50, 14, 15].filter(i => PAL.has(i) && !FIXED.includes(i));

/* Score a full matrix: the worst distance over every pair that must be
 * distinguishable (within a row, within a column) AND every track's clearance
 * from the reserved colours. One number, all constraints. */
function scoreFull(M) {
    let worst = Infinity, why = '';
    const note = (d, s) => { if (d < worst) { worst = d; why = s; } };
    for (let r = 0; r < 4; r++)
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
            note(dist(M[r][a], M[r][b]), `row G${r + 1}: ${PAL.get(M[r][a]).name}/${PAL.get(M[r][b]).name}`);
    for (let c = 0; c < 4; c++)
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
            note(dist(M[a][c], M[b][c]), `col ${c + 1}: ${PAL.get(M[a][c]).name}/${PAL.get(M[b][c]).name}`);
    /* Reserved clearance is judged in NORMAL vision only. Under deuteranopia
     * every yellow collapses onto the playhead's neon green — unavoidable while
     * keeping Move's parity colours, and the playhead is told apart by the fact
     * that it moves. Track-vs-track separation above still requires all three
     * vision models, which is where colour is the only cue. */
    for (const i of M.flat())
        for (const r of RESERVED)
            note(dE(i, r, 'normal'), `reserved: ${PAL.get(i).name} vs ${PAL.get(r).name}`);
    return { worst, why };
}

let best = null;
for (const a of CAND) for (const b of CAND) {
    if (a === b) continue;
    const M = BASE.map(r => r.slice());
    M[3][0] = a; M[3][3] = b;
    const s = scoreFull(M);
    if (!best || s.worst > best.s.worst) best = { a, b, s, M };
}
console.log(`replace T13 -> ${best.a} ${PAL.get(best.a).name}   T16 -> ${best.b} ${PAL.get(best.b).name}`);
console.log(`global worst required pair: ${best.s.worst.toFixed(1)}  (${best.s.why})\n`);
for (let r = 0; r < 4; r++)
    console.log(`G${r + 1}: ` + best.M[r].map((i, c) => `T${String(r * 4 + c + 1).padStart(2)} ${PAL.get(i).name.padEnd(15)}#${PAL.get(i).hex}`).join(' | '));

/* Dim partners: same hue, ~35% lightness, still chromatic. */
const Lof = i => lab.get(i).normal[0];
const chroma = i => { const l = lab.get(i).normal; return Math.hypot(l[1], l[2]); };
const hue = i => { const l = lab.get(i).normal; let h = Math.atan2(l[2], l[1]) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
const hgap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return d > 180 ? 360 - d : d; };
function dimFor(idx) {
    let bi = -1, bd = Infinity;
    for (const [i] of PAL) {
        const L = Lof(i);
        if (L < 5 || L > 42 || L > Lof(idx) * 0.65) continue;
        if (chroma(i) < 5) continue;
        const d = hgap(i, idx) * 0.8 + Math.abs(L - Lof(idx) * 0.35);
        if (d < bd) { bd = d; bi = i; }
    }
    return bi;
}
const dims = best.M.flat().map(dimFor);
console.log('\ndim partners:', best.M.flat().map((i, k) => `${PAL.get(i).name}->${PAL.get(dims[k])?.name}`).join(', '));
console.log('\nTRACK_COLOR     =', JSON.stringify(best.M.flat()));
console.log('TRACK_COLOR_DIM =', JSON.stringify(dims));
