/* Smart Double on the bench (plans/2026-10-28-smart-double-design.md): every
 * case's own clip doubled, at each level. No model ever ran this task, so
 * there is no reference row; what is measured is what the design promises —
 * the first part kept, the ending moved, the ending still on the chords,
 * and options that differ from each other. */
import { DIMS, variability } from './variability.mjs';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f2 = (v) => (v === null || v === undefined ? '-' : v.toFixed(2));
const cells = (ns) => new Set(ns.map((n) => `${Math.round(n.tick / 24)}:${n.pitch}`));
const jaccard = (A, B) => { const u = new Set([...A, ...B]); if (!u.size) return 1; let i = 0; for (const x of A) if (B.has(x)) i++; return i / u.size; };

/** The case's own clip as a Smart Double request, or null when it cannot double. */
export function doubleInput(c, level) {
    const at = c.set.source ?? c.set.target;
    const clip = c.set.tracks.find((t) => t.index === at.track)?.clips.find((k) => k.slot === at.slot);
    if (!clip?.notes.length || (clip.loopStart ?? 0) + clip.len * 2 > 256) return null;
    return { task: 'double', level, tracks: c.set.tracks, target: at, source: null, len: clip.len * 2, scale: [1, 1], drum: c.drum,
        kit: c.drum ? [...new Set(clip.notes.map((n) => n.pitch))] : [], root: c.set.root, mode: c.set.mode };
}

function measure(G, input) {
    const { picks, ctx } = G.generateAll(input);
    const half = ctx.end / 2, tail = ctx.end * 0.75;
    const per = picks.map((p) => {
        const firstKept = jaccard(cells(p.notes.filter((n) => n.tick < half)), cells(ctx.src.filter((n) => n.tick < half)));
        const end = p.notes.filter((n) => n.tick >= tail);
        const novelty = 1 - jaccard(cells(end), cells(ctx.src.filter((n) => n.tick >= tail)));
        const fit = ctx.drum ? null : mean(end.map((n) => G.noteFit(n.pitch, G.chordAt(ctx.plans[0].chords, n.tick, ctx.k), ctx.key, G.isStrong(n.tick))));
        return { firstKept, novelty, fit };
    });
    return { picks, per };
}

/** Markdown lines for the bench report. */
export function doubleSection(G, cases) {
    const out = ['', '## Smart Double', '', 'Each case\'s own clip doubled. First part kept: the first half\'s (step, pitch) cells shared with '
        + 'the clip as played (1 = untouched). Ending novelty: the last quarter\'s cells not in the plain double. Coherence: chord fit of '
        + 'the last quarter (melodic). Variability: between the options of one request, as above.', '',
        '| level | requests | options | first part kept | ending novelty | coherence | rhythm var | notes var |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
    const used = new Map();
    for (const level of ['SAFE', 'BALANCED', 'WILD']) {
        const runs = cases.map((c) => doubleInput(c, level)).filter(Boolean).map((i) => measure(G, i));
        const ops = runs.flatMap((r) => r.per);
        const v = variability(runs.map((r) => r.picks.map((p) => p.notes)));
        if (level === 'BALANCED') for (const r of runs) for (const p of r.picks) used.set(p.preset.id, (used.get(p.preset.id) ?? 0) + 1);
        out.push(`| ${level} | ${runs.length} | ${f2(mean(runs.map((r) => r.picks.length)))} | ${f2(mean(ops.map((o) => o.firstKept)))} | `
            + `${f2(mean(ops.map((o) => o.novelty)))} | ${f2(mean(ops.map((o) => o.fit).filter((x) => x !== null)))} | ${f2(v[DIMS[0]])} | ${f2(v[DIMS[1]])} |`);
    }
    out.push('', 'Generators picked (BALANCED): ' + [...used].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`).join(', ') + '.');
    return out;
}
