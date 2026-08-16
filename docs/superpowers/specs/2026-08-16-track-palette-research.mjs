#!/usr/bin/env node
/* 2026-08-16 track-palette re-search.
 *
 * Supersedes 2026-08-15-track-palette-search.mjs. That search produced a matrix
 * whose accents collided with the grey/white pads around the chromatic ROOT
 * pad; tracks 5, 7 and 9 (Azure Blue, Mint Green, Cyan) were reported
 * indistinguishable from a lit in-scale pad on device.
 *
 * What changed, all of it in the constraints rather than the method:
 *
 *  - Clearance from black / dark grey / light grey / white is measured with
 *    lightness at FULL weight. The old search reused the lightness-de-weighted
 *    track-vs-track metric there, which is why Cyan (12 from white) passed.
 *  - Two rules that are EMPIRICAL, not derived from CIELAB. Azure Blue measures
 *    80 from white and still failed on hardware, so no numeric threshold could
 *    have caught it: (a) no cool hue (LAB 145-310) above L 45; (b) no pastel
 *    (L > 65 with chroma below 0.7*L) at any hue.
 *  - A chroma floor of 40, so an accent is a colour and not a muddy neutral.
 *  - Move parity for G1 is no longer pinned. Pinning it is still reachable and
 *    scores 20.7; the free search reaches 33.8.
 *  - The walk optimises the worst pair FIRST, with a capped soft-min as a
 *    tiebreak. Driving the walk by the soft-min alone converged to 28.4 while
 *    33.8 was reachable.
 *
 * The anneal is stochastic: it reliably converges on the same 16-colour SET at
 * worst-pair 33.8, but the arrangement within the matrix varies between runs.
 * The shipped assignment lives in src/seq/colors.ts and is pinned by
 * browser-test/track-colors.mjs.
 *
 * Run: node 2026-08-16-track-palette-research.mjs [--dims]
 * Requires the schwung sibling checkout for the palette table.
 */

import { readFileSync } from 'fs';
const src = readFileSync('/Users/dake/git/cld/schwung/src/shared/constants.mjs','utf8');
const PAL = new Map();
for (const m of src.matchAll(/^\s*(\d+)\s*:\s*#([0-9A-Fa-f]{6})\s+(.+)$/gm))
    if (!PAL.has(+m[1])) PAL.set(+m[1], { hex: m[2].toUpperCase(), name: m[3].trim() });
const lin=c=>(c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
const srgb=h=>[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);
function toLab([r,g,b]){const R=lin(r),G=lin(g),B=lin(b);
 const X=(0.4124*R+0.3576*G+0.1805*B)/0.9505,Y=0.2126*R+0.7152*G+0.0722*B,Z=(0.0193*R+0.1192*G+0.9505*B)/1.089;
 const f=t=>(t>0.008856?Math.cbrt(t):7.787*t+16/116);return [116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))];}
const R2L=[[0.31399,0.63951,0.04649],[0.15537,0.75789,0.08670],[0.01775,0.10945,0.87259]];
const L2R=[[5.47221,-4.64196,0.16963],[-1.12524,2.29317,-0.16789],[0.02980,-0.19318,1.16364]];
const mul=(M,v)=>M.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
function cvd([r,g,b],k){if(k==='normal')return[r,g,b];const l=mul(R2L,[lin(r),lin(g),lin(b)]);
 const o=k==='protan'?[1.05118294*l[1]-0.05116099*l[2],l[1],l[2]]:[l[0],0.9513092*l[0]+0.04264406*l[2],l[2]];
 const g2=c=>(c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055);return mul(L2R,o).map(v=>g2(Math.max(0,Math.min(1,v))));}
const V=['normal','protan','deutan'];
const lab=new Map();
for(const [i,{hex}] of PAL){const o={};for(const v of V)o[v]=toLab(cvd(srgb(hex),v));lab.set(i,o);}
const LW=0.35;
const dE=(a,b,v)=>{const A=lab.get(a)[v],B=lab.get(b)[v];return Math.hypot((A[0]-B[0])*LW,A[1]-B[1],A[2]-B[2]);};
const dist=(a,b)=>Math.min(...V.map(v=>dE(a,b,v)));
/* Against an achromatic reference lightness is NOT a weak cue — it is the only
 * cue besides chroma, so use it at full weight. */
const dEn=(a,b,v)=>{const A=lab.get(a)[v],B=lab.get(b)[v];return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);};
const greyDist=i=>Math.min(...V.flatMap(v=>[dEn(i,120,v),dEn(i,118,v)]));
const chroma=i=>{const l=lab.get(i).normal;return Math.hypot(l[1],l[2]);};
const Lof=i=>lab.get(i).normal[0];
const name=i=>PAL.get(i)?.name??`#${i}`;


if (!process.argv.includes('--dims')) {
const hue = i => { const l = lab.get(i).normal; let h = Math.atan2(l[2], l[1]) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
/* Two hardware failure modes, both empirical. (a) A COOL hue only stays clear
 * of the grey pads while it is DARK. (b) Any PASTEL — high lightness without
 * chroma to match — reads as white whatever its hue. */
const banned = i => (hue(i) >= 145 && hue(i) <= 310 && Lof(i) > 45)
                 || (Lof(i) > 65 && chroma(i) < 0.7 * Lof(i));
const GREY = [0, 118, 120, 124];
const greyN = i => Math.min(...GREY.map(g => dEn(i, g, 'normal')));
const greyC = i => Math.min(...GREY.flatMap(g => V.map(v => dEn(i, g, v))));
const playhead = i => dE(i, 11, 'normal');
const FAM = i => { const h = hue(i);
    if (h < 45) return 'red'; if (h < 75) return 'orange'; if (h < 115) return 'yellow';
    if (h < 145) return 'green'; if (h < 235) return 'teal'; if (h < 315) return 'blue/violet';
    return 'pink'; };
/* An accent must be a COLOUR, not a muddy near-neutral: chroma floor keeps
 * "Dull Yellow" and friends out even when they clear the greys numerically. */
const POOL = [...PAL.keys()].filter(i =>
    chroma(i) >= 40 && Lof(i) >= 25 && !banned(i) && i !== 11 && !GREY.includes(i) &&
    greyN(i) >= 30 && greyC(i) >= 20 && playhead(i) >= 18);
const fams = {}; for (const i of POOL) (fams[FAM(i)] ??= []).push(i);
console.log(`pool: ${POOL.length}`);
for (const [f, l] of Object.entries(fams)) console.log(`  ${f.padEnd(12)} ${String(l.length).padStart(2)}: ${l.map(name).join(', ')}`);
const cell = (M, r, c) => M[r * 4 + c];
const TAU = 4;
/* Soft-min: maximising -sum(exp(-d/TAU)) lifts the SMALLEST distances first,
 * so it behaves like maximin but keeps improving the runners-up too. */
function score(M) {
    let soft = 0, worst = Infinity, why = '';
    const note = (d, s) => { soft += Math.exp(-d / TAU); if (d < worst) { worst = d; why = s; } };
    for (let r = 0; r < 4; r++) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const x = cell(M,r,a), y = cell(M,r,b);
        if (FAM(x) === FAM(y)) return { soft: -1e9, obj: -1e9, worst: -1, why: `G${r+1} family ${name(x)}/${name(y)}` };
        note(dist(x, y), `G${r+1}: ${name(x)}/${name(y)}`);
    }
    for (let c = 0; c < 4; c++) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const x = cell(M,a,c), y = cell(M,b,c);
        if (FAM(x) === FAM(y)) return { soft: -1e9, obj: -1e9, worst: -1, why: `col${c+1} family ${name(x)}/${name(y)}` };
        note(dist(x, y), `col${c+1}: ${name(x)}/${name(y)}`);
    }
    for (const i of M) soft += 0.5 * Math.exp(-greyN(i) / (TAU * 2));
    return { soft: -soft, obj: worst + Math.max(-soft, -0.9), worst, why };
}
let best = null;
for (let restart = 0; restart < 500; restart++) {
    let M = POOL.slice().sort(() => Math.random() - 0.5).slice(0, 16), s = score(M);
    for (let step = 0; step < 20000; step++) {
        const T = 5 * (1 - step / 20000) + 0.01;
        const N = M.slice(), k = (Math.random() * 16) | 0;
        if (Math.random() < 0.5) { const j = (Math.random() * 16) | 0; [N[k], N[j]] = [N[j], N[k]]; }
        else { const c = POOL[(Math.random() * POOL.length) | 0]; if (M.includes(c)) continue; N[k] = c; }
        const sn = score(N);
        if (sn.obj > s.obj || Math.random() < Math.exp((sn.obj - s.obj) / T)) { M = N; s = sn; }
        if (!best || s.obj > best.s.obj) best = { M: M.slice(), s: { ...s } };
    }
}
console.log(`\nbest worst pair: ${best.s.worst.toFixed(1)}  (${best.s.why})`);
for (let r = 0; r < 4; r++)
    console.log(`G${r+1}: ` + [0,1,2,3].map(c => { const i = cell(best.M, r, c);
        return `T${String(r*4+c+1).padStart(2)} ${name(i).padEnd(15)}#${PAL.get(i).hex} g${greyN(i).toFixed(0).padStart(3)}`; }).join(' | '));
console.log('TRACK_COLOR =', JSON.stringify(best.M));

} else {
const hue = i => { const l = lab.get(i).normal; let h = Math.atan2(l[2], l[1]) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
const hgap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return d > 180 ? 360 - d : d; };
const TRACK = [3,27,23,20,26,16,5,10,125,7,28,21,85,25,18,6];   // the matrix chosen above
const BRIGHT = new Set(TRACK);
/* A dim must read as ITS track's colour: same hue family, clearly darker than
 * the bright, and never mistakable for the empty-step dark grey or black. */
const cand = t => [...PAL.keys()].filter(i =>
    !BRIGHT.has(i) && chroma(i) >= 8 && Lof(i) >= 8 && Lof(i) <= 45 &&
    Lof(i) <= Lof(t) * 0.8 && hgap(i, t) <= 45 &&
    dEn(i, 124, 'normal') >= 12 && dEn(i, 0, 'normal') >= 12 && dEn(i, 118, 'normal') >= 12);
const CANDS = TRACK.map(cand);
CANDS.forEach((c, k) => { if (!c.length) console.log(`!! T${k+1} ${name(TRACK[k])} has NO candidate`); });
function worstOf(D) {
    let w = Infinity, why = '';
    const note = (d, s) => { if (d < w) { w = d; why = s; } };
    for (let r = 0; r < 4; r++) for (let a = 0; a < 4; a++) for (let b = a+1; b < 4; b++)
        note(dist(D[r*4+a], D[r*4+b]), `G${r+1}: ${name(D[r*4+a])}/${name(D[r*4+b])}`);
    for (let c = 0; c < 4; c++) for (let a = 0; a < 4; a++) for (let b = a+1; b < 4; b++)
        note(dist(D[a*4+c], D[b*4+c]), `col${c+1}: ${name(D[a*4+c])}/${name(D[b*4+c])}`);
    return { w, why };
}
const score = D => new Set(D).size < 16 ? { w: -1, why: 'duplicate' } : worstOf(D);
let best = null;
for (let restart = 0; restart < 3000; restart++) {
    let D = CANDS.map(c => c[(Math.random() * c.length) | 0]), s = score(D);
    for (let step = 0; step < 4000; step++) {
        const T = 4 * (1 - step / 4000) + 0.01;
        const N = D.slice(), k = (Math.random() * 16) | 0;
        N[k] = CANDS[k][(Math.random() * CANDS[k].length) | 0];
        const sn = score(N);
        if (sn.w > s.w || Math.random() < Math.exp((sn.w - s.w) / T)) { D = N; s = sn; }
        if (!best || s.w > best.s.w) best = { D: D.slice(), s: { ...s } };
    }
}
console.log(`\ndim worst row/col pair: ${best.s.w.toFixed(1)} (${best.s.why})`);
TRACK.forEach((t, k) => console.log(`T${String(k+1).padStart(2)} ${name(t).padEnd(18)} -> ${name(best.D[k]).padEnd(20)} #${PAL.get(best.D[k]).hex}  greyclear ${dEn(best.D[k],124,'normal').toFixed(0)}  huegap ${hgap(best.D[k],t).toFixed(0)}`));
console.log('\nTRACK_COLOR_DIM =', JSON.stringify(best.D));

}
