/* What a user would keep (plans/2026-11-07-generation-paths-bench.md, the
 * experience measures): a take is usable when the metrics touching its part,
 * and the whole scene's, sit in the real scenes' band as a real part's do. Per
 * request: how many of the options shown are usable, where the first one
 * is, how different they are, and how many knob clicks a take that is not
 * usable is from one that is. */
import { inBand } from './paths-score.mjs';
import { METRICS, relations, ROLES } from './relations.mjs';

/* How many metrics may sit out of band in a usable take: real parts in the
 * user's scenes have none out 42-49% of the time and at most one 74-82%
 * (P10-P90 bands, ~15 metrics a part), so one is what real music allows. */
export const SLACK = 1;

/** The metrics of `m` that judge `role`, those of them out of band, and
 *  whether that is few enough for a real part. */
export function judgeRole(m, bands, role) {
    const ks = Object.keys(m).filter((k) => bands[k] && m[k] !== null && m[k] !== undefined && !Number.isNaN(m[k]))
        .filter((k) => { const rs = METRICS[k].filter((r) => ROLES.includes(r)); return !rs.length || rs.includes(role); });
    const bad = ks.filter((k) => !inBand(bands[k], m[k]));
    return { ok: bad.length <= SLACK, bad, n: ks.length };
}

/** A judge of a part's notes in its scene: `scene(notes)` builds the scene with them in. */
export const judge = (bands, role, scene) => (notes) => judgeRole(relations(scene(notes)), bands, role);

/** The options shown for one request, judged. */
export function optionStats(G, picks, test) {
    const ok = picks.map((p) => test(p.notes).ok);
    let d = 0, n = 0;
    for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) { d += G.difference(picks[i].notes, picks[j].notes); n++; }
    const first = ok.indexOf(true);
    return { shown: picks.length, usable: ok.filter(Boolean).length, first: first < 0 ? null : first + 1, diversity: n ? d / n : null };
}

/** Knob clicks from a take to a usable one, turning one knob up to `max`
 *  clicks either way (0: usable as made, null: not within reach). */
export function clicksTo(G, ctx, pick, test, max = 3) {
    if (test(pick.notes).ok) return 0;
    const c = pick.ctx ?? ctx;
    for (let d = 1; d <= max; d++) {
        for (let i = 0; i < pick.preset.knobs.length; i++) {
            const top = pick.preset.knobs[i].steps(c);
            for (const s of [d, -d]) {
                const v = pick.knobs[i] + s;
                if (v < 0 || v >= top) continue;
                const w = [...pick.knobs];
                w[i] = v;
                const ns = G.regenerate(c, pick.preset, w);
                if (ns?.length && test(ns).ok) return d;
            }
        }
    }
    return null;
}

/** One request's experience row: the options, the kept take and its clicks. */
export function experience(G, r, pick, test, options = r.picks) {
    const s = optionStats(G, options, test);
    const kept = pick ? test(pick.notes) : { ok: false, bad: ['none'] };
    return { ...s, keptOk: kept.ok, keptBad: kept.bad, clicks: pick ? clicksTo(G, r.ctx, pick, test) : null };
}
