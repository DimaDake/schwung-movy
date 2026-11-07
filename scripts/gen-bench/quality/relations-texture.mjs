/* Texture rules for the paths bench (plans/2026-11-07-generation-paths-bench.md,
 * R4, R5, H2's pedal, harmonic rhythm, accents, the loop seam): how the parts
 * share the grid and the bar, on the same scenes as relations.mjs. */

const q = (x) => Math.round(x * 4);
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
const pct = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

/* R5: parts interlock rather than double; density thins as the register rises. */
function layers(m, parts, bars) {
    const sets = Object.values(parts).filter((o) => o.length);
    if (sets.length < 2) return;
    m.interlock = new Set(sets.flat()).size / sets.reduce((a, o) => a + o.length, 0);
    const per = (o) => o.length / bars;
    const { drums, bass, chords } = parts;
    if (drums.length && bass.length && chords.length) m.stratify = per(chords) > per(bass) + 1e-9 || per(bass) > per(drums) + 1e-9 ? 1 : 0;
}

/* H2: a pedal is the bass holding one pitch class through two or more
 * chord arrivals, at least one of which it is not in. */
function pedal(m, sc, ct, L) {
    const key = (c) => [...c.pcs].sort().join();
    const arrive = ct.map((_, s) => s).filter((s) => s === 0 || key(ct[s]) !== key(ct[s - 1]));
    /* Harmonic rhythm: a new chord is neither inside the last nor around it,
     * so a comp that revoices, thins or adds a 7th is one chord. */
    const sub = (a, b) => [...a].every((x) => b.has(x));
    m['chords.changes'] = ct.filter((c, s) => { const p = ct[(s + L - 1) % L]; return !sub(c.pcs, p.pcs) && !sub(p.pcs, c.pcs); }).length / Math.max(1, L / 16);
    if (!sc.bass.length || arrive.length < 2) return;
    const bassAt = (s) => {
        const on = sc.bass.filter((n) => q(n[0]) <= s && s < q(n[0]) + Math.max(1, q(n[1])));
        return on.length ? Math.min(...on.map((n) => n[2])) % 12 : -1;
    };
    const b = arrive.map(bassAt);
    m['bc.pedal'] = share(arrive, (s, i) => {
        const run = [i - 1, i, i + 1].filter((j) => j >= 0 && j < b.length && b[j] === b[i] && b[i] >= 0);
        return run.length >= 2 && run.some((j) => !ct[arrive[j]].pcs.has(b[j]));
    });
}

/* A pitched part's accents (its loudest quarter, louder than its median)
 * land with the drums: the band leans on one beat together. */
function accents(m, sc, dOn, L) {
    if (!dOn.size) return;
    const hits = [];
    for (const ns of [sc.bass, sc.chords.flat(), sc.lead]) {
        const v = ns.map((n) => n[3]);
        if (ns.length < 4 || pct(v, 0.75) <= pct(v, 0.5)) continue;
        hits.push(...ns.filter((n) => n[3] >= pct(v, 0.75) && q(n[0]) < L).map((n) => q(n[0])));
    }
    if (hits.length) m.accent = share(hits, (s) => dOn.has(s));
}

/* The loop seam: the leap from a line's last note back to its first. Only
 * where the scene really loops (a public window is cut from a song). */
function seam(m, sc, L) {
    if (sc.kind === 'public') return;
    for (const r of ['bass', 'lead']) {
        const ns = sc[r].filter((n) => q(n[0]) < L).sort((a, b) => a[0] - b[0]);
        if (ns.length >= 2) m[r + '.seam'] = Math.abs(ns[ns.length - 1][2] - ns[0][2]);
    }
}

/* R4: generated scenes know each part's loop: every one divides the scene
 * and is 1, 2, 4, 8 or 16 bars, so the layers realign at phrase boundaries. */
function realign(m, sc) {
    const lens = (sc.lens ?? []).filter((x) => x > 0);
    if (lens.length < 2) return;
    const L = Math.max(...lens);
    m.realign = lens.every((x) => L % x === 0 && [16, 32, 64, 128, 256].includes(x)) ? 1 : 0;
}

/** Adds the texture metrics to `m`; `on` holds each role's onsets in 16ths. */
export function texture(m, sc, L, on, ct) {
    const bars = Math.max(1, Math.floor(L / 16));
    layers(m, { drums: on.drums, bass: on.bass, chords: on.chords, lead: on.lead }, bars);
    if (ct?.[0]) pedal(m, sc, ct, L);
    accents(m, sc, new Set(on.drums), L);
    seam(m, sc, L);
    realign(m, sc);
}

/* 'user': the band from the user's scenes only, where the public windows
 * measure something else (several comping parts merged into "chords"). */
export const TEXTURE_METRICS = {
    interlock: [], stratify: ['flag', 'user'], 'chords.changes': ['chords', 'user'], 'bc.pedal': ['bass', 'chords'], accent: [],
    'bass.seam': ['bass', 'lo'], 'lead.seam': ['lead', 'lo'],
};
