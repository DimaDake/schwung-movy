/* Method 6, bass over chords (plans/2026-11-06-bass-over-chords-evaluation.md):
 * the order the user works in, which the pieces (drums, bass, chords) never
 * took. Per scene: New Clip chords first (CHORDS / STABS / PAD, HARMONY
 * turned on odd seeds), drums on two scenes of three, then the bass track:
 * New Clip, a Variation of the BASS take over the same chords, a Smart
 * Double of it, and a Smart Quantize of it played loosely. Every bass option
 * is measured as bass-metrics.mjs does, against the reference parts of
 * .gen-data/bass-refs.json (bass-refs.mjs). */
import { existsSync, readFileSync } from 'node:fs';
import { messify } from '../messify.mjs';
import { bands, bassMetrics, BASS_KEYS } from './bass-metrics.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const KEYS = [['C', 'minor'], ['F', 'major'], ['A', 'minor'], ['D', 'minor'], ['G', 'major'], ['E', 'minor'], ['Bb', 'major'], ['F#', 'minor']];
const KIT = [36, 37, 38, 39, 42, 44, 46, 49, 51, 41, 43, 45];
const CH = ['n-chords', 'n-stabs', 'n-pad'];
const LENS = [64, 64, 128, 32];
/* A loose player: a few ticks either side, as messify's drift needs. */
const LOOSE = [-7, 3, -2, 6, -4, 1, 5, -6, 2, -3];

const clip = (track, slot, len, notes) => ({ track, slot, len, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes });
const beats = (ns) => ns.map((n) => [n.tick / 96, n.gate / 96, n.pitch, n.vel]);
const put = (set, track, slot, c) => { const t = set.tracks[track]; t.clips = [...t.clips.filter((x) => x.slot !== slot), c]; };

function scene(G, seed) {
    const [root, mode] = KEYS[seed % KEYS.length];
    const len = LENS[seed % LENS.length];
    const set = { root, mode, tracks: [0, 1, 2].map((i) => ({ index: i, name: ['Drums', 'Bass', 'Chords'][i], module: i ? 'obxd' : 'drumrack', drum: !i, padNames: null, clips: [] })) };
    const base = (drum) => ({ level: 'BALANCED', tracks: set.tracks, scale: [1, 1], drum, kit: drum ? KIT : [], root, mode });
    G.forgetOptions();
    const cr = G.generateAll({ ...base(false), task: 'create', target: { track: 2, slot: 0 }, source: null, len, nonce: seed * 11 + 3 });
    const p = cr.picks.find((x) => x.preset.id === CH[seed % 3]) ?? cr.picks[0];
    const hk = p.preset.knobs.findIndex((k) => k.name === 'HARMONY');
    const knobs = [...p.knobs];
    if (seed % 2 && hk >= 0) knobs[hk] = (knobs[hk] + 7 * seed + 3) % p.preset.knobs[hk].steps(cr.ctx);
    const chords = G.regenerate(cr.ctx, p.preset, knobs) ?? p.notes;
    for (const slot of [0, 1]) put(set, 2, slot, clip(2, slot, len, chords));
    if (seed % 3 !== 2) {
        G.forgetOptions();
        const dr = G.generateAll({ ...base(true), task: 'create', target: { track: 0, slot: 0 }, source: null, len, nonce: seed * 5 + 1 });
        const d = dr.picks.find((x) => x.preset.id === 'n-groove') ?? dr.picks[0];
        for (const slot of [0, 1]) put(set, 0, slot, clip(0, slot, len, d.notes));
    }
    const kick = (set.tracks[0].clips[0]?.notes ?? []).filter((n) => n.pitch === 36);
    return { set, len, base, chords, kick, seed };
}

/** Every bass option of one scene, by `task:preset`. */
function options(G, s) {
    const { set, len, base } = s;
    const out = [];
    const add = (task, picks, l) => { for (const p of picks) out.push({ id: `${task}:${p.preset.id}`, notes: p.notes, len: l }); };
    G.forgetOptions();
    const nc = G.generateAll({ ...base(false), task: 'create', target: { track: 1, slot: 0 }, source: null, len, nonce: s.seed * 13 + 7 });
    const bassish = nc.picks.filter((p) => ['n-bass', 'n-pulse', 'n-walk'].includes(p.preset.id));
    add('new', bassish, len);
    const take = bassish.find((p) => p.preset.id === 'n-bass');
    if (!take) return out;
    put(set, 1, 0, clip(1, 0, len, take.notes));
    const vr = G.generateAll({ ...base(false), task: 'variation', target: { track: 1, slot: 1 }, source: { track: 1, slot: 0 }, len }, 6);
    add('var', [...vr.picks, ...vr.extras], len);
    if (len * 2 <= 256) {
        const db = G.generateAll({ ...base(false), task: 'double', target: { track: 1, slot: 0 }, source: null, len: len * 2 });
        add('dbl', db.picks, len * 2);
    }
    put(set, 1, 0, clip(1, 0, len, messify(take.notes, LOOSE, s.seed, { slip: 0.1 })));
    const qz = G.generateAll({ ...base(false), task: 'quantize', target: { track: 1, slot: 0 }, source: null, len });
    add('qnt', qz.picks, len);
    set.tracks[1].clips = [];
    return out;
}

export function bassBench(G, n = 24) {
    const refs = existsSync(DATA + 'bass-refs.json') ? JSON.parse(readFileSync(DATA + 'bass-refs.json', 'utf8')) : [];
    const ref = { user: bands(refs.filter((r) => r.kind === 'user').map(bassMetrics).filter(Boolean)),
        public: bands(refs.filter((r) => r.kind === 'public').map(bassMetrics).filter(Boolean)) };
    const rows = new Map();
    for (let seed = 0; seed < n; seed++) {
        const s = scene(G, seed);
        for (const o of options(G, s)) {
            const m = bassMetrics({ len: o.len / 4, notes: beats(o.notes), chords: [beats(s.chords)], kick: beats(s.kick) });
            if (!m) continue;
            if (!rows.has(o.id)) rows.set(o.id, []);
            rows.get(o.id).push(m);
        }
    }
    const per = [...rows].map(([id, ms]) => ({ id, n: ms.length, ...bands(ms) }));
    /* In the band: a metric whose median sits inside the user's or the public parts' p25-p75. */
    const inBand = (b, k) => [ref.user[k], ref.public[k]].some((r) => r && b[k] && b[k].med >= r.lo - 1e-9 && b[k].med <= r.hi + 1e-9);
    for (const p of per) p.inBand = BASS_KEYS.filter((k) => p[k]).filter((k) => inBand(p, k)).length / Math.max(1, BASS_KEYS.filter((k) => p[k]).length);
    const all = [...rows.values()].flat();
    return { refs: { user: refs.filter((r) => r.kind === 'user').length, public: refs.filter((r) => r.kind === 'public').length }, ref, per,
        voicingLow: all.length ? all.reduce((a, m) => a + (m.voicingLow ?? 0), 0) / all.length : null,
        inBand: per.length ? per.reduce((a, p) => a + p.inBand * p.n, 0) / per.reduce((a, p) => a + p.n, 0) : null };
}
