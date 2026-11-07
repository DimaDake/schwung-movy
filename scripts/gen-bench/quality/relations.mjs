/* How the parts of one scene relate (plans/2026-11-07-generation-paths-bench.md,
 * rules R1-R6, H1-H5): the same numbers for real scenes (refs.mjs) and
 * generated ones (paths.mjs), so a band says what real music does. A scene is
 * { len (beats), kick, snare, hats, perc, bass, chords: [notes...], lead },
 * notes as [start, dur, pitch, vel] in beats. The bass's own metrics stay in
 * bass-metrics.mjs; root and voicing low note come from there. */
import { bassMetrics, chordTrack, median } from './bass-metrics.mjs';
import { rubs } from './musical.mjs';

const q = (x) => Math.round(x * 4);
const KICK = [35, 36], SNARE = [38, 39, 40], HATS = [42, 44, 46];

/** A drum part split by General MIDI pad, as kit.ts reads a kit with no names. */
export function drumRoles(ns) {
    return { kick: ns.filter((n) => KICK.includes(n[2])), snare: ns.filter((n) => SNARE.includes(n[2])),
        hats: ns.filter((n) => HATS.includes(n[2])), perc: ns.filter((n) => ![...KICK, ...SNARE, ...HATS].includes(n[2])) };
}

export const onsets = (ns, L) => [...new Set(ns.map((n) => q(n[0])).filter((s) => s >= 0 && s < L))].sort((a, b) => a - b);

/* Metric weights of a 4/4 bar in 16ths (Longuet-Higgins & Lee). */
const W = [0, -4, -3, -4, -2, -4, -3, -4, -1, -4, -3, -4, -2, -4, -3, -4];

/** Syncopation per bar: an onset followed by silence on a stronger position
 * scores the difference (LHL), the loop wrapping to its start. */
export function syncopation(on, L) {
    if (!on.length) return null;
    let sum = 0;
    on.forEach((s, i) => {
        const next = i + 1 < on.length ? on[i + 1] : on[0] + L;
        let wr = -Infinity;
        for (let p = s + 1; p < next; p++) wr = Math.max(wr, W[p % 16]);
        if (wr > W[s % 16]) sum += wr - W[s % 16];
    });
    return sum / Math.max(1, L / 16);
}

const jaccard = (a, b) => (a.size + b.size ? [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size : 1);

/** AAAB: how much more a 4-bar phrase's last bar departs from its first than
 * bars 2 and 3 do. Positive = the end answers. */
export function phraseEnd(on, L) {
    const bars = Math.floor(L / 16);
    if (bars < 4) return null;
    const bar = (b) => new Set(on.filter((s) => Math.floor(s / 16) === b).map((s) => s % 16));
    const v = [];
    for (let p = 0; p + 4 <= bars; p += 4) {
        const first = bar(p);
        v.push((jaccard(bar(p + 1), first) + jaccard(bar(p + 2), first)) / 2 - jaccard(bar(p + 3), first));
    }
    return v.reduce((a, x) => a + x, 0) / v.length;
}

/** Pitch-class entropy, 0 (one pitch class) to 1 (all twelve alike). */
export function pcEntropy(ns) {
    if (!ns.length) return null;
    const h = Array(12).fill(0);
    for (const n of ns) h[n[2] % 12]++;
    return -h.filter(Boolean).reduce((a, c) => a + (c / ns.length) * Math.log2(c / ns.length), 0) / Math.log2(12);
}

/** Share of notes inside the best-fitting diatonic collection (any mode). */
export function scaleFit(ns) {
    if (!ns.length) return null;
    const MAJ = [0, 2, 4, 5, 7, 9, 11];
    let best = 0;
    for (let r = 0; r < 12; r++) best = Math.max(best, ns.filter((n) => MAJ.includes((n[2] - r + 120) % 12)).length);
    return best / ns.length;
}

/** Onsets two parts share, over the sparser part's onsets. */
export function coincide(a, b) {
    if (!a.length || !b.length) return null;
    const B = new Set(b);
    return a.filter((s) => B.has(s)).length / Math.min(a.length, b.length);
}

const sounding = (ns, s) => ns.filter((n) => q(n[0]) <= s && s < q(n[0]) + Math.max(1, q(n[1])));
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);

function bassChords(m, sc, L, ct, bOn) {
    const b = bassMetrics({ len: sc.len, notes: sc.bass, chords: sc.chords, kick: sc.kick });
    if (b) Object.assign(m, { 'bc.root': b.root, 'bc.voicingLow': b.voicingLow });
    const key = (c) => [...c.pcs].sort().join();
    const arrive = ct.map((c, s) => s).filter((s) => s === 0 || key(ct[s]) !== key(ct[s - 1]));
    m['bc.inChord'] = share(arrive, (s) => {
        const at = sounding(sc.bass, s);
        const near = at.length ? at : sc.bass.filter((n) => Math.abs(q(n[0]) - s) <= 1);
        return near.length > 0 && ct[s].pcs.has(Math.min(...near.map((n) => n[2])) % 12);
    });
    m['bc.changeAlign'] = share(arrive, (s) => bOn.some((x) => Math.abs(x - s) <= 1));
    /* A chord note a semitone above the bass's pitch class, in any octave:
     * a flat 9th over the bass (E natural over an Eb bass) is heard as a
     * wrong note, where a major 7th (B over C) is colour. */
    const strikes = onsets(sc.chords.flat(), L);
    m['bc.rub'] = share(strikes, (s) => {
        const bass = sounding(sc.bass, s).map((b) => (b[2] + 1) % 12);
        return sounding(sc.chords.flat(), s).some((c) => bass.includes(c[2] % 12));
    });
}

function leadChords(m, sc, L, ct, lOn, cOn) {
    const lead = sc.lead.filter((n) => q(n[0]) < L);
    const chordNotes = sc.chords.flat();
    if (ct) {
        m['lc.strongCT'] = share(lead.filter((n) => q(n[0]) % 4 === 0), (n) => ct[q(n[0])].pcs.has(n[2] % 12));
        m['lc.rub'] = share(lead, (n) => sounding(chordNotes, q(n[0])).some((c) => rubs(c[2], n[2])));
        m['lc.coincide'] = coincide(lOn, cOn);
        m['lc.mud'] = Math.abs(median(lead.map((n) => n[2])) - median(chordNotes.map((n) => n[2]))) < 7 && m['lc.coincide'] > 0.5 ? 1 : 0;
    }
    if (sc.bass.length) m['lb.rub'] = share(lead, (n) => sounding(sc.bass, q(n[0])).some((c) => rubs(c[2], n[2])));
}

export function relations(sc) {
    const L = Math.max(16, q(sc.len));
    const bars = Math.max(1, Math.floor(L / 16));
    const on = (ns) => onsets(ns ?? [], L);
    const [kOn, sOn, hOn, bOn, lOn] = [sc.kick, sc.snare, sc.hats, sc.bass, sc.lead].map(on);
    const cOn = on(sc.chords.flat());
    const dOn = on([...sc.kick, ...sc.snare, ...sc.hats, ...sc.perc]);
    const m = {};
    const part = (name, o) => {
        if (!o.length) return;
        m[name + '.perBar'] = o.length / bars;
        m[name + '.sync'] = syncopation(o, L);
        const pe = phraseEnd(o, L);
        if (pe !== null) m[name + '.phraseEnd'] = pe;
    };
    part('kick', kOn); part('hats', hOn); part('drums', dOn); part('bass', bOn); part('chords', cOn); part('lead', lOn);
    if (sOn.length) m.backbeat = share([...Array(bars).keys()], (b) => sOn.includes(b * 16 + 4) || sOn.includes(b * 16 + 12));
    if (kOn.length || bOn.length) m.anchor = share([...Array(bars).keys()], (b) => kOn.includes(b * 16) || bOn.includes(b * 16));
    const all = [dOn, bOn, cOn, lOn].filter((o) => o.length);
    if (all.length > 1) m['ens.sync'] = syncopation(on([...sc.kick, ...sc.snare, ...sc.hats, ...sc.perc, ...sc.bass, ...sc.chords.flat(), ...sc.lead]), L);
    const pitched = [...sc.bass, ...sc.chords.flat(), ...sc.lead];
    if (pitched.length && all.length > 1) m['ens.scale'] = scaleFit(pitched);
    /* Generated scenes know their Set's key (refs do not): the share of each
     * part's notes in it, a minor key's raised 7th included (V in minor). */
    if (sc.scale) for (const [r, ns] of [['bass', sc.bass], ['chords', sc.chords.flat()], ['lead', sc.lead]]) {
        if (ns.length) m[r + '.inKey'] = share(ns, (n) => sc.scale.includes(n[2] % 12));
    }
    if (sc.lead.length) { m['lead.pcEntropy'] = pcEntropy(sc.lead); m['lead.scale'] = scaleFit(sc.lead); }
    if (kOn.length && bOn.length) {
        const lock = share(bOn, (s) => kOn.includes(s));
        const off = share(bOn, (s) => s % 4 === 2);
        Object.assign(m, { 'bk.lock': lock, 'bk.kickOnBass': share(kOn, (s) => bOn.includes(s)), 'bk.offbeat': off,
            'bk.neither': lock < 0.3 && off < 0.4 ? 1 : 0 });
    }
    const ct = sc.chords.some((c) => c.length) ? chordTrack(sc.chords, L) : null;
    if (ct?.[0] && bOn.length) bassChords(m, sc, L, ct, bOn);
    if (lOn.length) leadChords(m, sc, L, ct?.[0] ? ct : null, lOn, cOn);
    if (bOn.length && cOn.length) m['bc.coincide'] = coincide(bOn, cOn);
    return m;
}

/** Each metric: the roles it relates (the order gap groups by which came
 * last) and how its band is read: 'flag' = a 0/1 compared as a rate, 'hi' =
 * more is never wrong (only the floor counts), 'lo' = less is never wrong. */
export const METRICS = {
    'kick.perBar': ['drums'], 'hats.perBar': ['drums'], 'drums.sync': ['drums'], 'drums.phraseEnd': ['drums'],
    'bass.perBar': ['bass'], 'bass.sync': ['bass'], 'bass.phraseEnd': ['bass'], 'chords.perBar': ['chords'], 'chords.sync': ['chords'],
    'lead.perBar': ['lead'], 'lead.sync': ['lead'], 'lead.phraseEnd': ['lead'], 'lead.pcEntropy': ['lead'], 'lead.scale': ['lead', 'hi'],
    anchor: ['drums', 'bass', 'hi'], 'ens.sync': [], 'ens.scale': ['hi'],
    'bk.lock': ['bass', 'drums'], 'bk.kickOnBass': ['drums', 'bass'], 'bk.offbeat': ['bass', 'drums'], 'bk.neither': ['bass', 'drums', 'flag'],
    'bc.root': ['bass', 'chords'], 'bc.voicingLow': ['bass', 'chords', 'lo'], 'bc.inChord': ['chords', 'bass', 'hi'],
    'bc.changeAlign': ['chords', 'bass', 'hi'], 'bc.coincide': ['bass', 'chords'], 'bc.rub': ['chords', 'bass', 'lo'], 'lc.strongCT': ['lead', 'chords', 'hi'],
    'lc.rub': ['lead', 'chords', 'lo'], 'lc.coincide': ['lead', 'chords'], 'lc.mud': ['lead', 'chords', 'flag'], 'lb.rub': ['lead', 'bass', 'lo'],
};
export const ROLES = ['drums', 'bass', 'chords', 'lead'];
