/* What the user's ratings say, per generator (plans/2026-11-07-gen-audition-design.md,
 * the fix loop): Keep/Meh/Bad, the reasons, where the marks fall, and where
 * the ear and the bench disagree. Ratings are the database's documents,
 * `{ id, data }` (ArtifactData) or the bare data. */
import { earVsBench } from './page/core.mjs';

/** One answer per document: the latest. */
function latestDocs(ratings) {
    const by = new Map();
    for (const r of ratings) {
        const d = r.data ?? r, id = r.id ?? (d.verdict ? `${d.caseId}~pick` : `${d.caseId}~${d.option ?? 'p'}`);
        if (!by.has(id) || by.get(id).at <= d.at) by.set(id, d);
    }
    return [...by.values()];
}

/* A pick, read as the first page's per-option ratings: the picked option
 * kept, the others meh (not chosen is not bad), None and Neither bad for
 * every option, All alike meh. Both fine keeps both. */
const VERDICT = { none: 'bad', neither: 'bad', alike: 'meh', both: 'keep' };
function expand(d, c) {
    if (!d.verdict) return [d];
    if (!c?.options) return [];
    return c.options.map((o, k) => ({ ...d, option: k, preset: o.preset,
        rating: d.verdict === 'pick' ? (k === d.option ? 'keep' : 'meh') : VERDICT[d.verdict], reasons: d.reasons.filter(() => d.verdict !== 'pick') }));
}

/** One rating per case and option: the latest, picks expanded. */
function latest(ratings, byId) {
    return latestDocs(ratings).flatMap((d) => expand(d, byId.get(d.caseId)));
}

const benchOf = (c, d) => (d.option === null || d.option === undefined ? c.bench : c.options[d.option].bench);

export function summarise(ratings, cases) {
    const byId = new Map(cases.map((c) => [c.id, c]));
    const gens = new Map(), picks = new Map(), blind = { real: 0, realKeep: 0, gen: 0, genKeep: 0 };
    for (const d of latest(ratings, byId)) {
        const c = byId.get(d.caseId);
        if (!c) continue;
        const g = gens.get(d.preset) ?? { generator: d.preset, n: 0, keep: 0, meh: 0, bad: 0, reasons: {}, marks: [], earVsBench: { benchOkUserBad: 0, benchBadUserKeep: 0 } };
        g.n++; g[d.rating]++;
        for (const r of d.reasons) if (r !== 'best') g.reasons[r] = (g.reasons[r] ?? 0) + 1;
        for (const m of d.marks) g.marks.push({ caseId: c.id, option: d.option, ...m });
        const diff = earVsBench(benchOf(c, d), d.rating);
        if (diff) g.earVsBench[diff]++;
        gens.set(d.preset, g);
        /* "My pick": the option the user would keep from one press. Not the
         * first one often means the generator orders its options wrongly. */
        if (c.options && d.reasons.includes('best')) {
            const p = picks.get(c.generator) ?? { generator: c.generator, n: 0, first: 0, positions: {}, presets: {} };
            p.n++; if (d.option === 0) p.first++;
            p.positions[d.option + 1] = (p.positions[d.option + 1] ?? 0) + 1;
            p.presets[d.preset] = (p.presets[d.preset] ?? 0) + 1;
            picks.set(c.generator, p);
        }
        const truth = c.kind === 'ab' ? c.options[d.option].truth : c.kind === 'blind' ? c.truth : null;
        if (truth) { blind[truth]++; if (d.rating === 'keep') blind[`${truth}Keep`]++; }
    }
    const byGenerator = [...gens.values()].sort((a, b) => b.bad - a.bad || b.n - a.n);
    const { requests, ab } = answers(ratings, byId);
    return { byGenerator, blind, picks: [...picks.values()].sort((a, b) => b.n - a.n), requests, ab };
}

/** The pick answers as they were given: per request (option sets) and per
 *  generator and role (A/B against a real part). */
function answers(ratings, byId) {
    const requests = new Map(), ab = new Map();
    for (const d of latestDocs(ratings)) {
        const c = byId.get(d.caseId);
        if (!d.verdict || !c?.options) continue;
        if (c.kind === 'ab') {
            const k = `${c.generator}:${c.target}`, a = ab.get(k) ?? { generator: c.generator, target: c.target, n: 0, real: 0, gen: 0, both: 0, neither: 0 };
            a.n++; a[d.verdict === 'pick' ? c.options[d.option].truth : d.verdict]++;
            ab.set(k, a);
            continue;
        }
        const r = requests.get(c.generator) ?? { generator: c.generator, n: 0, picked: 0, none: 0, alike: 0, first: 0, positions: {}, presets: {} };
        r.n++;
        if (d.verdict === 'pick') {
            r.picked++; if (d.option === 0) r.first++;
            r.positions[d.option + 1] = (r.positions[d.option + 1] ?? 0) + 1;
            r.presets[d.preset] = (r.presets[d.preset] ?? 0) + 1;
        } else r[d.verdict]++;
        requests.set(c.generator, r);
    }
    return { requests: [...requests.values()].sort((a, b) => b.n - a.n), ab: [...ab.values()].sort((a, b) => b.n - a.n) };
}

/** The generated cases rated bad, once per recipe, for export.mjs --first. */
export function firstList(ratings, cases) {
    const byId = new Map(cases.map((c) => [c.id, c])), out = new Map();
    for (const d of latest(ratings, byId)) {
        const c = byId.get(d.caseId);
        if (!c || d.rating !== 'bad' || c.truth === 'real' || c.pair === 'before' || c.options?.[d.option]?.truth === 'real') continue;
        out.set(c.recipeKey, { recipeKey: c.recipeKey, recipe: c.recipe, before: c });
    }
    return [...out.values()];
}

const SAME = 0.02;
const asNotes = (ns) => ns.map(([tick, gate, pitch, vel]) => ({ tick, gate, pitch, vel }));
function partOf(c, option) {
    if (option === null || option === undefined) return c.scene.tracks[c.target];
    return c.options?.[option]?.notes ?? null;
}

/** Whether `now` (the same recipe rebuilt) still plays what `old` played for
 *  the rated part: a set's option is found again by its preset. */
export function compareCase(G, old, now, option) {
    if (!now) return 'changed';
    const o = option === null || option === undefined ? option : now.options?.findIndex((x) => x.preset === old.options[option].preset);
    const a = partOf(old, option), b = o === -1 ? null : partOf(now, o);
    if (!a || !b) return 'changed';
    return G.difference(asNotes(a), asNotes(b)) < SAME ? 'same' : 'changed';
}

/** The user's ear as a gate: every rated generated case rebuilt by `rebuild(recipe)`. */
export function regression(G, ratings, cases, rebuild) {
    const byId = new Map(cases.map((c) => [c.id, c])), built = new Map();
    const out = { bads: { changed: 0, same: 0 }, keeps: { changed: [], same: 0 }, skipped: 0 };
    for (const d of latest(ratings, byId)) {
        const c = byId.get(d.caseId);
        if (!c || c.truth === 'real' || c.options?.[d.option]?.truth === 'real' || d.rating === 'meh') { out.skipped++; continue; }
        if (!built.has(c.recipeKey)) built.set(c.recipeKey, rebuild(c.recipe));
        const v = compareCase(G, c, built.get(c.recipeKey), d.option);
        if (d.rating === 'bad') out.bads[v]++;
        else if (v === 'changed') out.keeps.changed.push({ caseId: c.id, option: d.option, preset: d.preset });
        else out.keeps.same++;
    }
    return out;
}
