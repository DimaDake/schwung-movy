/* Layers (plans/2026-11-07-generation-paths-bench.md, round 6): how parts of
 * one kind sit together and how lines share a scene, beyond the four roles of
 * relations.mjs. A layered scene is { len (beats), drums: [parts], bass,
 * chords: [parts], lines: [parts], loops?: { bass, chords: [], lines: [] }
 * (beats) }, notes [start, dur, pitch, vel] in beats. Each metric is the mean
 * over the scene's pairs of its kind; the rules behind them:
 *   cc.*  two chord parts: one harmony (their union a chord), no semitone
 *         between their voices, registers and rhythms that divide the work;
 *   ll.*  two lines: heard as two (Huron 2016: onset asynchrony, contrary and
 *         oblique motion, no parallel perfect intervals, no crossing), an
 *         octave double meant (same rhythm, one interval) or a smear;
 *   ac/ab/al  an arp on the chords, against the bass, beside a lead;
 *   dc    a drone under every chord it holds through;
 *   cs    chord strikes on the snare (the house clap stab);
 *   ld    a lead around the drummer's fill and accents;
 *   loop  a loop shorter than the scene, over the chords of each repeat;
 *   ens.moving / reg.*  the arrangement: lines moving at once (the ear
 *         follows 3-4), octaves crowded, the middle empty. */
import { chordTrack } from './bass-metrics.mjs';
import { drumRoles, unstrum } from './relations.mjs';

const q = (x) => Math.round(x * 4);
const mean = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
const pctl = (v, f) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const onsets = (ns, L) => [...new Set(ns.map((n) => q(n[0])).filter((s) => s >= 0 && s < L))].sort((a, b) => a - b);
const at = (ns, s) => ns.filter((n) => q(n[0]) <= s && s < q(n[0]) + Math.max(1, q(n[1])));
const pairs = (xs) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b]));
const pcs = (ns) => new Set(ns.map((n) => n[2] % 12));

/* Chords the ear takes as one: triads with a 7th, 6th, 9th or sus. */
const TEMPLATES = [[0, 4, 7, 11], [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 6, 10], [0, 2, 4, 7], [0, 2, 3, 7], [0, 5, 7, 10], [0, 2, 7, 10], [0, 4, 7, 9], [0, 3, 7, 9], [0, 4, 8]];
const oneChord = (set) => set.size <= 4 && [...Array(12).keys()].some((r) => TEMPLATES.some((t) => [...set].every((p) => t.includes((p - r + 12) % 12))));
const semitone = (a, b) => a.some((x) => b.some((y) => { const d = Math.abs(x[2] - y[2]); return d % 12 === 1 || d % 12 === 11; }));

function chordPair(a, b, L) {
    const both = [...Array(L).keys()].filter((s) => at(a, s).length && at(b, s).length);
    const range = (ns) => [pctl(ns.map((n) => n[2]), 0.1), pctl(ns.map((n) => n[2]), 0.9)];
    const [a0, a1] = range(a), [b0, b1] = range(b);
    const gate = (ns) => mean(ns.map((n) => n[1]));
    const oa = onsets(a, L), ob = new Set(onsets(b, L));
    return { 'cc.agree': share(both, (s) => oneChord(new Set([...pcs(at(a, s)), ...pcs(at(b, s))]))),
        'cc.rub': share(both, (s) => semitone(at(a, s), at(b, s))),
        'cc.overlap': Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(1, Math.max(a1, b1) - Math.min(a0, b0)),
        'cc.coincide': oa.filter((s) => ob.has(s)).length / Math.max(1, Math.min(oa.length, ob.size)),
        'cc.sustain': Math.max(gate(a), gate(b)) / Math.max(0.01, Math.min(gate(a), gate(b))) };
}

/** The highest note starting at each onset: a line's pitch there. */
const top = (ns, L) => { const m = new Map(); for (const n of ns) { const s = q(n[0]); if (s < L) m.set(s, Math.max(m.get(s) ?? -1, n[2])); } return m; };

function linePair(a, b, L, pre) {
    const A = top(a, L), B = top(b, L);
    const common = [...A.keys()].filter((s) => B.has(s)).sort((x, y) => x - y);
    const union = new Set([...A.keys(), ...B.keys()]);
    const m = { [pre + 'indep']: 1 - common.length / Math.max(1, union.size) };
    const iv = common.map((s) => A.get(s) - B.get(s));
    if (common.length >= 3) {
        const moves = common.slice(1).map((s, i) => [A.get(s) - A.get(common[i]), B.get(s) - B.get(common[i]), iv[i], iv[i + 1]]).filter(([da, db]) => da || db);
        m[pre + 'contrary'] = share(moves, ([da, db]) => da * db < 0);
        m[pre + 'parallel'] = share(moves, ([da, db, i0, i1]) => da * db > 0 && [0, 7].includes(((i0 % 12) + 12) % 12) && ((i0 - i1) % 12 === 0));
        m[pre + 'dissonant'] = share(iv, (x) => [1, 2, 6, 10, 11].includes(((Math.abs(x) % 12) + 12) % 12));
        const sign = Math.sign(pctl(a.map((n) => n[2]), 0.5) - pctl(b.map((n) => n[2]), 0.5)) || 1;
        m[pre + 'cross'] = share(iv, (x) => Math.sign(x) === -sign);
        /* Same rhythm and consonant (an octave riff, a harmony line in 3rds,
         * 6ths or on chord tones, as backing vocals sing): one line doubled,
         * meant. Same rhythm and rubbing (2nds, 7ths, tritones on more than
         * one shared onset in ten): two lines smeared into one. A double is
         * not judged on independence. */
        const same = common.length / Math.max(1, union.size) >= 0.85;
        const fixed = share(iv, (x) => [1, 2, 6, 10, 11].includes(((Math.abs(x) % 12) + 12) % 12)) <= 0.1;
        m[pre + 'smear'] = same && !fixed ? 1 : 0;
        if (same && fixed) { m[pre + 'double'] = 1; delete m[pre + 'indep']; } else m[pre + 'double'] = 0;
    }
    const bars = Math.floor(L / 16);
    if (bars >= 4) {
        const per = (M) => Array.from({ length: bars }, (_, k) => [...M.keys()].filter((s) => Math.floor(s / 16) === k).length);
        const x = per(A), y = per(B), mx = mean(x), my = mean(y);
        const cov = x.reduce((acc, v, i) => acc + (v - mx) * (y[i] - my), 0), vx = x.reduce((acc, v) => acc + (v - mx) ** 2, 0), vy = y.reduce((acc, v) => acc + (v - my) ** 2, 0);
        if (vx > 0 && vy > 0) m[pre + 'answer'] = -cov / Math.sqrt(vx * vy);
    }
    return m;
}

/** What a line is: an arp (busy, even), a drone (held), or a line. */
export function lineKind(ns, L) {
    const on = onsets(ns, L), bars = Math.max(1, L / 16);
    if (on.length / bars <= 1.5 && mean(ns.map((n) => n[1])) >= 2) return 'drone';
    const ioi = on.slice(1).map((s, i) => s - on[i]);
    const c = new Map(); for (const d of ioi) c.set(d, (c.get(d) ?? 0) + 1);
    return on.length / bars >= 6 && ioi.length && Math.max(...c.values()) / ioi.length >= 0.6 ? 'arp' : 'line';
}

function arpWith(m, arp, sc, ct, L) {
    const med = (ns) => pctl(ns.map((n) => n[2]), 0.5);
    if (ct) {
        m['ac.inChord'] = share(arp.filter((n) => q(n[0]) < L), (n) => ct[q(n[0])].pcs.has(n[2] % 12));
        const key = (c) => [...c.pcs].sort().join();
        const changes = ct.map((_, s) => s).filter((s) => s > 0 && key(ct[s]) !== key(ct[s - 1]));
        m['ac.late'] = share(changes, (s) => { const n = arp.filter((x) => q(x[0]) >= s && q(x[0]) < s + 4)[0]; return !!n && !ct[s].pcs.has(n[2] % 12) && ct[s - 1].pcs.has(n[2] % 12); });
        m['ac.reg'] = med(arp) - med(sc.chords.flat());
        if (sc.bass.length) m['ab.root'] = share(changes, (s) => { const n = arp.filter((x) => q(x[0]) >= s && q(x[0]) < s + 4)[0]; const b = at(sc.bass, s)[0]; return !!n && !!b && ct[s].pcs.has(n[2] % 12); });
    }
    if (sc.bass.length) m['ab.gap'] = pctl(arp.map((n) => n[2]), 0.1) - pctl(sc.bass.map((n) => n[2]), 0.9);
}

/** The drummer's fill bars: the ones least like the loop's commonest bar. */
function fills(drums, L) {
    const bars = Math.floor(L / 16);
    if (bars < 4) return [];
    const bar = (k) => new Set(drums.filter((n) => Math.floor(q(n[0]) / 16) === k).map((n) => `${q(n[0]) % 16}.${n[2]}`));
    const all = Array.from({ length: bars }, (_, k) => bar(k));
    const like = (x, y) => { const both = [...x].filter((v) => y.has(v)).length; return both / Math.max(1, new Set([...x, ...y]).size); };
    const usual = all.map((x) => all.filter((y) => like(x, y) >= 0.8).length);
    const ref = all[usual.indexOf(Math.max(...usual))];
    return all.map((x, k) => [k, like(x, ref)]).filter(([, s]) => s < 0.6).map(([k]) => k);
}

/** Every layer metric of one scene. */
export function layers(sc) {
    const L = Math.max(16, q(sc.len));
    const m = {};
    const ct = sc.chords.some((c) => c.length) ? chordTrack(sc.chords.map(unstrum), L) : null;
    const cps = sc.chords.filter((c) => c.length >= 3);
    const pm = (rows) => { const out = {}; for (const r of rows) for (const [k, v] of Object.entries(r)) (out[k] ??= []).push(v); return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, mean(v)])); };
    if (cps.length >= 2) Object.assign(m, pm(pairs(cps).map(([a, b]) => chordPair(a, b, L))));
    const lines = sc.lines.filter((l) => l.length >= 3);
    const kinds = lines.map((l) => lineKind(l, L));
    const tunes = lines.filter((_, i) => kinds[i] !== 'drone');
    /* Two lines: an arp's even 8ths share every lead's onsets by nature (al.* judges it). */
    const voices = lines.filter((_, i) => kinds[i] === 'line');
    if (voices.length >= 2) Object.assign(m, pm(pairs(voices).map(([a, b]) => linePair(a, b, L, 'll.'))));
    if (sc.bass.length >= 3 && tunes.length) Object.assign(m, pm(tunes.map((l) => linePair(sc.bass, l, L, 'bl.'))));
    lines.forEach((l, i) => {
        if (kinds[i] === 'arp') {
            arpWith(m, l, sc, ct, L);
            const others = tunes.filter((t) => t !== l);
            if (others.length) m['al.overlap'] = mean(others.map((o) => chordPair(l, o, L)['cc.overlap']));
        }
        if (kinds[i] === 'drone' && ct) {
            const key = (c) => [...c.pcs].sort().join();
            const arr = ct.map((_, s) => s).filter((s) => (s === 0 || key(ct[s]) !== key(ct[s - 1])) && at(l, s).length);
            m['dc.clash'] = share(arr, (s) => at(l, s).some((n) => !ct[s].pcs.has(n[2] % 12) && [...ct[s].pcs].some((p) => [1, 11].includes((n[2] - p + 12) % 12))));
        }
    });
    const drums = sc.drums.flat();
    /* Two drum tracks: hits of one role on both at once double (or flam);
     * together they should fill the grid between them, not stack. */
    const kits = sc.drums.filter((d) => d.length >= 3);
    if (kits.length >= 2) Object.assign(m, pm(pairs(kits).map(([a, b]) => {
        const role = (n) => (Object.entries(drumRoles([n])).find(([, v]) => v.length)?.[0]);
        const hitA = new Set(a.map((n) => `${q(n[0])}.${role(n)}`));
        const oa = new Set(onsets(a, L)), ob = onsets(b, L);
        return { 'dd.same': share(b.filter((n) => q(n[0]) < L), (n) => hitA.has(`${q(n[0])}.${role(n)}`)),
            'dd.interlock': new Set([...oa, ...ob]).size / Math.max(1, oa.size + ob.length) };
    })));
    const { snare } = drumRoles(drums);
    const sn = new Set(onsets(snare, L));
    if (sn.size && cps.length) m['cs.backbeat'] = mean(cps.map((c) => share(onsets(c, L), (s) => sn.has(s))));
    const lead = tunes.filter((_, i) => kinds[lines.indexOf(tunes[i])] !== 'arp').sort((a, b) => b.length - a.length)[0];
    const fb = fills(drums, L);
    if (lead && fb.length) {
        const per = (k) => onsets(lead, L).filter((s) => Math.floor(s / 16) === k).length;
        const all = mean(Array.from({ length: Math.floor(L / 16) }, (_, k) => per(k)));
        if (all > 0) m['ld.fill'] = mean(fb.map(per)) / all;
    }
    if (lead && sn.size) {
        const v = lead.map((n) => n[3]), loud = pctl(v, 0.75);
        if (loud > pctl(v, 0.5)) m['ld.snare'] = share(lead.filter((n) => n[3] >= loud && q(n[0]) < L), (n) => sn.has(q(n[0])));
    }
    loops(m, sc, ct, L);
    arrangement(m, [sc.bass, ...cps, ...lines].filter((p) => p.length >= 3), L);
    return m;
}

/* A loop shorter than the scene plays over each repeat's chords: its strong
 * beats on chord tones there. Judged against the other parts' chords. */
function loops(m, sc, ct, L) {
    if (!sc.loops || !ct) return;
    const short = [['bass', sc.bass, sc.loops.bass], ...sc.lines.map((l, i) => ['line', l, sc.loops.lines[i]])].filter(([, ns, len]) => ns.length && len > 0 && q(len) < L);
    if (!short.length) return;
    const strong = (ns) => ns.filter((n) => q(n[0]) < L && q(n[0]) % 4 === 0);
    m['loop.fit'] = mean(short.map(([, ns]) => share(strong(ns), (n) => ct[q(n[0])].pcs.has(n[2] % 12))));
    /* The fault, not the colour: a strong beat a flat 9th over a chord tone
     * of its repeat (a semitone under one is a major 7th, colour; bc.rub's rule). */
    m['loop.rub'] = mean(short.map(([, ns]) => share(strong(ns), (n) => !ct[q(n[0])].pcs.has(n[2] % 12) && ct[q(n[0])].pcs.has((n[2] + 11) % 12))));
}

const OCTAVES = [24, 36, 48, 60, 72, 84, 96];
function arrangement(m, parts, L) {
    if (parts.length < 3) return;
    const moving = Array.from({ length: L }, (_, s) => parts.filter((p) => p.some((n) => q(n[0]) === s)).length);
    m['ens.moving'] = pctl(moving.filter((x) => x > 0), 0.9);
    const bands = OCTAVES.slice(0, -1).map((lo, k) => parts.filter((p) => share(p, (n) => n[2] >= lo && n[2] < OCTAVES[k + 1]) >= 0.3).length);
    m['reg.crowd'] = Math.max(...bands);
    m['reg.gap'] = (bands[0] + bands[1] > 0) && (bands[4] + bands[5] > 0) && bands[2] + bands[3] === 0 ? 1 : 0;
    const all = parts.flat().map((n) => n[2]);
    m['reg.span'] = pctl(all, 0.9) - pctl(all, 0.1);
}

/* Each metric's read, as relations.mjs METRICS: 'hi' more is never wrong, 'lo'
 * less never is, 'flag' a 0/1 rate; and the part it judges. */
export const LAYER_METRICS = {
    'cc.agree': ['chords', 'hi'], 'cc.rub': ['chords', 'lo'], 'cc.overlap': ['chords'], 'cc.coincide': ['chords'], 'cc.sustain': ['chords'],
    'll.indep': ['line'], 'll.double': ['line', 'info'], 'bl.double': ['line', 'info'], 'll.contrary': ['line'], 'll.parallel': ['line', 'lo'], 'll.dissonant': ['line', 'lo'], 'll.cross': ['line', 'lo'], 'll.smear': ['line', 'flag'], 'll.answer': ['line'],
    'bl.indep': ['line'], 'bl.contrary': ['line'], 'bl.parallel': ['line', 'lo'], 'bl.smear': ['line', 'flag'],
    'ac.inChord': ['arp', 'hi'], 'ac.late': ['arp', 'lo'], 'ac.reg': ['arp'], 'ab.root': ['arp', 'hi'], 'ab.gap': ['arp', 'hi'], 'al.overlap': ['arp', 'lo'],
    'dc.clash': ['drone', 'lo'], 'cs.backbeat': ['chords'], 'ld.fill': ['line'], 'ld.snare': ['line'], 'loop.fit': ['loop', 'info'], 'loop.rub': ['loop', 'lo'],
    'dd.same': ['drums', 'lo'], 'dd.interlock': ['drums'],
    'ens.moving': ['all', 'lo'], 'reg.crowd': ['all', 'lo'], 'reg.gap': ['all', 'flag'], 'reg.span': ['all'],
};
