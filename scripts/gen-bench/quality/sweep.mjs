/* Method 1, the knob sweep (plans/2026-10-29-generator-quality-metrics.md):
 * every knob of every generator a request serves, turned through its
 * positions with the others at their defaults. A click is DEAD when the take
 * does not change (or the guard refuses it: the screen keeps what it had); a
 * CLIFF when one click on a continuous knob rewrites most of the part; a knob
 * goes the WRONG WAY when what its name promises does not rise with it. Each
 * position is also judged musical / experimental / broken (musical.mjs). */
import { features, planOf, sig, verdict } from './musical.mjs';

/* What a knob's name promises, as the feature that must rise (+1) or fall
 * (-1) as it turns up. `dSrc`: distance from the source; `d0`: from the
 * knob's own first position. */
export const PROMISE = {
    DENSITY: ['perBar', 1], LENGTH: ['gate', 1], GATE: ['gate', 1], RANGE: ['span', 1], TENSION: ['colour', 1],
    DYNAMICS: ['accent', 1], SWING: ['shift0', 1], HUMAN: ['timing', 1], TIMING: ['timing', -1], 'PITCH FIX': ['outside', -1],
    AMOUNT: ['dSrc', 1], LIKENESS: ['dSrc', -1], DRIFT: ['d0', 1], VARY: ['d0', 1], GHOSTS: ['perBar', 1],
};

/* Knobs that set where a part sits: how far their ends move its median is
 * the register reach the bench reports. */
export const REGISTER_KNOBS = new Set(['REGISTER', 'OCTAVE', 'OCTAVES', 'RANGE', 'INTERVAL', 'SPREAD']);

/* Knobs that move a quantity: one click should be one step, not a new part. */
const CONTINUOUS = new Set(Object.keys(PROMISE));

/* How far a take's notes moved later than at the knob's first position: a
 * swing delays whichever off-beats the part has, 8ths or 16ths (feel.ts). */
function shift0(a, b) {
    if (a.length !== b.length) return null;
    const s = (x) => [...x].sort((p, q) => p.tick - q.tick || p.pitch - q.pitch);
    const A = s(a), B = s(b);
    return A.reduce((t, n, i) => t + (n.tick - B[i].tick), 0) / Math.max(1, A.length);
}

export function positions(steps, def) {
    if (steps <= 21) return Array.from({ length: steps }, (_, i) => i);
    const out = new Set([def]);
    for (let i = 0; i < 12; i++) out.add(Math.round((i * (steps - 1)) / 11));
    return [...out].sort((a, b) => a - b);
}

/** Spearman rank correlation; null when either side never moves. */
export function spearman(xs, ys) {
    const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = []; s.forEach(([, i], k) => { r[i] = k; }); return r; };
    if (new Set(ys).size < 2 || new Set(xs).size < 2) return null;
    const rx = rank(xs), ry = rank(ys), n = xs.length, m = (n - 1) / 2;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (rx[i] - m) * (ry[i] - m); dx += (rx[i] - m) ** 2; dy += (ry[i] - m) ** 2; }
    return num / Math.sqrt(dx * dy);
}

/** One generator on one request: a row per knob. */
export function sweepPreset(G, ctx, p) {
    const base = G.defaults(p, ctx);
    const rows = [];
    for (let i = 0; i < p.knobs.length; i++) {
        const k = p.knobs[i], steps = k.steps(ctx);
        if (!G.knobLive(ctx, p, base, i)) { rows.push({ knob: k.name, live: false }); continue; }
        const outs = positions(steps, base[i]).map((pos) => {
            const v = [...base]; v[i] = pos;
            const notes = G.regenerate(ctx, p, v);
            const f = notes ? features(G, ctx, notes, planOf(G, ctx, p, v)) : null;
            return { pos, notes, s: sig(notes), f, cls: verdict(f, ctx.drum) };
        });
        let dead = 0, cliff = 0;
        for (let j = 1; j < outs.length; j++) {
            if (!outs[j].notes || outs[j].s === outs[j - 1].s) dead++;
            else if (CONTINUOUS.has(k.name) && outs[j - 1].notes && G.difference(outs[j].notes, outs[j - 1].notes) > 0.8) cliff++;
        }
        let dir = null;
        const pr = PROMISE[k.name];
        if (pr && (!ctx.drum || !['span', 'outside', 'colour', 'mid'].includes(pr[0]))) {
            const ok = outs.filter((o) => o.notes);
            if (ok.length < 2) { dir = 0; } else {
            const val = (o) => (pr[0] === 'dSrc' ? G.difference(o.notes, ctx.src) : pr[0] === 'd0' ? G.difference(o.notes, ok[0].notes)
                : pr[0] === 'shift0' ? shift0(o.notes, ok[0].notes) : o.f[pr[0]]);
            const pts = ok.map((o) => [o.pos, val(o)]).filter(([, y]) => y !== null);
            const r = spearman(pts.map((x) => x[0]), pts.map((x) => x[1]));
            dir = r === null ? 0 : r * pr[1];
            }
        }
        const mids = outs.filter((o) => o.f).map((o) => o.f.mid);
        const reach = mids.length ? Math.max(...mids) - Math.min(...mids) : 0;
        rows.push({ knob: k.name, live: true, clicks: outs.length - 1, dead, cliff, dir, def: base[i], reach,
            cls: outs.map((o) => o.cls[0]), why: outs.map((o) => o.cls[1]), defCls: outs.find((o) => o.pos === base[i])?.cls[0], outs });
    }
    /* Two knobs that land on the same takes at both ends are one knob twice. */
    const live = rows.map((r, i) => [r, i]).filter(([r]) => r.live);
    const dup = [];
    for (let a = 0; a < live.length; a++) {
        for (let b = a + 1; b < live.length; b++) {
            const [ra, ia] = live[a], [rb, ib] = live[b];
            const ends = (r) => [r.outs[0].s, r.outs[r.outs.length - 1].s];
            const [a0, a1] = ends(ra), [b0, b1] = ends(rb);
            if (a0 === b0 && a1 === b1 && a1 !== a0) dup.push(`${p.knobs[ia].name}=${p.knobs[ib].name}`);
        }
    }
    for (const r of rows) delete r.outs;
    return { preset: p.id, task: ctx.task, rows, dup };
}

/* The headline numbers over every swept knob. Hidden knobs never count:
 * the screen does not show them (live.ts). */
export function sweepSummary(results) {
    const rows = results.flatMap((r) => r.rows.filter((x) => x.live).map((x) => ({ ...x, preset: r.preset, task: r.task })));
    const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
    const clicks = sum((r) => r.clicks), pos = sum((r) => r.cls.length);
    const dirs = rows.filter((r) => r.dir !== null);
    const byKnob = new Map();
    for (const r of dirs) { const e = byKnob.get(r.knob) ?? []; e.push(r.dir); byKnob.set(r.knob, e); }
    return {
        knobs: rows.length, clicks,
        dead: sum((r) => r.dead) / Math.max(1, clicks),
        useful: sum((r) => r.clicks - r.dead),
        reach: (() => { const g = rows.filter((r) => REGISTER_KNOBS.has(r.knob) && !r.task?.startsWith('x')); return g.length ? g.reduce((a, r) => a + r.reach, 0) / g.length : 0; })(),
        cliff: sum((r) => r.cliff) / Math.max(1, clicks),
        broken: sum((r) => r.cls.filter((c) => c === 'broken').length) / Math.max(1, pos),
        refused: sum((r) => r.cls.filter((c) => c === 'refused').length) / Math.max(1, pos),
        experimental: sum((r) => r.cls.filter((c) => c === 'experimental').length) / Math.max(1, pos),
        brokenDefault: rows.filter((r) => r.defCls === 'broken').length / Math.max(1, rows.length),
        promiseKept: dirs.filter((r) => r.dir >= 0.5).length / Math.max(1, dirs.length),
        byKnob: [...byKnob].map(([k, v]) => [k, v.filter((d) => d >= 0.5).length / v.length, v.length]).sort((a, b) => a[1] - b[1]),
        dups: results.filter((r) => r.dup.length).map((r) => `${r.task}:${r.preset} ${r.dup.join(',')}`),
        rows,
    };
}
