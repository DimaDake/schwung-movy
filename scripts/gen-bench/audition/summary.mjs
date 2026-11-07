/* What the user's ratings say, per generator (plans/2026-11-07-gen-audition-design.md,
 * the fix loop): Keep/Meh/Bad, the reasons, where the marks fall, and where
 * the ear and the bench disagree. Ratings are the database's documents,
 * `{ id, data }` (ArtifactData) or the bare data. */
import { earVsBench } from './page/core.mjs';

/** One rating per case and option: the latest. */
function latest(ratings) {
    const by = new Map();
    for (const r of ratings) {
        const d = r.data ?? r, id = r.id ?? `${d.caseId}~${d.option ?? 'p'}`;
        if (!by.has(id) || by.get(id).at <= d.at) by.set(id, d);
    }
    return [...by.values()];
}

const benchOf = (c, d) => (d.option === null || d.option === undefined ? c.bench : c.options[d.option].bench);

export function summarise(ratings, cases) {
    const byId = new Map(cases.map((c) => [c.id, c]));
    const gens = new Map(), blind = { real: 0, realKeep: 0, gen: 0, genKeep: 0 };
    for (const d of latest(ratings)) {
        const c = byId.get(d.caseId);
        if (!c) continue;
        const g = gens.get(d.preset) ?? { generator: d.preset, n: 0, keep: 0, meh: 0, bad: 0, reasons: {}, marks: [], earVsBench: { benchOkUserBad: 0, benchBadUserKeep: 0 } };
        g.n++; g[d.rating]++;
        for (const r of d.reasons) if (r !== 'best') g.reasons[r] = (g.reasons[r] ?? 0) + 1;
        for (const m of d.marks) g.marks.push({ caseId: c.id, option: d.option, ...m });
        const diff = earVsBench(benchOf(c, d), d.rating);
        if (diff) g.earVsBench[diff]++;
        gens.set(d.preset, g);
        if (c.kind === 'blind') { blind[c.truth]++; if (d.rating === 'keep') blind[`${c.truth}Keep`]++; }
    }
    const byGenerator = [...gens.values()].sort((a, b) => b.bad - a.bad || b.n - a.n);
    return { byGenerator, blind };
}

/** The generated cases rated bad, once per recipe, for export.mjs --first. */
export function firstList(ratings, cases) {
    const byId = new Map(cases.map((c) => [c.id, c])), out = new Map();
    for (const d of latest(ratings)) {
        const c = byId.get(d.caseId);
        if (!c || d.rating !== 'bad' || c.truth === 'real' || c.pair === 'before') continue;
        out.set(c.recipeKey, { recipeKey: c.recipeKey, recipe: c.recipe, before: c });
    }
    return [...out.values()];
}
