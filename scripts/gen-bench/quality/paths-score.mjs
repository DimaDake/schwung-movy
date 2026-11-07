/* Scoring the paths against real scenes (plans/2026-11-07-generation-paths-bench.md):
 * a metric's band is the P10-P90 of the public and the user's scenes (the
 * wider of the two where each has 20 or more), a flag's limit is the higher of
 * their rates. The order gap compares the share in band when a metric's first
 * role was generated after its second with the share when it came before. */
import { METRICS, ROLES } from './relations.mjs';

const MIN_REFS = 20;
const ok = (x) => x !== undefined && x !== null && !Number.isNaN(x);

function band(vals) {
    const v = vals.filter(ok).sort((a, b) => a - b);
    if (v.length < MIN_REFS) return null;
    const at = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    return { lo: at(0.1), hi: at(0.9), med: at(0.5), rate: v.reduce((a, x) => a + x, 0) / v.length, n: v.length };
}

/** refRows: [{ kind, m }] → { metric: { lo, hi, rate, ... } } */
export function refBands(refRows) {
    const out = {};
    for (const k of Object.keys(METRICS)) {
        const bs = ['public', 'user'].map((kind) => band(refRows.filter((r) => r.kind === kind).map((r) => r.m[k]))).filter(Boolean);
        if (!bs.length) continue;
        out[k] = { lo: Math.min(...bs.map((b) => b.lo)), hi: Math.max(...bs.map((b) => b.hi)), rate: Math.max(...bs.map((b) => b.rate)),
            med: bs.map((b) => b.med), read: METRICS[k].find((x) => !ROLES.includes(x)) ?? 'band' };
    }
    return out;
}

/** Is one value acceptable: inside the band, or for a flag, unflagged. */
export const inBand = (b, v) => (b.read === 'flag' ? v === 0 : (b.read === 'lo' || v >= b.lo - 1e-9) && (b.read === 'hi' || v <= b.hi + 1e-9));

/** Which group a path falls in for a metric: 'after' when the metric's first
 * role was generated after its second (or, for one role, not first). */
export function groupOf(metric, order) {
    const [x, y] = METRICS[metric].filter((r) => ROLES.includes(r));
    if (!x) return null;
    if (!y) return order.indexOf(x) > 0 ? 'after' : 'before';
    return order.indexOf(x) > order.indexOf(y) ? 'after' : 'before';
}

/** Per metric: refs band, share in band (all / before / after) and the gap. */
export function score(rows, bands) {
    const out = [];
    for (const [k, b] of Object.entries(bands)) {
        const vals = rows.filter((r) => ok(r.m[k]));
        if (!vals.length) continue;
        const share = (rs) => (rs.length ? rs.filter((r) => inBand(b, r.m[k])).length / rs.length : null);
        const g = (name) => vals.filter((r) => groupOf(k, r.order) === name);
        const med = (rs) => { const v = rs.map((r) => r.m[k]).sort((a, c) => a - c); return v.length ? v[v.length >> 1] : null; };
        const before = share(g('before')), after = share(g('after'));
        out.push({ metric: k, band: b, n: vals.length, med: med(vals), medBefore: med(g('before')), medAfter: med(g('after')), all: share(vals), before, after,
            gap: before !== null && after !== null ? after - before : null });
    }
    return out;
}

/** The order-gap table and the in-band shares, as markdown. */
export function table(sc, prev) {
    const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
    const f2 = (x) => (x === null || x === undefined ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(2));
    const was = (k) => prev?.find((p) => p.metric === k);
    const lines = ['| metric | refs band | gen median | in band | first role before: in band (median) | after | gap | was |', '|---|---|---|---|---|---|---|---|'];
    for (const r of sc) {
        const b = r.band;
        const ref = b.read === 'flag' ? `rate ≤ ${pct(b.rate)}` : b.read === 'hi' ? `≥ ${f2(b.lo)}` : b.read === 'lo' ? `≤ ${f2(b.hi)}` : `${f2(b.lo)}–${f2(b.hi)}`;
        const gap = r.gap === null ? '–' : `${r.gap > 0 ? '+' : ''}${Math.round(r.gap * 100)}`;
        const mark = r.gap !== null && Math.abs(r.gap) >= 0.15 ? ' ⚠' : '';
        lines.push(`| ${r.metric} | ${ref} | ${f2(r.med)} | ${pct(r.all)} | ${pct(r.before)} (${f2(r.medBefore)}) | ${pct(r.after)} (${f2(r.medAfter)}) | ${gap}${mark} | ${pct(was(r.metric)?.all)} |`);
    }
    return lines.join('\n');
}

/** After the first step the user hears one part alone: per role made first,
 * the medians of its own metrics and of the anchor, against the bands. */
export function firstStep(rows, bands) {
    const pct = (x) => `${Math.round(x * 100)}%`;
    const lines = ['| made first | metric | refs band | median alone | in band |', '|---|---|---|---|---|'];
    for (const role of ROLES) {
        const rs = rows.filter((r) => r.order[0] === role && r.steps?.length);
        for (const k of [`${role}.perBar`, `${role}.sync`, 'anchor']) {
            const b = bands[k];
            const v = rs.map((r) => r.steps[0][k]).filter(ok).sort((a, c) => a - c);
            if (!b || !v.length) continue;
            lines.push(`| ${role} | ${k} | ${b.lo.toFixed(2)}–${b.hi.toFixed(2)} | ${v[v.length >> 1].toFixed(2)} | ${pct(v.filter((x) => inBand(b, x)).length / v.length)} |`);
        }
    }
    return lines.join('\n');
}

/** The Set's key has no reference band: per part, its median share of notes
 * in key when made first / after others, and the scenes under 90%. */
export function keyTable(rows) {
    const lines = ['| part | in key, made before its partner | made after | scenes < 90% in key (before / after) |', '|---|---|---|---|'];
    const partner = { bass: 'drums', chords: 'bass', lead: 'chords' };
    for (const [role, other] of Object.entries(partner)) {
        const k = role + '.inKey';
        const g = (after) => rows.filter((r) => ok(r.m[k]) && (r.order.indexOf(role) > r.order.indexOf(other)) === after).map((r) => r.m[k]).sort((a, c) => a - c);
        const med = (v) => (v.length ? v[v.length >> 1].toFixed(2) : '–');
        const low = (v) => `${v.filter((x) => x < 0.9).length}/${v.length}`;
        lines.push(`| ${role} (vs ${other}) | ${med(g(false))} | ${med(g(true))} | ${low(g(false))} / ${low(g(true))} |`);
    }
    return lines.join('\n');
}
