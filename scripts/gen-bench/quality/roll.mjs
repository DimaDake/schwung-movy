/* A scene as text, one 16th per cell, so the parts can be read against each
 * other: kick, snare, hats, the bass with its note names, the chord the
 * chords spell (chordTrack, as the bass metrics hear it) and the lead. */
import { chordTrack } from './bass-metrics.mjs';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const q = (x) => Math.round(x * 4);
const name = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
const cell = (s) => (s + '   ').slice(0, 3);

function hitRow(ns, L) {
    const on = new Set(ns.map((n) => q(n[0])));
    return Array.from({ length: L }, (_, s) => cell(on.has(s) ? 'x' : '.'));
}

/** The lowest (bass) or highest (lead) note per onset, '-' while it holds. */
function lineRow(ns, L, low) {
    const out = Array(L).fill(cell('.'));
    const by = new Map();
    for (const n of ns) { const s = q(n[0]); if (!by.has(s) || (low ? n[2] < by.get(s)[2] : n[2] > by.get(s)[2])) by.set(s, n); }
    for (const [s, n] of [...by].sort((a, b) => a[0] - b[0])) {
        if (s >= L) continue;
        for (let k = s + 1; k < Math.min(L, s + Math.max(1, q(n[1]))); k++) out[k] = cell('-');
        out[s] = cell(name(n[2]));
    }
    return out;
}

function chordRow(chords, L) {
    if (!chords.some((c) => c.length)) return Array(L).fill(cell(''));
    const ct = chordTrack(chords, L);
    const key = (c) => (c ? [...c.pcs].sort().join() : '');
    return ct.map((c, s) => cell(s === 0 || key(c) !== key(ct[s - 1]) ? NAMES[c.root] : ''));
}

export function roll(sc, head = '') {
    const L = Math.max(16, q(sc.len));
    const rows = [['kick', hitRow(sc.kick, L)], ['snare', hitRow(sc.snare, L)], ['hats', hitRow(sc.hats, L)],
        ['bass', lineRow(sc.bass, L, true)], ['chords', hitRow(sc.chords.flat(), L)], ['chord', chordRow(sc.chords, L)], ['lead', lineRow(sc.lead, L, false)]];
    const out = [head];
    for (let b = 0; b * 16 < L; b++) {
        out.push(`bar ${b + 1}`.padEnd(7) + Array.from({ length: 16 }, (_, s) => cell(s % 4 ? '' : String(s / 4 + 1))).join(''));
        for (const [n, r] of rows) out.push(n.padEnd(7) + r.slice(b * 16, b * 16 + 16).join(''));
    }
    return out.join('\n');
}
