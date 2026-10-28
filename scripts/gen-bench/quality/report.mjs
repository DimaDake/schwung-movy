/* The quality bench's report: one scorecard of every headline number, each
 * with the way it should move, then where the problems are, generator by
 * generator, so a fix starts from the worst offender rather than the mean. */

const f2 = (v) => (v === null || v === undefined || Number.isNaN(v) ? '-' : v.toFixed(2));
const pc = (v) => (v === null || v === undefined ? '-' : Math.round(v * 100) + '%');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** [name, value, +1 higher is better / -1 lower is better, format, how far it may slip before it counts as a regression] */
export function scorecard(r) {
    const P = r.pieces, share = (v) => P.filter((p) => p.verdict === v).length / Math.max(1, P.length);
    const sc = P.flatMap((p) => p.scenes);
    return [
        ['1 knobs: dead clicks', r.sweep.dead, -1, pc, 0.01], ['1 knobs: cliffs', r.sweep.cliff, -1, pc, 0.01],
        ['1 knobs: promise kept', r.sweep.promiseKept, 1, pc, 0.02], ['1 knobs: broken positions', r.sweep.broken, -1, pc, 0.01],
        ['1 knobs: experimental positions', r.sweep.experimental, 0, pc, 1], ['1 knobs: duplicate knob pairs', r.sweep.dups.length, -1, String, 0],
        ['1 knobs: refused positions', r.sweep.refused, -1, pc, 0.01],
        ['2 space: musical', r.space.musical, 1, pc, 0.02], ['2 space: broken', r.space.broken, -1, pc, 0.01],
        ['2 space: refused (turn does nothing)', r.space.refused, -1, pc, 0.01],
        ['2 space: default musical', r.space.defMusical, 1, pc, 0.01], ['2 space: next to default broken', r.space.nearBroken, -1, pc, 0.01],
        ['4 piece: musical', share('musical'), 1, pc, 0.05], ['4 piece: broken', share('broken'), -1, pc, 0.0],
        ['4 piece: clash (strong beats)', mean(sc.map((s) => s.clash)), -1, pc, 0.01], ['4 piece: chord fit', mean(sc.map((s) => s.fit)), 1, f2, 0.01],
        ['4 piece: worst part fit', mean(sc.map((s) => s.worst)), 1, f2, 0.02], ['4 piece: low-end mud scenes', sc.filter((s) => s.mud).length, -1, String, 0],
        ['4 piece: role breaks', P.reduce((a, p) => a + p.roleBreaks, 0), -1, String, 0], ['4 piece: B copies A', P.reduce((a, p) => a + p.copies, 0), -1, String, 0],
        ['4 piece: A to B distance', mean(P.map((p) => p.ab)), 0, f2, 1], ["4 piece: chords in A'", mean(P.map((p) => p.chordsA2)), 1, f2, 0.2],
        ['old: alignment', r.old.alignment, 1, f2, 0.02], ['old: gate', r.old.gate, 1, pc, 0.03], ['old: played-drum gate', r.old.playedGate, 1, pc, 0.03],
        ['old: variation best-of-six gate', r.old.varSixGate, 1, pc, 0.03], ['old: variation novelty', r.old.varNovelty, 1, f2, 0.03],
        ['old: variation coherence', r.old.varCoherence, 1, f2, 0.02], ['old: double first part kept', r.old.double.firstKept, 1, f2, 0.02],
        ['old: double ending novelty', r.old.double.novelty, 1, f2, 0.03], ['old: double coherence', r.old.double.fit, 1, f2, 0.02],
        ['old: new clip meaningful', r.old.create.meaningful, 1, pc, 0.02], ['old: new clip coherence', r.old.create.fit, 1, f2, 0.02],
        ['old: new clip with band', r.old.create.band, 1, f2, 0.03],
    ];
}

function compareCell(name, v, dir, fmt, tol, prev) {
    const p = prev?.find((x) => x[0] === name);
    if (!p || p[1] === null || v === null || dir === 0) return [p ? fmt(p[1]) : '-', ''];
    const d = (v - p[1]) * dir;
    return [fmt(p[1]), d < -tol - 1e-9 ? '**REGRESSED**' : d > tol ? 'better' : 'same'];
}

export function report(r, prevRes) {
    const prev = prevRes ? scorecard(prevRes) : null;
    const out = [`# Generator quality: ${r.label}`, '', `${r.cases} cases; knobs ${r.ms.knobs} ms, pieces ${r.ms.pieces} ms, old bench ${r.ms.old} ms. `
        + 'Method and thresholds: plans/2026-10-29-generator-quality-metrics.md.', '',
        `| metric | ${prevRes ? prevRes.label + ' | ' : ''}${r.label} | ${prevRes ? 'verdict |' : ''}`, `| --- | ${prevRes ? '--- | ' : ''}--- |${prevRes ? ' --- |' : ''}`];
    for (const [name, v, dir, fmt, tol] of scorecard(r)) {
        const [pv, verdict] = compareCell(name, v, dir, fmt, tol, prev);
        out.push(`| ${name} | ${prevRes ? pv + ' | ' : ''}${fmt(v)} | ${prevRes ? verdict + ' |' : ''}`);
    }
    out.push('', '## 1. Knobs that break their promise', '', '| knob | kept | swept |', '| --- | --- | --- |',
        ...r.sweep.byKnob.map(([k, s, n]) => `| ${k} | ${pc(s)} | ${n} |`));
    const rows = r.sweep.rows;
    const worst = (f, label) => {
        const by = new Map();
        for (const x of rows) { const k = `${x.task}:${x.preset} ${x.knob}`; const e = by.get(k) ?? [0, 0]; e[0] += f(x); e[1] += x.clicks; by.set(k, e); }
        return [...by].map(([k, [a, b]]) => [k, a / Math.max(1, b), b]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 20)
            .map(([k, s, b]) => `| ${k} | ${pc(s)} | ${b} | ${label} |`);
    };
    out.push('', '## 1. Worst knobs', '', '| generator knob | share | clicks | what |', '| --- | --- | --- | --- |',
        ...worst((x) => x.dead, 'dead clicks'), ...worst((x) => x.cliff, 'cliffs'),
        ...worst((x) => x.cls.filter((c) => c === 'broken').length * x.clicks / x.cls.length, 'broken positions'));
    if (r.sweep.dups.length) out.push('', 'Duplicate knobs: ' + r.sweep.dups.slice(0, 20).join('; ') + '.');
    out.push('', '## 2. Knob space by generator (worst first)', '', `Broken reasons: ${r.space.reasons.map(([w, n]) => `${w} ${n}`).join(', ')}.`, '',
        '| generator | musical | broken | default broken | next to default broken | samples |', '| --- | --- | --- | --- | --- | --- |',
        ...r.space.per.filter((x) => x.broken > 0 || x.defBroken > 0).sort((a, b) => b.broken - a.broken).slice(0, 25)
            .map((x) => `| ${x.k} | ${pc(x.musical)} | ${pc(x.broken)} | ${pc(x.defBroken)} | ${pc(x.nearBroken)} | ${x.n} |`));
    out.push('', '## 4. Pieces', '', '| piece | verdict | A | B | A\' | clash A/B/A\' | role breaks | B copies | A→B | chords A/A\' | generators |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...r.pieces.map((p) => `| ${p.motif ? 'motif' : 'scratch'} ${p.seed} | ${p.verdict} | ${p.scenes.map((s) => s.verdict[0].toUpperCase()).join(' | ')} | `
            + `${p.scenes.map((s) => pc(s.clash)).join('/')} | ${p.roleBreaks} | ${p.copies} | ${f2(p.ab)} | ${p.chordsA}/${p.chordsA2} | ${p.log.join(', ')} |`));
    return out.join('\n') + '\n';
}
