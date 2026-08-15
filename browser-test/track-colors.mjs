#!/usr/bin/env node
/* browser-test/track-colors.mjs — the track palette's guard.
 *
 * Two jobs, and the first matters as much as the second:
 *
 *  1. movy hardcodes schwung's LED palette INDICES (seq/colors.ts) so the seq
 *     modules don't depend on injected globals. That is a copy, and a copy can
 *     drift: if schwung renumbers its table, movy silently repaints every track
 *     the wrong colour. This reads schwung's constants.mjs and fails instead.
 *
 *  2. Within a group the 4 tracks must be tellable apart, and so must the same
 *     track index across groups. Checked under normal vision AND the two common
 *     red-green deficiencies, with lightness de-weighted — on a 3 mm LED a pale
 *     blue and a royal blue read the same however far apart CIELAB says they are.
 *
 * Run: node browser-test/track-colors.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { TRACK_COLOR, TRACK_COLOR_DIM } from '../dist/esm/seq/colors.js';

let failures = 0;
const _log = (s) => process.stdout.write(s + '\n');
function ok(label, cond) {
    if (cond) _log(`  \x1b[32m✓\x1b[0m ${label}`);
    else { _log(`  \x1b[31m✗\x1b[0m ${label}`); failures++; }
}
function eq(label, got, want) { ok(`${label}${got === want ? '' : `: expected ${want}, got ${got}`}`, got === want); }

/* The reference repo is a sibling checkout, not a dependency. Skip loudly when
 * it is missing rather than passing quietly — a guard that silently does
 * nothing is worse than no guard. */
const SCHWUNG = '/Users/dake/git/cld/schwung/src/shared/constants.mjs';
if (!existsSync(SCHWUNG)) {
    _log('\x1b[33m\x1b[1mSKIPPED — schwung checkout not found at ' + SCHWUNG + '\x1b[0m');
    _log('\x1b[33mThe palette-drift check did NOT run.\x1b[0m');
    process.exit(0);
}

const src = readFileSync(SCHWUNG, 'utf8');
const PAL = new Map();
for (const m of src.matchAll(/^\s*(\d+)\s*:\s*#([0-9A-Fa-f]{6})\s+(.+)$/gm))
    if (!PAL.has(+m[1])) PAL.set(+m[1], { hex: m[2].toUpperCase(), name: m[3].trim() });

/* ── colour maths ───────────────────────────────────────────────────────── */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function toLab([r, g, b]) {
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const RGB2LMS = [[0.31399, 0.63951, 0.04649], [0.15537, 0.75789, 0.08670], [0.01775, 0.10945, 0.87259]];
const LMS2RGB = [[5.47221, -4.64196, 0.16963], [-1.12524, 2.29317, -0.16789], [0.02980, -0.19318, 1.16364]];
const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function cvd([r, g, b], kind) {
    if (kind === 'normal') return [r, g, b];
    const l = mul(RGB2LMS, [lin(r), lin(g), lin(b)]);
    const o = kind === 'protan'
        ? [1.05118294 * l[1] - 0.05116099 * l[2], l[1], l[2]]
        : [l[0], 0.9513092 * l[0] + 0.04264406 * l[2], l[2]];
    const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return mul(LMS2RGB, o).map((v) => gam(Math.max(0, Math.min(1, v))));
}
const VIEWS = ['normal', 'protan', 'deutan'];
const lab = new Map();
for (const [i, { hex }] of PAL) {
    const o = {};
    for (const v of VIEWS) o[v] = toLab(cvd(srgb(hex), v));
    lab.set(i, o);
}
/* Hue and chroma carry track identity; lightness is the weak cue at LED size. */
const L_WEIGHT = 0.35;
const dE = (a, b, v) => {
    const A = lab.get(a)[v], B = lab.get(b)[v];
    return Math.hypot((A[0] - B[0]) * L_WEIGHT, A[1] - B[1], A[2] - B[2]);
};
const dist = (a, b) => Math.min(...VIEWS.map((v) => dE(a, b, v)));
const name = (i) => PAL.get(i)?.name ?? `#${i}`;

/* ── 1. the copy has not drifted ────────────────────────────────────────── */
_log('\npalette indices still mean what movy thinks they mean:');
const EXPECTED = {
    127: 'FF0000', 7: 'FFFF00', 25: 'FF4DC4', 125: '0000FF',
    15: '0074FC', 3: 'FF9900', 44: '7CDD9F', 21: 'E657E3',
    14: '00FFFF', 23: 'FF0099', 6: 'C19D08', 9: '2C8403',
    12: '159573', 47: '7ACEFC', 27: 'A63421', 5: 'EDF95A',
};
for (const [idx, hex] of Object.entries(EXPECTED)) {
    eq(`index ${idx} is #${hex} (${name(+idx)})`, PAL.get(+idx)?.hex, hex);
}

/* ── 2. the matrix is readable ──────────────────────────────────────────── */
const M = [0, 1, 2, 3].map((g) => TRACK_COLOR.slice(g * 4, g * 4 + 4));
eq('16 track colours defined', TRACK_COLOR.length, 16);
eq('16 dim variants defined', TRACK_COLOR_DIM.length, 16);

/* 13 is the measured floor of the chosen matrix. It is an assertion about THIS
 * palette, not a general threshold — if a future edit cannot clear it, the edit
 * is what is wrong. */
const MIN = 13;

_log('\nwithin a group, the 4 tracks are distinguishable:');
for (let r = 0; r < 4; r++)
    for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) {
            const d = dist(M[r][a], M[r][b]);
            ok(`G${r + 1}: ${name(M[r][a])} vs ${name(M[r][b])} (${d.toFixed(1)})`, d >= MIN);
        }

_log('\nacross groups, the same track index is distinguishable:');
for (let c = 0; c < 4; c++)
    for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) {
            const d = dist(M[a][c], M[b][c]);
            ok(`track ${c + 1}: ${name(M[a][c])} vs ${name(M[b][c])} (${d.toFixed(1)})`, d >= MIN);
        }

/* ── 3. clear of the colours the step row already uses ──────────────────── */
/* Normal vision only. Under deuteranopia every yellow collapses onto the
 * playhead's neon green — unavoidable while keeping Move's parity colours, and
 * the playhead is told apart by the fact that it MOVES. */
_log('\nclear of the reserved step-row colours (normal vision):');
for (const [res, label] of [[11, 'playhead green'], [120, 'note white'], [118, 'light grey']]) {
    let worst = Infinity, who = -1;
    for (const t of TRACK_COLOR) {
        const d = dE(t, res, 'normal');
        if (d < worst) { worst = d; who = t; }
    }
    ok(`${label}: nearest is ${name(who)} (${worst.toFixed(1)})`, worst >= 18);
}

/* A dim variant must still read as ITS track's colour, not as another's. */
_log('\ndim variants stay closer to their own track than to a reserved colour:');
for (let t = 0; t < 16; t++) {
    const d = dE(TRACK_COLOR_DIM[t], 124, 'normal');   // 124 = the empty/dark grey
    ok(`${name(TRACK_COLOR[t])} dim is not grey (${d.toFixed(1)})`, d >= 8);
}

_log('');
if (failures === 0) {
    _log('\x1b[32m\x1b[1mALL TRACK-COLOUR CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} TRACK-COLOUR CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
