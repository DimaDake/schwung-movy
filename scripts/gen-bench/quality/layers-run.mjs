/* The layers bench (layers.mjs, layers-paths.mjs): a fifth part New Clip
 * adds to a scene, judged on how it layers, against real scenes.
 *
 *   npm run build:browser && node scripts/gen-bench/quality/layers-run.mjs --label base [--seeds 6]
 *
 * Writes .gen-data/layers/<label>/report.md and result.json. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { layers, LAYER_METRICS } from './layers.mjs';
import { addPart, AS, CHORD_IDS, layerAt, LINE_IDS, realSet, regenerate, sixTracks } from './layers-paths.mjs';
import { loadBands, inBand } from './paths-score.mjs';
import { SLACK } from './keep.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', 'layers'), SEEDS = Number(arg('seeds', 6));
const { raw } = loadBands(DATA);
const G = await import('../../../dist/esm/gen/index.js');
const t0 = Date.now();
const ok = (x) => x !== null && x !== undefined && !Number.isNaN(x);
const pct = (x) => (ok(x) ? `${Math.round(x * 100)}%` : '–');
const f2 = (x) => (ok(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(2)) : '–');

/* Bands: P10-P90 per kind with 20 or more scenes, the wider; where neither
 * has 20, both pooled from 12 up ('thin'). Rules where real music is unanimous. */
const refScene = (r) => ({ len: r.len, drums: r.drumParts?.length ? r.drumParts : [[...r.kick, ...r.snare, ...r.hats, ...r.perc]], bass: r.bass, chords: r.chords, lines: r.lines ?? [], loops: r.loops, kind: r.kind });
const refRows = raw.map((r) => ({ kind: r.kind, m: layers(refScene(r)) }));
/* A short loop over changing chords: only 8 real scenes have one (a strong
 * beat a semitone off the chord: median 0.05), so a rule. Off the chord but
 * not against it (a 9th, a 7th) is the ostinato's colour: reported only. */
const RULES = { 'loop.fit': { read: 'info' }, 'loop.rub': { lo: 0, hi: 0.1, read: 'lo', rule: 'a strong beat in ten off the chord at most' }, 'll.double': { read: 'info' }, 'bl.double': { read: 'info' }, 'dc.clash': { lo: 0, hi: 0, read: 'lo', rule: 'none at a chord arrival' }, 'reg.gap': { read: 'flag', rate: 0, rule: 'never in real scenes' },
    'll.smear': { read: 'flag', rate: 0, rule: 'never in real scenes' }, 'bl.smear': { read: 'flag', rate: 0, rule: 'never in real scenes' }, 'dd.same': { read: 'info' } };
function bandOf(k) {
    if (RULES[k]) return RULES[k];
    const read = LAYER_METRICS[k].find((x) => ['hi', 'lo', 'flag'].includes(x)) ?? 'band';
    const vals = (rows) => rows.map((r) => r.m[k]).filter(ok).sort((a, b) => a - b);
    const b = (v) => ({ lo: v[Math.floor(0.1 * v.length)], hi: v[Math.min(v.length - 1, Math.floor(0.9 * v.length))], n: v.length });
    const kinds = ['public', 'user'].map((kind) => vals(refRows.filter((r) => r.kind === kind))).filter((v) => v.length >= 20).map(b);
    if (kinds.length) return { lo: Math.min(...kinds.map((x) => x.lo)), hi: Math.max(...kinds.map((x) => x.hi)), read, n: kinds.reduce((a, x) => a + x.n, 0) };
    const all = vals(refRows);
    return all.length >= 12 ? { ...b(all), read, thin: true } : null;
}
const BANDS = Object.fromEntries(Object.keys(LAYER_METRICS).map((k) => [k, bandOf(k)]).filter(([, b]) => b));
const judged = (b) => b && b.read !== 'info';
const pass = (k, v) => inBand({ ...BANDS[k], read: BANDS[k].read === 'flag' ? 'flag' : BANDS[k].read }, v);

/* What each kind of added part is judged on. */
const FOR = { chords: ['chords', 'all'], line: ['line', 'all'], arp: ['arp', 'line', 'all'], drone: ['drone', 'all'], loop: ['loop', 'line', 'arp', 'all'], drums: ['drums'] };
const judge = (m, kind) => {
    const ks = Object.keys(m).filter((k) => judged(BANDS[k]) && ok(m[k]) && FOR[kind].includes(LAYER_METRICS[k][0]));
    const bad = ks.filter((k) => !pass(k, m[k]));
    return { ok: bad.length <= SLACK, bad, n: ks.length };
};

/* The scenarios: what track 4 or 5 gets, its kind, its length. */
const SCEN = [
    ...CHORD_IDS.map((id) => ({ name: `${id} over the band`, id, track: 4, kind: 'chords' })),
    ...['n-melody', 'n-riff', 'n-counter', 'n-harmonize', 'n-follow', 'n-looper'].map((id) => ({ name: `${id} beside the lead`, id, track: 4, kind: 'line' })),
    { name: 'n-arp over the band', id: 'n-arp', track: 4, kind: 'arp' },
    { name: 'n-hold under the chords', id: 'n-hold', track: 4, kind: 'drone' },
    ...['n-arp', 'n-riff', 'n-melody'].flatMap((id) => [16, 48].map((len) => ({ name: `${id} ${len / 16}-bar loop`, id, track: 4, kind: 'loop', len }))),
    ...['n-perc', 'n-euclid-kit', 'n-broken'].map((id) => ({ name: `${id} as a second kit`, id, track: 5, kind: 'drums' })),
];
const rows = [];
for (const sc of SCEN) {
    for (let s = 0; s < SEEDS; s++) {
        const set = sixTracks(G, s);
        const len = sc.len ?? set.tracks[2].clips[0]?.len ?? 64;
        const pick = addPart(G, set, sc.track, sc.id, len, s * 31 + 7);
        if (!pick) continue;
        const as = [...AS, sc.kind === 'chords' ? 'chords' : 'line', 'drums'];
        const m = layers(layerAt(set, 0, as));
        rows.push({ scen: sc.name, kind: sc.kind, seed: s, m, j: judge(m, sc.kind) });
    }
}

/* Leave one out: one of two chord parts, or of two lines, regenerated in real scenes. */
const loo = [];
for (const ref of raw) {
    const real = realSet(G, ref);
    if (!real) continue;
    for (const [kind, ids] of [['chords', CHORD_IDS], ['line', LINE_IDS]]) {
        const idx = real.as.map((k, i) => (k === kind ? i : -1)).filter((i) => i >= 0);
        if (idx.length < 2) continue;
        const i = idx[idx.length - 1];
        const rj = judge(layers(layerAt(real.set, 0, real.as)), kind);
        for (const o of regenerate(G, real, i, ids, G.hash(ref.src + i))) {
            const j = judge(layers(o.scene), kind);
            const worse = j.bad.filter((b) => !rj.bad.includes(b));
            loo.push({ kind, ref: ref.kind, id: o.id, real: rj.ok, ok: worse.length <= SLACK, worse });
        }
    }
}

const top = (lists) => { const c = new Map(); for (const l of lists) for (const b of l) c.set(b, (c.get(b) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ') || '–'; };
const scenLines = SCEN.map((sc) => { const rs = rows.filter((r) => r.scen === sc.name); return rs.length ? `| ${sc.name} | ${rs.length} | ${pct(rs.filter((r) => r.j.ok).length / rs.length)} | ${top(rs.map((r) => r.j.bad))} |` : null; }).filter(Boolean);
const metricLines = Object.entries(BANDS).map(([k, b]) => {
    const v = rows.map((r) => r.m[k]).filter(ok).sort((a, c) => a - c);
    const band = b.read === 'info' ? 'info' : b.rule ? `rule: ${b.rule}` : b.read === 'flag' ? `rate ≤ ${pct(b.rate)}` : b.read === 'hi' ? `≥ ${f2(b.lo)}` : b.read === 'lo' ? `≤ ${f2(b.hi)}` : `${f2(b.lo)}–${f2(b.hi)}`;
    return `| ${k} | ${band}${b.thin ? ' (thin)' : ''} | ${v.length} | ${v.length ? f2(v[v.length >> 1]) : '–'} | ${v.length && judged(b) ? pct(v.filter((x) => pass(k, x)).length / v.length) : '–'} |`;
});
const looLines = [...new Set(loo.map((x) => `${x.kind}|${x.id}`))].map((key) => {
    const [kind, id] = key.split('|');
    const xs = loo.filter((x) => x.kind === kind && x.id === id);
    return `| ${kind} | ${id} | ${xs.length} | ${pct(xs.filter((x) => x.real).length / xs.length)} | ${pct(xs.filter((x) => x.ok).length / xs.length)} | ${top(xs.map((x) => x.worse))} |`;
});
const md = `# Layers bench: ${label}\n\n${rows.length} layered scenes (${SEEDS} seeds), ${loo.length} real-scene options; ${Date.now() - t0} ms.\n`
    + `Usable: at most ${SLACK} of the part's layer metrics out of the real band (keep.mjs SLACK). Thin: under 20 real scenes of either kind, pooled.\n\n`
    + `## A fifth part over scene A\n\n| scenario | n | usable | fails most on |\n|---|---|---|---|\n${scenLines.join('\n')}\n\n`
    + `## Per metric (all scenarios)\n\n| metric | real band | n | generated median | in band |\n|---|---|---|---|---|\n${metricLines.join('\n')}\n\n`
    + `## Leave one out: one of two chord parts or lines, regenerated in a real scene\n\nAs good as real: at most ${SLACK} metric out that the real part had in.\n\n`
    + `| kind | generator | n | real usable | as good as real | worse than real on |\n|---|---|---|---|---|---|\n${looLines.join('\n')}\n`;
const dir = DATA + `layers/${label}/`;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'report.md', md);
writeFileSync(dir + 'result.json', JSON.stringify({ label, bands: BANDS, rows: rows.map(({ scen, seed, m, j }) => ({ scen, seed, m, bad: j.bad })), loo }));
console.log(md);
