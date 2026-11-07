/* What a bass line does over its scene (plans/2026-11-06-bass-over-chords-evaluation.md):
 * the same numbers for the reference parts (the user's sets, MidiCaps) and
 * for every generator, so a gap is measured, not guessed. A clip is
 * { len (beats), notes, chords: [notes...], kick } with notes as
 * [start, dur, pitch, vel] in beats. */

const q = (x) => Math.round(x * 4);
const TRIADS = [[0, 4, 7], [0, 3, 7], [0, 3, 6], [0, 4, 8], [0, 5, 7], [0, 2, 7]];
export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

/** Per 16th: { pcs, low, root } of the chords sounding, carried over rests. */
export function chordTrack(chords, L) {
    const notes = chords.flat();
    const out = [];
    let prev = null;
    for (let s = 0; s < L; s++) {
        const t = s / 4;
        const snd = notes.filter((n) => n[0] <= t + 1e-6 && t < n[0] + Math.max(n[1], 0.25));
        if (snd.length) {
            const pcs = new Set(snd.map((n) => n[2] % 12));
            const low = snd.reduce((a, n) => (n[2] < a[2] ? n : a))[2] % 12;
            let root = low, best = -1;
            for (const r of pcs) for (const tri of TRIADS) {
                const sc = tri.filter((i) => pcs.has((r + i) % 12)).length;
                if (sc > best || (sc === best && r === low)) { best = sc; root = r; }
            }
            prev = { pcs, low, root };
        }
        out.push(prev);
    }
    const first = out.find((x) => x);
    return out.map((x) => x ?? first);
}

/** The lowest note per onset: the line as heard. */
function mono(notes) {
    const by = new Map();
    for (const n of notes) { const k = q(n[0]); if (!by.has(k) || n[2] < by.get(k)[2]) by.set(k, n); }
    return [...by.keys()].sort((a, b) => a - b).map((k) => by.get(k));
}

export function bassMetrics(o) {
    const L = Math.max(16, q(o.len));
    const bars = Math.max(1, Math.floor(L / 16));
    const ns = mono(o.notes).filter((n) => q(n[0]) < L);
    if (ns.length < 2) return null;
    const on = ns.map((n) => q(n[0]));
    const durs = ns.map((n) => Math.max(0.25, n[1]) * 4);
    const ioi = on.map((s, i) => (i + 1 < on.length ? on[i + 1] - s : L - s + on[0]));
    const cover = new Set();
    ns.forEach((n, i) => { for (let s = on[i]; s < Math.min(L, on[i] + Math.max(1, Math.round(durs[i]))); s++) cover.add(s); });
    const p = ns.map((n) => n[2]);
    const iv = p.slice(1).map((x, i) => Math.abs(x - p[i]));
    const rhythm = Array.from({ length: bars }, (_, b) => on.filter((s) => Math.floor(s / 16) === b).map((s) => s % 16).join());
    const m = {
        perBar: ns.length / bars, gate: median(durs), legato: median(durs.map((d, i) => Math.min(1.5, d / Math.max(1, ioi[i])))),
        silence: 1 - cover.size / L, steps: iv.filter((x) => x >= 1 && x <= 2).length / iv.length,
        repeats: iv.filter((x) => x === 0).length / iv.length, rhythms: new Set(rhythm).size / bars, pitch: median(p),
    };
    if (o.kick?.length) { const k = new Set(o.kick.map((x) => q(x[0]))); m.onKick = on.filter((s) => k.has(s)).length / on.length; }
    if (o.chords?.some((c) => c.length)) {
        const ct = chordTrack(o.chords, L);
        if (ct[0]) {
            let root = 0, third = 0;
            ns.forEach((n, i) => {
                const c = ct[on[i]], x = n[2] % 12;
                if (x === c.root) root++;
                else if (c.pcs.has(x) && [3, 4].includes((x - c.root + 12) % 12)) third++;
            });
            /* Following the keyboard's inversion is what the bass sounds where
             * a chord arrives: its low voice there, not the root. A riff's
             * third later in the chord is not that. */
            const arrive = ct.map((c, s) => s).filter((s) => s === 0 || ct[s] !== ct[s - 1] && ct[s].pcs.size && [...ct[s].pcs].join() !== [...ct[s - 1].pcs].join());
            let inv = 0, seen = 0;
            for (const s of arrive) {
                const c = ct[s];
                if (c.low === c.root) continue;
                const near = ns.filter((n, i) => on[i] >= s - 1 && on[i] <= s + 1);
                const snd = near.length ? near : ns.filter((n, i) => on[i] <= s && s < on[i] + durs[i]);
                if (!snd.length) continue;
                seen++;
                if (snd.some((n) => n[2] % 12 === c.low)) inv++;
            }
            Object.assign(m, { root: root / ns.length, voicingLow: seen ? inv / seen : 0, third: third / ns.length });
        }
    }
    return m;
}

export const BASS_KEYS = ['perBar', 'gate', 'legato', 'silence', 'steps', 'repeats', 'rhythms', 'root', 'voicingLow', 'third', 'onKick', 'pitch'];

/** Medians and the p25-p75 band of each metric over clips. */
export function bands(rows) {
    const out = {};
    for (const k of BASS_KEYS) {
        const v = rows.map((r) => r[k]).filter((x) => x !== undefined && x !== null).sort((a, b) => a - b);
        if (v.length) out[k] = { med: median(v), lo: v[v.length >> 2], hi: v[(3 * v.length) >> 2], n: v.length };
    }
    return out;
}
