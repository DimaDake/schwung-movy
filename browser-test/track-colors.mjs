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
/* Each line carries up to three entries: the bright colour, then its `dim` and
 * `dark` companions with their own indices.
 *
 *   3 : #C93C00  Bright Orange           dim  69 #5D1700  dark  70 #200D00
 *
 * Reading only the leading index saw 76 of the table's 128 colours, so every
 * dim and dark index — which is where movy's whole dim table lives, and where
 * the only dark blues left in the palette live — was invisible to this guard.
 * It reported them as missing rather than as candidates. */
const add = (idx, hex, name) => {
    if (!PAL.has(+idx)) PAL.set(+idx, { hex: hex.toUpperCase(), name: name.trim() });
};
for (const m of src.matchAll(/^\s*(\d+)\s*:\s*#([0-9A-Fa-f]{6})\s+(.+)$/gm)) {
    const rest = m[3];
    const companions = [...rest.matchAll(/\b(dim|dark)\s+(\d+)\s+#([0-9A-Fa-f]{6})/g)];
    const base = rest.replace(/\s*\b(dim|dark)\s+\d+\s+#[0-9A-Fa-f]{6}.*$/, '').trim();
    add(m[1], m[2], base);
    for (const c of companions) add(c[2], c[3], `${base} ${c[1]}`);
}

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
/* Against an ACHROMATIC reference lightness is not the weak cue — it is one of
 * only two cues left — so that comparison uses full weight. */
const dEn = (a, b, v) => {
    const A = lab.get(a)[v], B = lab.get(b)[v];
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
const hue = (i) => { const l = lab.get(i).normal; const h = Math.atan2(l[2], l[1]) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
const chroma = (i) => { const l = lab.get(i).normal; return Math.hypot(l[1], l[2]); };
const Lof = (i) => lab.get(i).normal[0];

/* ── 1. the copy has not drifted ────────────────────────────────────────── */
_log('\npalette indices still mean what movy thinks they mean:');
const EXPECTED = {
    65: '661914', 7: 'FADC3B', 95: '134566', 23: '972BFF',
    9: 'B6FF0E', 2: '800400', 3: 'C93C00', 69: '5D1700',
};
for (const [idx, hex] of Object.entries(EXPECTED)) {
    eq(`index ${idx} is #${hex} (${name(+idx)})`, PAL.get(+idx)?.hex, hex);
}

/* ── 2. the matrix is readable ──────────────────────────────────────────── */
const M = [0, 1, 2, 3].map((g) => TRACK_COLOR.slice(g * 4, g * 4 + 4));
eq('16 track colours defined', TRACK_COLOR.length, 16);
eq('16 dim variants defined', TRACK_COLOR_DIM.length, 16);

/* 25 is the measured CIELAB floor of the chosen matrix. It is lower than the
 * 33.8 of the previous 16-distinct table ON PURPOSE: that table cleared 33.8
 * while containing pairs that read as the same colour on the hardware (Neon
 * Pink vs Electric Violet, Light Yellow vs Burnt Orange). Hue separation,
 * asserted below, is the constraint that actually tracks what the eye does —
 * CIELAB is kept as a floor, not as the goal. */
const MIN = 24;   // measured floor is 25.0 before rounding
/* 51, down from 55, and the reason is upstream: schwung's PR #185 (Caleb's
 * f07c2aae, merged 2026-08-18) recoloured the palette, keeping the names and
 * changing the values. Every dark blue, cyan and teal became a light one, which
 * the device-measured cool-hue ban excludes — so the usable hue wheel lost its
 * whole middle and now runs 31-138 plus 288-337. Four colours pairwise 55 apart
 * no longer exist in it: the largest mutually-compatible group at 55 is THREE,
 * measured, and a group of four needs 51.
 *
 * The chosen matrix achieves 51.5 degrees and dE 30.3 — a WIDER CIELAB margin
 * than the old table's 25 floor, so the colours are further apart by the metric
 * that was always the backstop; it is only the hue proxy that had to give. The
 * two reported look-alikes sat at 41 and 50 degrees AND at dE 33; 51.5/30.3
 * clears the first and the pair rule below is what actually catches the second.
 *
 * NEEDS DEVICE EYES: 51.5 has not been looked at on hardware. If two tracks
 * read alike, the fix is upstream — ask for a dark blue back. */
const HUE_MIN = 51;
const hgap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return d > 180 ? 360 - d : d; };

_log('\nwithin a group, the 4 tracks are distinguishable:');
for (let r = 0; r < 4; r++)
    for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) {
            const d = dist(M[r][a], M[r][b]), h = hgap(M[r][a], M[r][b]);
            ok(`G${r + 1}: ${name(M[r][a])} vs ${name(M[r][b])} (dE ${d.toFixed(1)}, hue ${h.toFixed(0)}deg)`,
                d >= MIN && h >= HUE_MIN);
        }

_log('\nacross groups, the same track index is distinguishable:');
for (let c = 0; c < 4; c++)
    for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) {
            const d = dist(M[a][c], M[b][c]), h = hgap(M[a][c], M[b][c]);
            ok(`track ${c + 1}: ${name(M[a][c])} vs ${name(M[b][c])} (dE ${d.toFixed(1)}, hue ${h.toFixed(0)}deg)`,
                d >= MIN && h >= HUE_MIN);
        }

/* ── 3. clear of the colours the step row already uses ──────────────────── */
/* Normal vision only. Under deuteranopia every yellow collapses onto the
 * playhead's neon green — unavoidable in this palette, and the playhead is told
 * apart by the fact that it MOVES. */
_log('\nclear of the playhead (normal vision):');
{
    let worst = Infinity, who = -1;
    for (const t of TRACK_COLOR) {
        const d = dE(t, 11, 'normal');
        if (d < worst) { worst = d; who = t; }
    }
    ok(`playhead green: nearest is ${name(who)} (${worst.toFixed(1)})`, worst >= 18);
}

/* ── 4. clear of the ACHROMATIC pads ────────────────────────────────────── */
/* A track colour also paints the chromatic root pad, and its neighbours there
 * are grey in-scale pads and white held pads. The original guard measured this
 * with lightness de-weighted like the track-vs-track checks, which is what let
 * Cyan (12 from white) and Teal Green (15) ship. Full weight, all three vision
 * models, and black included — a near-black accent is as unreadable as a
 * near-white one. */
_log('\nclear of black / dark grey / light grey / white (full lightness weight):');
for (const t of TRACK_COLOR) {
    let worst = Infinity, who = -1;
    for (const g of [0, 118, 120, 124])
        for (const v of VIEWS) {
            const d = dEn(t, g, v);
            if (d < worst) { worst = d; who = g; }
        }
    ok(`${name(t)} vs ${name(who)} (${worst.toFixed(1)})`, worst >= 20);
}

/* The two hardware rules. These are NOT derivable from CIELAB — Azure Blue
 * measures 80 from white and still read as a lit in-scale pad on the device.
 * They exist so a future edit cannot reintroduce that class of colour by
 * picking something whose numbers happen to look fine. */
_log('\nno accent is a washed-out cool hue, a pastel, or barely coloured:');
for (const t of TRACK_COLOR) {
    /* A near-grey accent slips under the pastel rule (which keys on lightness)
     * and then reads as the grey in-scale pad it sits beside. Olive Grey, C13,
     * cleared every other check in this file. */
    ok(`${name(t)} is actually a colour (C${chroma(t).toFixed(0)})`, chroma(t) >= 20);
    const cool = hue(t) >= 145 && hue(t) <= 310;
    ok(`${name(t)} is not a light cool hue (h${hue(t).toFixed(0)} L${Lof(t).toFixed(0)})`,
        !(cool && Lof(t) > 45));
    ok(`${name(t)} is not a pastel (L${Lof(t).toFixed(0)} C${chroma(t).toFixed(0)})`,
        !(Lof(t) > 65 && chroma(t) < 0.7 * Lof(t)));
}

/* Duplicates are deliberate: the rule is distinctness within a row and within a
 * column, and repeats placed off each other's row and column satisfy it. Buying
 * separation with repeats beat scraping up a 16th colour, because the bans
 * leave a 145-degree hole in the hue wheel. */
_log('\nrepeats never share a row or a column:');
for (let r = 0; r < 4; r++) eq(`G${r + 1} has 4 distinct colours`, new Set(M[r]).size, 4);
for (let c = 0; c < 4; c++) eq(`column ${c + 1} has 4 distinct colours`, new Set([0,1,2,3].map((r) => M[r][c])).size, 4);
_log(`  (${new Set(TRACK_COLOR).size} distinct colours across the 16 cells)`);

/* A dim variant must still read as ITS track's colour, not as another's. */
_log('\ndim variants stay closer to their own track than to a reserved colour:');
for (let t = 0; t < 16; t++) {
    const d = dE(TRACK_COLOR_DIM[t], 124, 'normal');   // 124 = the empty/dark grey
    /* Raised from 8: picking accents that were themselves dim variants left
     * their partners at L4-L7, which marks the loop window with something
     * indistinguishable from an unlit pad. A dim has to be visible to do its
     * job, and every partner in the current table clears 31. */
    ok(`${name(TRACK_COLOR[t])} dim is not grey (${d.toFixed(1)})`, d >= 20);
}

/* Dim variants repeat exactly where the bright table repeats — they are derived
 * per bright colour, so asserting 16 distinct dims would contradict the design.
 * What must hold is the same row/column rule. */
_log('\ndim variants follow the same row/column rule:');
{
    const D = [0, 1, 2, 3].map((g) => TRACK_COLOR_DIM.slice(g * 4, g * 4 + 4));
    for (let r = 0; r < 4; r++) eq(`G${r + 1} dims distinct`, new Set(D[r]).size, 4);
    for (let c = 0; c < 4; c++) eq(`column ${c + 1} dims distinct`, new Set([0,1,2,3].map((r) => D[r][c])).size, 4);
}

_log('');
if (failures === 0) {
    _log('\x1b[32m\x1b[1mALL TRACK-COLOUR CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} TRACK-COLOUR CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
