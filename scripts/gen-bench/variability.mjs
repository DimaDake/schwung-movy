/* How different a request's options are from each other (user, 2026-10-27:
 * "compare variability … between different options … it should be increased
 * for algorithmic options"). Every pair of options in one request is compared
 * on rhythm, notes, pitches, harmony, range, register, density, lengths and
 * velocity; the request's score is the mean over its pairs.
 */

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
