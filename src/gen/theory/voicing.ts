/* Voice leading: a new chord voiced with the same number of voices, each
 * moving as little as it can from where it was, every essential tone present
 * (third before root before fifth — the third says major or minor, the root
 * is often in the bass anyway). */

import { nearestPitch, pc } from './pc.js';

function nearestOf(target: number, p: number, lo: number, hi: number): number {
    return nearestPitch(target, [pc(p)], lo, hi);
}

/** `required` in order of importance; `pcs` all tones a voice may take. */
export function voiceLead(prev: number[], pcs: number[], required: number[], lo: number, hi: number): number[] {
    if (!prev.length || !pcs.length) return [];
    const out = prev.map((p) => nearestPitch(p, pcs, lo, hi));
    const need = required.slice(0, out.length);
    for (const m of need) {
        if (out.some((p) => pc(p) === m)) continue;
        /* Take the cheapest voice whose tone is doubled. */
        let best = -1;
        let cost = 1e9;
        out.forEach((p, i) => {
            if (out.filter((q) => pc(q) === pc(p)).length < 2) return;
            const c = Math.abs(nearestOf(prev[i], m, lo, hi) - prev[i]);
            if (c < cost) { cost = c; best = i; }
        });
        if (best >= 0) out[best] = nearestOf(prev[best], m, lo, hi);
    }
    return spreadUnisons(out.sort((a, b) => a - b), pcs, hi);
}

/** Two voices on one pitch: the upper one moves to the next tone up. */
function spreadUnisons(v: number[], pcs: number[], hi: number): number[] {
    for (let i = 1; i < v.length; i++) {
        if (v[i] > v[i - 1]) continue;
        let p = v[i - 1] + 1;
        while (!pcs.includes(pc(p)) && p < 127) p++;
        v[i] = p <= hi + 7 ? p : v[i];
    }
    return v.sort((a, b) => a - b);
}

/** A close voicing of n voices around a centre pitch, root position. */
export function closeVoicing(pcs: number[], n: number, center: number): number[] {
    const out: number[] = [];
    let p = nearestPitch(center - 5, [pcs[0]]);
    for (let i = 0; out.length < n && i < 48; i++, p++) {
        if (pcs.includes(pc(p)) && !out.includes(p)) out.push(p);
    }
    return out;
}

/** Open the voicing: drop the second voice from the top an octave (drop-2),
 *  `amount` times over, staying above `lo`. */
export function spreadVoicing(v: number[], amount: number, lo: number): number[] {
    const out = [...v].sort((a, b) => a - b);
    for (let i = 0; i < amount && out.length >= 3; i++) {
        const k = out.length - 2 - (i % Math.max(1, out.length - 2));
        if (out[k] - 12 >= lo) out[k] -= 12;
        out.sort((a, b) => a - b);
    }
    return out;
}

/** Total semitones moved between two voicings, voice by voice. */
export function movement(a: number[], b: number[]): number {
    const x = [...a].sort((p, q) => p - q);
    const y = [...b].sort((p, q) => p - q);
    let s = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i++) s += Math.abs(x[i] - y[i]);
    return s + Math.abs(x.length - y.length) * 12;
}
