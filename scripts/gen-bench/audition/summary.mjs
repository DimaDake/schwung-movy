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
    for (const d of latest(ratings)) {
        const c = byId.get(d.caseId);
        if (!c || c.truth === 'real' || d.rating === 'meh') { out.skipped++; continue; }
        if (!built.has(c.recipeKey)) built.set(c.recipeKey, rebuild(c.recipe));
        const v = compareCase(G, c, built.get(c.recipeKey), d.option);
        if (d.rating === 'bad') out.bads[v]++;
        else if (v === 'changed') out.keeps.changed.push({ caseId: c.id, option: d.option, preset: d.preset });
        else out.keeps.same++;
    }
    return out;
}
