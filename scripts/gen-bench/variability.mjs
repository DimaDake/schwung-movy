/* How different a request's options are from each other (user, 2026-10-27:
 * "compare variability … between different options … it should be increased
 * for algorithmic options"). Every pair of options in one request is compared
 * on rhythm, notes, pitches, harmony, range, register, density, lengths and
 * velocity; the request's score is the mean over its pairs.
 *
 * The model's side is read from the reply cache as it stands (never re-run):
 * every cached reply from the reference model with two or more options. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const STEP = 24, BAR = 384;
const pc = (p) => ((p % 12) + 12) % 12;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const jd = (A, B) => { const u = new Set([...A, ...B]); if (!u.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return 1 - i / u.size; };

export const DIMS = ['rhythm', 'notes', 'pitches', 'harmony', 'range', 'register', 'density', 'lengths', 'velocity'];

function pair(a, b) {
    const steps = (x) => new Set(x.map((n) => Math.round(n.tick / STEP)));
    const cells = (x) => new Set(x.map((n) => `${Math.round(n.tick / STEP)}:${n.pitch}`));
    const pitches = (x) => new Set(x.map((n) => n.pitch));
    const bars = Math.max(1, ...[...a, ...b].map((n) => Math.floor(n.tick / BAR) + 1));
    let harm = 0;
    for (let i = 0; i < bars; i++) {
        const s = (x) => new Set(x.filter((n) => Math.floor(n.tick / BAR) === i).map((n) => pc(n.pitch)));
        harm += jd(s(a), s(b));
    }
    const span = (x) => (x.length ? Math.max(...x.map((n) => n.pitch)) - Math.min(...x.map((n) => n.pitch)) : 0);
    return {
        rhythm: jd(steps(a), steps(b)), notes: jd(cells(a), cells(b)), pitches: jd(pitches(a), pitches(b)), harmony: harm / bars,
        range: Math.abs(span(a) - span(b)), register: Math.abs(median(a.map((n) => n.pitch)) - median(b.map((n) => n.pitch))),
        density: Math.abs(a.length - b.length) / Math.max(1, a.length, b.length),
        lengths: Math.abs(median(a.map((n) => n.gate)) - median(b.map((n) => n.gate))) / STEP,
        velocity: Math.abs(mean(a.map((n) => n.vel)) - mean(b.map((n) => n.vel))),
    };
}

/** Mean per dimension over requests, each the mean over its option pairs. */
export function variability(requests) {
    const per = requests.filter((o) => o.length >= 2).map((opts) => {
        const ps = [];
        for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) ps.push(pair(opts[i], opts[j]));
        return Object.fromEntries(DIMS.map((d) => [d, mean(ps.map((p) => p[d]))]));
    });
    return { n: per.length, ...Object.fromEntries(DIMS.map((d) => [d, mean(per.map((p) => p[d]))])) };
}

/* A cached reply's options as notes. Positions in steps (the prompt's units)
 * or ticks: a reply whose onsets never pass 64 is read as steps. */
function optionsOf(body) {
    let text;
    try { text = JSON.parse(body).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''; } catch { return null; }
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    let opts;
    try { opts = JSON.parse(text.slice(a, b + 1).replace(/(\d+):[A-G][#b]?-?\d+/g, '$1')).options; } catch { return null; }
    if (!Array.isArray(opts)) return null;
    const raw = opts.map((o) => (Array.isArray(o?.notes) ? o.notes : []).filter((n) => Array.isArray(n) && n.length >= 4 && n.every(Number.isFinite)));
    const maxPos = Math.max(0, ...raw.flat().map((n) => n[0]));
    const k = maxPos <= 64 ? STEP : 1;
    return raw.map((ns) => ns.map((n) => ({ tick: Math.round(n[0] * k), gate: Math.round(n[1] * k), pitch: Math.round(n[2]), vel: Math.round(n[3]) })))
        .filter((ns) => ns.length);
}

/* The cache does not say which case a reply answered: the case whose input
 * its options share the most (step, pitch) cells with — a quantize keeps the
 * played notes, a variation the source's rhythm and pitches. */
export function kindOf(opts, cases) {
    const cells = (x) => new Set(x.map((n) => `${Math.round(n.tick / STEP)}:${n.pitch}`));
    let best = null, bestS = 0;
    for (const c of cases) {
        const s = Math.max(...opts.map((o) => 1 - jd(cells(o), cells(c.input))));
        if (s > bestS) { bestS = s; best = c; }
    }
    return bestS >= 0.25 ? best.kind : null;
}

export function cachedReplies(root, model) {
    const dir = root + 'cache/';
    if (!existsSync(dir)) return [];
    const out = [];
    for (const f of readdirSync(dir)) {
        const c = JSON.parse(readFileSync(dir + f, 'utf8'));
        let ver = '';
        try { ver = JSON.parse(c.body).modelVersion ?? ''; } catch { continue; }
        if (!ver.includes(model)) continue;
        const o = optionsOf(c.body);
        if (o && o.length >= 2) out.push(o.slice(0, 3));
    }
    return out;
}
